using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

namespace Streamer.bot.Plugin.Interface
{
    public class CPHInlineBase { public FakeArtworkCPH CPH; }
}
public class TestBroadcaster { public string UserId = "test"; }
public class FakeArtworkCPH
{
    public string TwitchClientId { get { return "fake-client"; } }
    public string TwitchOAuthToken { get { return "fake-user-token"; } }
    public string Image;
    public TestBroadcaster TwitchGetBroadcaster() { return new TestBroadcaster(); }
    public void LogWarn(string message) { }
    public string ObsSendRaw(string method, string json, int connection)
    {
        var data = JObject.Parse(json);
        switch (method)
        {
            case "GetCanvasList": return "{\"canvases\":[]}";
            case "GetSceneList": return "{\"scenes\":[]}";
            case "SetInputSettings": Image = (string)data["inputSettings"]["file"]; return "{}";
            case "GetInputSettings": return new JObject { ["inputSettings"] = new JObject { ["file"] = Image } }.ToString();
            default: throw new Exception("Unexpected OBS request");
        }
    }
}
public class FakeArtworkHttp : HttpMessageHandler
{
    public string Category = "1";
    public bool Fail, NoArt, NoCover;
    public int Requests, ImageRequests, IgdbRequests;
    public byte[] Image;
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellation)
    {
        Requests++;
        var url = request.RequestUri;
        string body;
        if (url.Host == "api.twitch.tv")
            body = url.AbsolutePath.EndsWith("channels") ? "{\"data\":[{\"game_id\":\"" + Category + "\"}]}" : "{\"data\":[{\"igdb_id\":\"123\"}]}";
        else if (url.Host == "id.twitch.tv") body = "{\"access_token\":\"fake-app-token\",\"expires_in\":3600}";
        else if (url.Host == "api.igdb.com")
        {
            IgdbRequests++;
            if (Fail) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
            if (url.AbsolutePath.EndsWith("/games"))
                body = NoCover ? "[{\"id\":123}]" : "[{\"id\":123,\"cover\":{\"image_id\":\"test_cover\"}}]";
            else body = NoArt ? "[]" : "[{\"image_id\":\"test_art\",\"width\":2560,\"height\":1440}]";
        }
        else if (url.Host == "images.igdb.com")
        {
            ImageRequests++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Image) });
        }
        else throw new Exception("External service not stubbed");
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body) });
    }
}
internal static class TestCategoryArtwork
{
    private static void Assert(bool value, string message) { if (!value) throw new Exception(message); }
    private static void ResetCache()
    {
        const BindingFlags flags = BindingFlags.Static | BindingFlags.NonPublic;
        typeof(CPHInline).GetField("LastCategory", flags).SetValue(null, null);
        typeof(CPHInline).GetField("LastFile", flags).SetValue(null, null);
    }
    public static void Main()
    {
        string directory = Path.Combine(Path.GetTempPath(), "artwork-test-" + Guid.NewGuid());
        Directory.CreateDirectory(directory);
        try
        {
            var http = new FakeArtworkHttp();
            using (var bitmap = new Bitmap(2560, 1440))
            using (var stream = new MemoryStream()) { bitmap.Save(stream, ImageFormat.Jpeg); http.Image = stream.ToArray(); }
            string placeholder = Path.Combine(directory, "cam-pug.jpg");
            File.WriteAllBytes(placeholder, http.Image);
            CPHInline.AssetDirectoryOverride = directory;
            CPHInline.CredentialOverride = name => "fake-credential";
            typeof(CPHInline).GetField("Http", BindingFlags.Static | BindingFlags.NonPublic).SetValue(null, new HttpClient(http));
            var cph = new FakeArtworkCPH();
            var code = new CPHInline { CPH = cph };
            Assert(code.Execute(), "artwork refresh failed");
            Assert(cph.Image.EndsWith("category-1-poster.jpg"), "poster not installed");
            using (var image = Image.FromFile(cph.Image)) Assert(image.Width == 2560 && image.Height == 1440, "output is not 1440p 16:9");
            byte[] poster = File.ReadAllBytes(cph.Image);
            int requests = http.Requests;
            Assert(code.Execute() && http.Requests == requests + 1, "unchanged category downloaded artwork again");
            ResetCache();
            int images = http.ImageRequests;
            Assert(code.Execute() && http.ImageRequests == images && cph.Image.EndsWith("category-1-poster.jpg"), "restart re-downloaded the cached poster");
            File.SetLastWriteTimeUtc(cph.Image, DateTime.UtcNow.AddDays(-8));
            ResetCache();
            int stale = http.ImageRequests;
            Assert(code.Execute() && http.ImageRequests > stale, "stale poster was not refreshed");
            string cached = cph.Image;
            File.SetLastWriteTimeUtc(cached, DateTime.UtcNow.AddDays(-8));
            ResetCache();
            http.Fail = true;
            Assert(code.Execute() && cph.Image == cached, "failed refresh dropped the cached poster");
            http.Fail = false;
            http.Category = "2"; http.Fail = true;
            ResetCache();
            Assert(!code.Execute() && cph.Image == placeholder, "failed category change left old game artwork");
            http.Fail = false;
            Assert(code.Execute() && cph.Image.EndsWith("category-2-poster.jpg"), "failed refresh did not retry");
            http.Category = "3"; http.NoArt = true;
            Assert(code.Execute() && cph.Image == placeholder, "missing art did not use placeholder");
            http.NoArt = false; http.NoCover = true; http.Category = "4";
            ResetCache();
            Assert(code.Execute() && cph.Image.EndsWith("category-4-poster.jpg"), "missing cover broke the poster");
            CPHInline.StyleOverride = () => "art";
            http.Category = "5";
            ResetCache();
            Assert(code.Execute() && cph.Image.EndsWith("category-5-art.jpg"), "art style failed");
            using (var image = Image.FromFile(cph.Image)) Assert(image.Width == 2560 && image.Height == 1440, "art style is not 1440p 16:9");
            byte[] plain = File.ReadAllBytes(cph.Image);
            Assert(Convert.ToBase64String(poster) != Convert.ToBase64String(plain), "poster style did not compose the cover");
            CPHInline.StyleOverride = null;
            Assert(CPHInline.SelectArtwork(JArray.Parse("[{\"image_id\":\"portrait\",\"width\":1440,\"height\":2560},{\"image_id\":\"small\",\"width\":640,\"height\":360}]")) == null, "portrait or undersized art accepted");
            Console.WriteLine("PASS artwork: poster with cover, art style, weekly cache, restart reuse, stale refresh, cached fallback, category change, failure and minimum resolution");
        }
        finally { Directory.Delete(directory, true); }
    }
}
