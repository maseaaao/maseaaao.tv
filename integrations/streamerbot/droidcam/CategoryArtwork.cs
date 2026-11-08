using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

// Separate Action: OBS | Category Artwork | Refresh.
public class CPHInline
#if ARTWORK_TESTS
    : Streamer.bot.Plugin.Interface.CPHInlineBase
#endif
{
    private static readonly object Gate = new object();
    private static HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(12) };
    private static string AppToken;
    private static DateTime TokenExpires;
    private static string LastCategory;
    private static DateTime LastSuccess;
    private static bool Prepared;
    internal static string AssetDirectoryOverride;
    internal static Func<string, string> CredentialOverride;
    private static string DirectoryPath { get { return AssetDirectoryOverride ?? Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "custom", "assets", "camera"); } }

    public bool Execute()
    {
        lock (Gate)
        {
            string category = null;
            try
            {
                if (!Prepared)
                {
                    var presentation = new CameraPresentation(ReadObs);
                    presentation.Prepare(CameraPresentation.ListScenes(ReadObs));
                    Prepared = true;
                }
                var broadcaster = CPH.TwitchGetBroadcaster();
                if (broadcaster == null) return false;
                var channel = First(GetTwitch("channels?broadcaster_id=" + Uri.EscapeDataString(broadcaster.UserId)));
                category = (string)channel["game_id"] ?? "";
                if (category == LastCategory && DateTime.UtcNow - LastSuccess < TimeSpan.FromHours(6)) return true;
                string imageId = null;
                if (!string.IsNullOrEmpty(category))
                {
                    var game = First(GetTwitch("games?id=" + Uri.EscapeDataString(category)));
                    long igdb;
                    if (long.TryParse((string)game["igdb_id"], out igdb) && igdb > 0)
                        imageId = FindArtwork(igdb);
                }
                string file = Path.Combine(DirectoryPath, "cam-pug.jpg");
                if (imageId != null)
                {
                    file = Path.Combine(DirectoryPath, "category-" + category + ".jpg");
                    DownloadArtwork(imageId, file);
                }
                SetImage(file);
                LastCategory = category;
                LastSuccess = DateTime.UtcNow;
                return true;
            }
            catch (Exception)
            {
                // A failed category change must never leave the previous game's image on screen.
                if (category != LastCategory)
                    try { SetImage(Path.Combine(DirectoryPath, "cam-pug.jpg")); } catch (Exception) { }
                CPH.LogWarn("Category artwork unavailable; check the IGDB credentials, network and OBS image source.");
                return false;
            }
        }
    }

    private JObject ReadObs(string method, JObject data)
    {
        var result = JObject.Parse(CPH.ObsSendRaw(method, data.ToString(Formatting.None), 0));
        if (result["requestStatus"]?["result"]?.Value<bool>() == false) throw new InvalidOperationException("OBS request failed.");
        return result;
    }

    private static JObject First(JObject response)
    {
        var data = response["data"] as JArray;
        if (data == null || data.Count == 0) throw new InvalidOperationException("Empty Twitch response.");
        return (JObject)data[0];
    }
    private JObject GetTwitch(string path)
    {
        using (var request = new HttpRequestMessage(HttpMethod.Get, "https://api.twitch.tv/helix/" + path))
        {
            request.Headers.Add("Client-Id", CPH.TwitchClientId);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", CPH.TwitchOAuthToken);
            using (var response = Http.SendAsync(request).GetAwaiter().GetResult())
            {
                response.EnsureSuccessStatusCode();
                return JObject.Parse(response.Content.ReadAsStringAsync().GetAwaiter().GetResult());
            }
        }
    }
    private static string Credential(string name, string field)
    {
        if (CredentialOverride != null) return CredentialOverride(name);
        string value = Environment.GetEnvironmentVariable(name, EnvironmentVariableTarget.User);
        if (string.IsNullOrWhiteSpace(value)) value = Environment.GetEnvironmentVariable(name);
        string path = Path.Combine(DirectoryPath, "igdb.json");
        if (string.IsNullOrWhiteSpace(value) && File.Exists(path)) value = (string)JObject.Parse(File.ReadAllText(path))[field];
        if (string.IsNullOrWhiteSpace(value)) throw new InvalidOperationException("Missing IGDB application credential.");
        return value;
    }
    private static string Token()
    {
        if (AppToken != null && DateTime.UtcNow < TokenExpires) return AppToken;
        var fields = new Dictionary<string, string> { { "client_id", Credential("IGDB_CLIENT_ID", "clientId") }, { "client_secret", Credential("IGDB_CLIENT_SECRET", "clientSecret") }, { "grant_type", "client_credentials" } };
        using (var content = new FormUrlEncodedContent(fields))
        using (var response = Http.PostAsync("https://id.twitch.tv/oauth2/token", content).GetAwaiter().GetResult())
        {
            response.EnsureSuccessStatusCode();
            var result = JObject.Parse(response.Content.ReadAsStringAsync().GetAwaiter().GetResult());
            AppToken = (string)result["access_token"];
            TokenExpires = DateTime.UtcNow.AddSeconds((int)result["expires_in"] - 120);
            return AppToken;
        }
    }
    private static string FindArtwork(long game)
    {
        using (var request = new HttpRequestMessage(HttpMethod.Post, "https://api.igdb.com/v4/artworks"))
        {
            request.Headers.Add("Client-ID", Credential("IGDB_CLIENT_ID", "clientId"));
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token());
            request.Content = new StringContent("fields image_id,width,height; where game = " + game + " & width >= 1280 & height >= 720; limit 100;", Encoding.UTF8, "text/plain");
            using (var response = Http.SendAsync(request).GetAwaiter().GetResult())
            {
                if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized) AppToken = null;
                response.EnsureSuccessStatusCode();
                return SelectArtwork(JArray.Parse(response.Content.ReadAsStringAsync().GetAwaiter().GetResult()));
            }
        }
    }
    internal static string SelectArtwork(JArray candidates)
    {
        string selected = null;
        double score = double.MaxValue;
        foreach (JObject item in candidates)
        {
            double w = (double?)item["width"] ?? 0, h = (double?)item["height"] ?? 0;
            string id = (string)item["image_id"];
            if (w < 1280 || h < 720 || w < h || string.IsNullOrEmpty(id)) continue;
            if (!System.Text.RegularExpressions.Regex.IsMatch(id, "^[A-Za-z0-9_]+$")) continue;
            double croppedHeight = Math.Min(h, w * 9 / 16);
            if (croppedHeight < 720) continue;
            double value = Math.Abs(w / h - 16.0 / 9) + 1 / croppedHeight;
            if (value < score) { score = value; selected = id; }
        }
        return selected;
    }
    private static void DownloadArtwork(string id, string destination)
    {
        byte[] bytes = Http.GetByteArrayAsync("https://images.igdb.com/igdb/image/upload/t_720p_2x/" + id + ".jpg").GetAwaiter().GetResult();
        using (var stream = new MemoryStream(bytes))
        using (var image = Image.FromStream(stream))
        {
            int height = Math.Min(1440, (int)Math.Floor(Math.Min(image.Height, image.Width * 9.0 / 16) / 9) * 9);
            if (height < 720) throw new InvalidOperationException("Artwork below 720p.");
            int width = height / 9 * 16;
            using (var output = new Bitmap(width, height))
            using (var graphics = Graphics.FromImage(output))
            {
                graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                double cropW = Math.Min(image.Width, image.Height * 16.0 / 9), cropH = cropW * 9 / 16;
                graphics.DrawImage(image, new Rectangle(0, 0, width, height), (float)((image.Width - cropW) / 2), (float)((image.Height - cropH) / 2), (float)cropW, (float)cropH, GraphicsUnit.Pixel);
                string temporary = destination + ".tmp";
                output.Save(temporary, ImageFormat.Jpeg);
                if (File.Exists(destination)) File.Replace(temporary, destination, null);
                else File.Move(temporary, destination);
            }
        }
    }
    private void SetImage(string file)
    {
        if (!File.Exists(file)) throw new FileNotFoundException("Camera image missing.");
        string json = new JObject { ["inputName"] = CameraPresentation.Artwork, ["inputSettings"] = new JObject { ["file"] = file }, ["overlay"] = true }.ToString(Formatting.None);
        var result = JObject.Parse(CPH.ObsSendRaw("SetInputSettings", json, 0));
        if (result["requestStatus"]?["result"]?.Value<bool>() == false) throw new InvalidOperationException("OBS rejected artwork.");
        var current = JObject.Parse(CPH.ObsSendRaw("GetInputSettings", new JObject { ["inputName"] = CameraPresentation.Artwork }.ToString(Formatting.None), 0));
        if ((string)current["inputSettings"]?["file"] != file) throw new InvalidOperationException("Artwork readback mismatch.");
    }
}
