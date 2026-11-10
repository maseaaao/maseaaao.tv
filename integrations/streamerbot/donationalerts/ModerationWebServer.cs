using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

// A localhost-only control plane for the moderation queue and the OBS browser alert.
// It is started by the long-lived AI Moderation host Action and lives as long as that Action.
public sealed class ModerationWebServer : IDisposable
{
    public const int Port = 7480;
    private const int MaxBody = 65536;
    private readonly object gate = new object();
    private readonly HttpListener listener = new HttpListener();
    private readonly Func<ModerationEngine> engine;
    private readonly Func<ModerationFiles> files;
    private readonly Func<bool> restart;
    private readonly Func<string> historyToken;
    private readonly string webRoot;
    private Thread loop;
    private volatile bool running;
    private static readonly object HistoryGate = new object();

    public ModerationWebServer(Func<ModerationEngine> engine, Func<ModerationFiles> files, Func<bool> restart, string webRoot, Func<string> historyToken)
    {
        if (engine == null) throw new ArgumentNullException("engine");
        if (files == null) throw new ArgumentNullException("files");
        if (restart == null) throw new ArgumentNullException("restart");
        this.engine = engine;
        this.files = files;
        this.restart = restart;
        this.webRoot = webRoot;
        this.historyToken = historyToken;
        listener.Prefixes.Add("http://127.0.0.1:" + Port + "/");
    }

    public void Start()
    {
        if (running) return;
        listener.Start();
        running = true;
        loop = new Thread(ListenLoop) { IsBackground = true, Name = "AI Moderation Web" };
        loop.Start();
    }

    private void ListenLoop()
    {
        while (running)
        {
            HttpListenerContext context = null;
            try
            {
                context = listener.GetContext();
            }
            catch (HttpListenerException) { return; }
            catch (ObjectDisposedException) { return; }
            catch (Exception) { continue; }
            try { ThreadPool.QueueUserWorkItem(delegate { Handle(context); }); }
            catch (Exception) { SafeClose(context); }
        }
    }

    private void Handle(HttpListenerContext context)
    {
        try
        {
            string path = (context.Request.Url.AbsolutePath ?? "/").ToLowerInvariant();
            if (path == "/" || path == "/index.html" || path == "/dock" || path == "/dock.html" || path == "/widget.html")
            {
                ServeIndex(context);
                return;
            }
            if (path == "/favicon.ico") { context.Response.StatusCode = 204; context.Response.Close(); return; }

            if (path == "/api/state") { Json(context, State()); return; }
            if (path == "/api/history") { Json(context, HistoryList()); return; }
            if (path == "/api/current") { Json(context, Current()); return; }
            if (path == "/api/audio") { ServeAudio(context); return; }
            if (path == "/api/config" && context.Request.HttpMethod == "POST") { SaveConfig(context); return; }
            if (path == "/api/history/import" && context.Request.HttpMethod == "POST") { ImportHistory(context); return; }
            if (path == "/api/review" && context.Request.HttpMethod == "POST") { Review(context); return; }
            if (path == "/api/control" && context.Request.HttpMethod == "POST") { Control(context); return; }
            if (path == "/api/test" && context.Request.HttpMethod == "POST") { TestProvider(context); return; }

            context.Response.StatusCode = 404;
            context.Response.ContentType = "text/plain; charset=utf-8";
            Write(context, "not found");
        }
        catch (Exception)
        {
            try
            {
                context.Response.StatusCode = 500;
                context.Response.ContentType = "application/json; charset=utf-8";
                Write(context, "{\"ok\":false,\"error\":\"internal_error\"}");
            }
            catch (Exception) { }
        }
        finally { try { context.Response.Close(); } catch (Exception) { } }
    }

    private ModerationEngine Engine()
    {
        var current = engine();
        if (current == null) throw new InvalidOperationException("engine_unavailable");
        return current;
    }

    private JObject State()
    {
        var current = Engine();
        var settings = current.Configuration;
        var counts = current.Counts();
        var items = current.Snapshot()
            .OrderByDescending(x => x.CreatedUtc)
            .Take(200)
            .Select(ItemView)
            .ToArray();

        var config = new JObject
        {
            ["goModel"] = settings.GoModel,
            ["goReasoning"] = settings.GoReasoning,
            ["deepSeekModel"] = settings.DeepSeekModel,
            ["timeoutSeconds"] = settings.TimeoutSeconds,
            ["displaySeconds"] = settings.DisplaySeconds,
            ["rules"] = settings.Rules,
            ["paused"] = settings.Paused,
            ["outputsReady"] = settings.OutputsReady,
            ["hasGoKey"] = !string.IsNullOrWhiteSpace(settings.GoKey),
            ["hasDeepSeekKey"] = !string.IsNullOrWhiteSpace(settings.DeepSeekKey)
        };
        var countObject = new JObject();
        foreach (var pair in counts) countObject[pair.Key] = pair.Value;
        return new JObject
        {
            ["ok"] = true,
            ["running"] = true,
            ["session"] = current.SessionId,
            ["lastError"] = current.LastError,
            ["counts"] = countObject,
            ["config"] = config,
            ["items"] = new JArray(items)
        };
    }

    private static JObject ItemView(ModerationItem item)
    {
        string audioUrl = "";
        if (!string.IsNullOrWhiteSpace(item.AudioPath) && File.Exists(item.AudioPath))
            audioUrl = "/api/audio?id=" + Uri.EscapeDataString(item.Id ?? "") +
                "&platform=" + Uri.EscapeDataString(item.Platform ?? "");
        return new JObject
        {
            ["id"] = item.Id,
            ["platform"] = item.Platform,
            ["kind"] = item.Kind,
            ["username"] = item.Username,
            ["message"] = item.Message,
            ["amount"] = item.Amount,
            ["currency"] = item.Currency,
            ["convertedAmount"] = item.ConvertedAmount,
            ["status"] = item.Status,
            ["reason"] = item.Reason,
            ["provider"] = item.Provider,
            ["providerError"] = item.ProviderError,
            ["createdUtc"] = item.CreatedUtc.ToString("o", CultureInfo.InvariantCulture),
            ["updatedUtc"] = item.UpdatedUtc.ToString("o", CultureInfo.InvariantCulture),
            ["hasAudio"] = audioUrl.Length > 0,
            ["audioUrl"] = audioUrl
        };
    }

    private JObject HistoryList()
    {
        var all = Engine().Snapshot().Where(x => x.Status == "historical")
            .OrderByDescending(x => x.CreatedUtc).ToList();
        var items = all.Take(500).Select(ItemView).ToArray();
        return new JObject { ["ok"] = true, ["total"] = all.Count, ["items"] = new JArray(items) };
    }

    private JObject Current()
    {
        var current = Engine();
        var settings = current.Configuration;
        var item = current.ActiveDisplay();
        if (item == null || item.Status != "displaying")
            return new JObject { ["active"] = false };

        string token = current.ActiveDeliveryToken();
        string audioUrl = "";
        if (!string.IsNullOrWhiteSpace(item.AudioPath) && File.Exists(item.AudioPath))
            audioUrl = "/api/audio?id=" + Uri.EscapeDataString(item.Id ?? "") +
                "&platform=" + Uri.EscapeDataString(item.Platform ?? "") +
                "&token=" + Uri.EscapeDataString(token ?? "");
        return new JObject
        {
            ["active"] = true,
            ["token"] = token,
            ["displaySeconds"] = Math.Max(3, Math.Min(60, settings.DisplaySeconds)),
            ["item"] = new JObject
            {
                ["id"] = item.Id,
                ["platform"] = item.Platform,
                ["kind"] = item.Kind,
                ["username"] = item.Username,
                ["message"] = item.Message,
                ["amount"] = item.Amount,
                ["currency"] = item.Currency,
                ["convertedAmount"] = item.ConvertedAmount,
                ["hasAudio"] = audioUrl.Length > 0,
                ["audioUrl"] = audioUrl
            }
        };
    }

    private void ImportHistory(HttpListenerContext context)
    {
        lock (HistoryGate)
        {
            string token = "";
            try { token = historyToken == null ? "" : historyToken(); }
            catch (Exception) { token = ""; }
            if (string.IsNullOrWhiteSpace(token))
            {
                Json(context, new JObject { ["ok"] = false, ["error"] = "missing_token" }, 401);
                return;
            }
            try
            {
                var items = ModerationHistory.Fetch(token);
                int imported = Engine().ImportHistorical(items);
                Json(context, new JObject
                {
                    ["ok"] = true,
                    ["fetched"] = items.Count,
                    ["imported"] = imported,
                    ["skipped"] = items.Count - imported
                });
            }
            catch (Exception ex)
            {
                string code = ex is InvalidOperationException && IsHistoryError(ex.Message)
                    ? ex.Message
                    : "history_unavailable";
                Json(context, new JObject { ["ok"] = false, ["error"] = code }, 502);
            }
        }
    }

    private static bool IsHistoryError(string message)
    {
        return message == "missing_token" || message == "response_too_large" ||
            message == "invalid_response" || message == "http_401" || message == "http_403" ||
            message == "http_429" || message.StartsWith("http_", StringComparison.Ordinal);
    }

    private void SaveConfig(HttpListenerContext context)
    {
        var body = ReadJson(context);
        var current = Engine();
        var settings = current.Configuration;
        string goKey = Text(body, "goKey");
        string deepSeekKey = Text(body, "deepSeekKey");
        if (goKey.Length > 0) settings.GoKey = goKey.Trim();
        if (deepSeekKey.Length > 0) settings.DeepSeekKey = deepSeekKey.Trim();
        if (Bool(body, "clearGoKey")) settings.GoKey = "";
        if (Bool(body, "clearDeepSeekKey")) settings.DeepSeekKey = "";

        string goModel = Text(body, "goModel");
        string goReasoning = Text(body, "goReasoning");
        string deepSeekModel = Text(body, "deepSeekModel");
        if (goModel.Length > 0) settings.GoModel = Limit(goModel.Trim(), 100);
        if (ModerationHttpTransport.IsReasoningEffort(goReasoning)) settings.GoReasoning = goReasoning;
        if (deepSeekModel.Length > 0) settings.DeepSeekModel = Limit(deepSeekModel.Trim(), 100);
        int timeout = Int(body, "timeoutSeconds", settings.TimeoutSeconds);
        settings.TimeoutSeconds = Math.Max(1, Math.Min(30, timeout));
        int display = Int(body, "displaySeconds", settings.DisplaySeconds);
        settings.DisplaySeconds = Math.Max(3, Math.Min(60, display));
        string rules = Text(body, "rules");
        if (rules.Length > 0) settings.Rules = Limit(rules.Trim(), 8000);
        if (body["paused"] != null) settings.Paused = Bool(body, "paused");
        if (body["outputsReady"] != null) settings.OutputsReady = Bool(body, "outputsReady");

        files().SaveConfig(settings);
        current.Configure(settings);
        Json(context, State());
    }

    private void Review(HttpListenerContext context)
    {
        var body = ReadJson(context);
        string platform = Text(body, "platform");
        string id = Text(body, "id");
        string operation = Text(body, "operation");
        if (string.IsNullOrWhiteSpace(platform) || string.IsNullOrWhiteSpace(id) ||
            (operation != "allow" && operation != "block" && operation != "retry" && operation != "replay"))
        {
            Json(context, new JObject { ["ok"] = false, ["error"] = "invalid_request" }, 400);
            return;
        }
        bool changed = operation == "replay"
            ? Engine().Replay(platform, id)
            : Engine().Review(platform, id, operation);
        Json(context, new JObject { ["ok"] = changed, ["error"] = changed ? "" : "not_available" }, changed ? 200 : 409);
    }

    private void Control(HttpListenerContext context)
    {
        var body = ReadJson(context);
        string action = Text(body, "action");
        if (action == "restart")
        {
            bool ok = restart();
            Json(context, new JObject { ["ok"] = ok, ["error"] = ok ? "" : "restart_failed" }, ok ? 200 : 500);
            return;
        }
        if (action != "pause" && action != "resume")
        {
            Json(context, new JObject { ["ok"] = false, ["error"] = "invalid_request" }, 400);
            return;
        }
        var current = Engine();
        var settings = current.Configuration;
        settings.Paused = action == "pause";
        if (settings.Paused) current.CancelActiveDisplay();
        files().SaveConfig(settings);
        current.Configure(settings);
        Json(context, State());
    }

    private void TestProvider(HttpListenerContext context)
    {
        var body = ReadJson(context);
        string provider = Text(body, "provider");
        if (provider != "OpenCode Go" && provider != "DeepSeek API")
        {
            Json(context, new JObject { ["ok"] = false, ["error"] = "invalid_provider" }, 400);
            return;
        }
        var current = Engine();
        var settings = current.Configuration;
        string payload = "{\"platform\":\"test\",\"kind\":\"text\",\"username\":\"maseaaao\",\"message\":\"Проверка провайдера\",\"normalizedUsername\":\"maseaaao\",\"normalizedMessage\":\"проверка провайдера\",\"compactUsername\":\"maseaaao\",\"compactMessage\":\"проверкапровайдера\"}";
        try
        {
            using (var transport = new ModerationHttpTransport())
            {
                string raw = transport.Complete(provider, settings, current.SessionId, payload, CancellationToken.None);
                var result = ModerationEngine.ParseDecision(raw);
                Json(context, new JObject { ["ok"] = true, ["decision"] = result.Item1, ["reason"] = result.Item2 });
            }
        }
        catch (Exception ex)
        {
            string code = ex is InvalidOperationException && ModerationHttpTransport.IsKnownError(ex.Message)
                ? ex.Message
                : "network_or_response_error";
            Json(context, new JObject { ["ok"] = false, ["error"] = code }, 502);
        }
    }

    private void ServeAudio(HttpListenerContext context)
    {
        var query = Query(context.Request.Url.Query);
        string id, platform, token;
        query.TryGetValue("id", out id);
        query.TryGetValue("platform", out platform);
        query.TryGetValue("token", out token);
        if (string.IsNullOrWhiteSpace(platform)) platform = "donationalerts";
        var item = Engine().Find(platform, id ?? "");
        if (item == null || string.IsNullOrWhiteSpace(item.AudioPath) || !File.Exists(item.AudioPath))
        {
            context.Response.StatusCode = 404;
            context.Response.Close();
            return;
        }
        if (!string.IsNullOrWhiteSpace(token) && item.DeliveryToken != token)
        {
            context.Response.StatusCode = 403;
            context.Response.Close();
            return;
        }
        string full = Path.GetFullPath(item.AudioPath);
        string allowed = Path.GetFullPath(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "maseaaao.tv", "moderation", "audio")) + Path.DirectorySeparatorChar;
        if (!full.StartsWith(allowed, StringComparison.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = 403;
            context.Response.Close();
            return;
        }
        string extension = Path.GetExtension(full).ToLowerInvariant();
        if (extension != ".wav" && extension != ".mp3" && extension != ".ogg" && extension != ".m4a")
        {
            context.Response.StatusCode = 415;
            context.Response.Close();
            return;
        }
        context.Response.ContentType = extension == ".wav" ? "audio/wav" : "audio/mpeg";
        context.Response.Headers["Cache-Control"] = "no-store";
        context.Response.ContentLength64 = new FileInfo(full).Length;
        using (var stream = File.OpenRead(full)) stream.CopyTo(context.Response.OutputStream);
    }

    private void ServeIndex(HttpListenerContext context)
    {
        string file = Path.Combine(webRoot, "index.html");
        if (!File.Exists(file))
        {
            context.Response.StatusCode = 503;
            context.Response.ContentType = "text/html; charset=utf-8";
            Write(context, "<!doctype html><meta charset=utf-8><title>Модерация</title>" +
                "<body style=\"font:16px Arial;padding:24px;background:#f8f9f4;color:#212120\">" +
                "<h1>Интерфейс модерации не установлен</h1><p>Скопируйте собранный <code>index.html</code> в " +
                "<code>custom/moderation</code> рядом с Streamer.bot.</p></body>");
            return;
        }
        context.Response.ContentType = "text/html; charset=utf-8";
        context.Response.Headers["Cache-Control"] = "no-store";
        using (var stream = File.OpenRead(file)) stream.CopyTo(context.Response.OutputStream);
    }

    private JObject ReadJson(HttpListenerContext context)
    {
        if (context.Request.ContentLength64 > MaxBody)
            throw new InvalidOperationException("body_too_large");
        using (var reader = new StreamReader(context.Request.InputStream, Encoding.UTF8))
        {
            string raw = reader.ReadToEnd();
            if (raw.Length > MaxBody) throw new InvalidOperationException("body_too_large");
            var value = JObject.Parse(raw);
            if (value == null) throw new InvalidOperationException("invalid_json");
            return value;
        }
    }

    private static void Json(HttpListenerContext context, JObject value, int status = 200)
    {
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.Headers["Cache-Control"] = "no-store";
        Write(context, value.ToString(Formatting.None));
    }

    private static void Write(HttpListenerContext context, string value)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(value ?? "");
        context.Response.ContentLength64 = bytes.Length;
        context.Response.OutputStream.Write(bytes, 0, bytes.Length);
    }

    private static string Text(JObject value, string name)
    {
        var token = value[name];
        return token == null || token.Type == JTokenType.Null ? "" : (token.Type == JTokenType.String ? (string)token : token.ToString());
    }

    private static bool Bool(JObject value, string name)
    {
        var token = value[name];
        if (token == null) return false;
        if (token.Type == JTokenType.Boolean) return (bool)token;
        bool parsed;
        return bool.TryParse(token.ToString(), out parsed) && parsed;
    }

    private static int Int(JObject value, string name, int fallback)
    {
        var token = value[name];
        if (token == null) return fallback;
        int parsed;
        return int.TryParse(token.ToString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed) ? parsed : fallback;
    }

    private static string Limit(string value, int max)
    {
        if (value == null) return "";
        return value.Length <= max ? value : value.Substring(0, max);
    }

    private static Dictionary<string, string> Query(string query)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(query)) return result;
        foreach (string pair in query.TrimStart('?').Split('&'))
        {
            int index = pair.IndexOf('=');
            string key = index < 0 ? pair : pair.Substring(0, index);
            string value = index < 0 ? "" : pair.Substring(index + 1);
            result[Uri.UnescapeDataString(key)] = Uri.UnescapeDataString(value.Replace("+", " "));
        }
        return result;
    }

    private static void SafeClose(HttpListenerContext context)
    {
        try { if (context != null) context.Response.Close(); } catch (Exception) { }
    }

    public void Dispose()
    {
        running = false;
        try { listener.Stop(); } catch (Exception) { }
        try { listener.Close(); } catch (Exception) { }
        try { if (loop != null) loop.Join(1500); } catch (Exception) { }
    }
}
