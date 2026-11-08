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
    private static string LastFile;
    private static DateTime RetryAfter;
    private static readonly TimeSpan CacheAge = TimeSpan.FromDays(7);
    private static bool Prepared;
    internal static string AssetDirectoryOverride;
    internal static Func<string, string> CredentialOverride;
    internal static Func<string> StyleOverride;
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
                string placeholder = Path.Combine(DirectoryPath, "cam-pug.jpg");
                if (string.IsNullOrEmpty(category))
                {
                    Use(placeholder, category);
                    return true;
                }
                // Готовый постер лежит на диске: перезапуск и таймер не качают его заново.
                string cached = Path.Combine(DirectoryPath, "category-" + category + "-" + Style() + ".jpg");
                bool fresh = Fresh(cached);
                if (category == LastCategory && cached == LastFile && (fresh || DateTime.UtcNow < RetryAfter)) return true;
                if (!fresh)
                {
                    try
                    {
                        if (!Download(category, cached))
                        {
                            Use(placeholder, category);
                            return true;
                        }
                    }
                    catch (Exception)
                    {
                        RetryAfter = DateTime.UtcNow.AddMinutes(30);
                        if (!File.Exists(cached))
                        {
                            Use(placeholder, category);
                            CPH.LogWarn("Category artwork unavailable; check the IGDB credentials, network and OBS image source.");
                            return false;
                        }
                        CPH.LogWarn("Category artwork refresh failed; the cached poster is kept.");
                    }
                }
                Use(cached, category);
                return true;
            }
            catch (Exception)
            {
                // A failed category change must never leave the previous game's image on screen.
                if (category != LastCategory)
                    try { Use(Path.Combine(DirectoryPath, "cam-pug.jpg"), category); } catch (Exception) { }
                CPH.LogWarn("Category artwork unavailable; check the IGDB credentials, network and OBS image source.");
                return false;
            }
        }
    }

    private void Use(string file, string category)
    {
        if (file != LastFile) SetImage(file);
        LastCategory = category;
        LastFile = file;
    }
    private static bool Fresh(string file)
    {
        if (!File.Exists(file)) return false;
        var info = new FileInfo(file);
        return info.Length > 0 && DateTime.UtcNow - info.LastWriteTimeUtc < CacheAge;
    }
    // false — у категории нет подходящего арта; сетевые ошибки бросают исключение.
    private bool Download(string category, string destination)
    {
        var game = First(GetTwitch("games?id=" + Uri.EscapeDataString(category)));
        long igdb;
        if (!long.TryParse((string)game["igdb_id"], out igdb) || igdb <= 0) return false;
        string imageId = FindArtwork(igdb);
        if (imageId == null) return false;
        DownloadArtwork(imageId, FindCover(igdb), destination);
        return Fresh(destination);
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
    private static string FindCover(long game)
    {
        using (var request = new HttpRequestMessage(HttpMethod.Post, "https://api.igdb.com/v4/games"))
        {
            request.Headers.Add("Client-ID", Credential("IGDB_CLIENT_ID", "clientId"));
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token());
            request.Content = new StringContent("fields cover.image_id; where id = " + game + ";", Encoding.UTF8, "text/plain");
            using (var response = Http.SendAsync(request).GetAwaiter().GetResult())
            {
                if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized) AppToken = null;
                response.EnsureSuccessStatusCode();
                var games = JArray.Parse(response.Content.ReadAsStringAsync().GetAwaiter().GetResult());
                JToken cover = games.Count == 0 ? null : games[0]["cover"];
                string id = cover == null ? null : (string)cover["image_id"];
                return string.IsNullOrEmpty(id) || !System.Text.RegularExpressions.Regex.IsMatch(id, "^[A-Za-z0-9_]+$") ? null : id;
            }
        }
    }
    private static string Style()
    {
        string value = StyleOverride != null ? StyleOverride() : null;
        if (string.IsNullOrWhiteSpace(value)) value = Environment.GetEnvironmentVariable("CAMERA_ARTWORK_STYLE", EnvironmentVariableTarget.User);
        if (string.IsNullOrWhiteSpace(value)) value = Environment.GetEnvironmentVariable("CAMERA_ARTWORK_STYLE");
        return string.Equals((value ?? "").Trim(), "art", StringComparison.OrdinalIgnoreCase) ? "art" : "poster";
    }
    private static Image LoadCover(string id)
    {
        try
        {
            byte[] bytes = Http.GetByteArrayAsync("https://images.igdb.com/igdb/image/upload/t_1080p/" + id + ".jpg").GetAwaiter().GetResult();
            return Image.FromStream(new MemoryStream(bytes));
        }
        catch (Exception) { return null; }
    }
    private static void DownloadArtwork(string id, string coverId, string destination)
    {
        byte[] bytes = Http.GetByteArrayAsync("https://images.igdb.com/igdb/image/upload/t_720p_2x/" + id + ".jpg").GetAwaiter().GetResult();
        using (var stream = new MemoryStream(bytes))
        using (var artwork = Image.FromStream(stream))
        {
            int height = Math.Min(1440, (int)Math.Floor(Math.Min(artwork.Height, artwork.Width * 9.0 / 16) / 9) * 9);
            if (height < 720) throw new InvalidOperationException("Artwork below 720p.");
            int width = height / 9 * 16;
            using (var output = new Bitmap(width, height))
            using (var graphics = Graphics.FromImage(output))
            {
                graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                Image cover = Style() == "poster" && coverId != null ? LoadCover(coverId) : null;
                try
                {
                    if (cover != null) ComposePoster(graphics, artwork, cover, width, height);
                    else ComposeArt(graphics, artwork, width, height);
                }
                finally { if (cover != null) cover.Dispose(); }
                string temporary = destination + ".tmp";
                output.Save(temporary, ImageFormat.Jpeg);
                if (File.Exists(destination)) File.Replace(temporary, destination, null);
                else File.Move(temporary, destination);
            }
        }
    }
    // Постер с логотипом: обложка игры поверх размытого арта той же категории.
    private static void ComposePoster(Graphics graphics, Image artwork, Image cover, int width, int height)
    {
        int smallWidth = Math.Max(8, width / 48), smallHeight = Math.Max(8, height / 48);
        using (var small = new Bitmap(smallWidth, smallHeight))
        {
            using (var smallGraphics = Graphics.FromImage(small))
            {
                smallGraphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                ComposeArt(smallGraphics, artwork, smallWidth, smallHeight);
            }
            graphics.DrawImage(small, new Rectangle(0, 0, width, height));
        }
        using (var shade = new SolidBrush(Color.FromArgb(120, 0, 0, 0))) graphics.FillRectangle(shade, 0, 0, width, height);
        int cardHeight = (int)Math.Round(height * 0.84);
        int cardWidth = (int)Math.Round(cardHeight * (double)cover.Width / cover.Height);
        int x = (width - cardWidth) / 2, y = (height - cardHeight) / 2;
        float radius = Math.Max(16f, height / 51f);
        using (var shadow = Rounded(new RectangleF(x - 6, y + 12, cardWidth + 12, cardHeight + 12), radius + 8))
        using (var brush = new SolidBrush(Color.FromArgb(110, 0, 0, 0))) graphics.FillPath(brush, shadow);
        using (var path = Rounded(new RectangleF(x, y, cardWidth, cardHeight), radius))
        {
            var state = graphics.Save();
            graphics.SetClip(path);
            graphics.DrawImage(cover, new Rectangle(x, y, cardWidth, cardHeight));
            graphics.Restore(state);
            using (var border = new Pen(Color.FromArgb(56, 255, 255, 255), Math.Max(1f, height / 720f))) graphics.DrawPath(border, path);
        }
    }
    private static void ComposeArt(Graphics graphics, Image artwork, int width, int height)
    {
        double cropW = Math.Min(artwork.Width, artwork.Height * 16.0 / 9), cropH = cropW * 9 / 16;
        graphics.DrawImage(artwork, new Rectangle(0, 0, width, height), (float)((artwork.Width - cropW) / 2), (float)((artwork.Height - cropH) / 2), (float)cropW, (float)cropH, GraphicsUnit.Pixel);
    }
    private static GraphicsPath Rounded(RectangleF rect, float radius)
    {
        var path = new GraphicsPath();
        float diameter = radius * 2;
        path.AddArc(rect.X, rect.Y, diameter, diameter, 180, 90);
        path.AddArc(rect.Right - diameter, rect.Y, diameter, diameter, 270, 90);
        path.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(rect.X, rect.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
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
