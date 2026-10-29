using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

namespace Streamer.bot.Plugin.Interface
{
    public class CPHInlineBase { public FakeToggleCPH CPH; }
}

public class FakeToggleCPH
{
    public const string Input = "2f2c20ab-4450-4c45-b1a1-dc6a5eb236f5";
    public readonly Dictionary<string, object> Globals = new Dictionary<string, object>();
    public readonly List<string> Writes = new List<string>();
    public readonly Dictionary<string, JArray> Scenes = new Dictionary<string, JArray>
    {
        { "game", new JArray(Item(9, true)) },
        { "base", new JArray(Item(7, false)) },
        { "camera", new JArray(Item(19, true)) }
    };
    public bool Muted, Shutdown;
    public string Monitor = "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT";
    public string Collection = "test";
    public string FailOnce;
    public bool IgnoreWrites;
    public static JObject Item(int id, bool enabled)
    {
        return new JObject { ["sourceUuid"] = Input, ["sourceName"] = "8️⃣ДОНАТЫ", ["sceneItemId"] = id, ["sceneItemEnabled"] = enabled, ["isGroup"] = false };
    }
    public T GetGlobalVar<T>(string name, bool persist) { if (!persist) throw new Exception("State must persist"); object value; return Globals.TryGetValue(name, out value) ? (T)value : default(T); }
    public void SetGlobalVar<T>(string name, T value, bool persist) { if (!persist) throw new Exception("State must persist"); Globals[name] = value; }
    public void LogWarn(string message) { }
    public string ObsSendRaw(string method, string json, int connection)
    {
        if (connection != 0) throw new Exception("Unexpected OBS connection");
        var data = JObject.Parse(json);
        if (method == FailOnce) { FailOnce = null; throw new Exception("Injected OBS failure"); }
        if (method.StartsWith("Set", StringComparison.Ordinal))
        {
            Writes.Add(method + ":" + json);
            if (IgnoreWrites) return "{}";
        }
        switch (method)
        {
            case "GetSceneCollectionList": return new JObject { ["currentSceneCollectionName"] = Collection }.ToString();
            case "GetSceneList": return new JObject { ["scenes"] = new JArray(Scenes.Keys.Where(k => k != "group").Select(k => new JObject { ["sceneUuid"] = k, ["sceneName"] = k })) }.ToString();
            case "GetSceneItemList":
            case "GetGroupSceneItemList": return new JObject { ["sceneItems"] = Scenes[(string)data["sceneUuid"]].DeepClone() }.ToString();
            case "GetSceneItemEnabled": return new JObject { ["sceneItemEnabled"] = Scenes[(string)data["sceneUuid"]].Single(x => (int)x["sceneItemId"] == (int)data["sceneItemId"])["sceneItemEnabled"].DeepClone() }.ToString();
            case "GetInputSettings": return new JObject { ["inputKind"] = "browser_source", ["inputSettings"] = new JObject { ["shutdown"] = Shutdown, ["reroute_audio"] = true } }.ToString();
            case "GetInputMute": return new JObject { ["inputMuted"] = Muted }.ToString();
            case "GetInputAudioMonitorType": return new JObject { ["monitorType"] = Monitor }.ToString();
            case "SetInputMute": CheckInput(data); Muted = (bool)data["inputMuted"]; return "{}";
            case "SetInputAudioMonitorType": CheckInput(data); Monitor = (string)data["monitorType"]; return "{}";
            case "SetSceneItemEnabled":
                var item = Scenes[(string)data["sceneUuid"]].Single(x => (int)x["sceneItemId"] == (int)data["sceneItemId"]);
                if ((string)item["sourceUuid"] != Input) throw new Exception("Wrong source");
                if (!Muted || Monitor != "OBS_MONITORING_TYPE_NONE") throw new Exception("Visibility changed before audio isolation");
                item["sceneItemEnabled"] = data["sceneItemEnabled"].DeepClone(); return "{}";
            default: throw new Exception("Forbidden OBS request: " + method);
        }
    }
    static void CheckInput(JObject data) { if ((string)data["inputUuid"] != Input) throw new Exception("Wrong input UUID"); }
}

public class FakeCompanionHttp : HttpMessageHandler
{
    public readonly Dictionary<string, string> Values = new Dictionary<string, string>();
    public bool Fail;
    public int Posts;
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellation)
    {
        if (request.RequestUri.Authority != "192.168.31.225:8000") throw new Exception("Wrong configured Companion endpoint");
        if (Fail) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
        string key = request.RequestUri.AbsolutePath;
        if (request.Method == HttpMethod.Post) { Values[key] = request.Content.ReadAsStringAsync().Result; Posts++; }
        string value;
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(Values.TryGetValue(key, out value) ? value : "") });
    }
}

public class TestDonationAlertsToggle
{
    static FakeCompanionHttp Feedback;
    static void MockFeedback()
    {
        Feedback = new FakeCompanionHttp();
        typeof(CompanionEndpoint).GetField("cached", BindingFlags.Static | BindingFlags.NonPublic).SetValue(null, "http://192.168.31.225:8000");
        typeof(CompanionEndpoint).GetField("checkedAt", BindingFlags.Static | BindingFlags.NonPublic).SetValue(null, DateTime.UtcNow);
        var field = typeof(CPHInline).GetField("Http", BindingFlags.Static | BindingFlags.NonPublic);
        if (field != null) field.SetValue(null, new HttpClient(Feedback));
    }
    static void Label(string expected, string blocked)
    {
        string value;
        Assert(Feedback.Values.TryGetValue("/api/custom-variable/da_alerts_label/value", out value) && value == "ДОНАТЫ\n" + expected, "verified Companion label " + expected);
        Assert(Feedback.Values.TryGetValue("/api/custom-variable/da_alerts_blocked/value", out value) && value == blocked, "Companion blocked " + blocked);
    }
    static void Assert(bool value, string message) { if (!value) throw new Exception(message); }
    static CPHInline Code(FakeToggleCPH cph) { return new CPHInline { CPH = cph }; }
    static void Panic()
    {
        var cph = new FakeToggleCPH();
        Assert(Code(cph).Execute(), "panic succeeds");
        Assert(cph.Muted, "panic must mute before hiding");
        Assert(cph.Monitor == "OBS_MONITORING_TYPE_NONE", "panic disables local monitoring");
        Assert(cph.Scenes.Values.SelectMany(x => x).All(x => !(bool)x["sceneItemEnabled"]), "all occurrences hidden");
        Assert(cph.Globals.Values.OfType<string>().Any(x => !string.IsNullOrEmpty(x)), "restore snapshot persisted");
        Assert(cph.Writes[0].StartsWith("SetInputMute:"), "mute first");
        Assert(cph.Writes[1].StartsWith("SetInputAudioMonitorType:"), "monitor second");
    }
    static void Restore()
    {
        var cph = new FakeToggleCPH();
        Assert(Code(cph).Execute(), "first panic");
        Assert(Code(cph).Execute(), "restore after host restart");
        Assert(!cph.Muted && cph.Monitor == "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT", "restore original audio");
        Assert((bool)cph.Scenes["game"][0]["sceneItemEnabled"] && !(bool)cph.Scenes["base"][0]["sceneItemEnabled"] && (bool)cph.Scenes["camera"][0]["sceneItemEnabled"], "restore mixed original visibility");
        Assert(cph.Globals.Values.OfType<string>().All(string.IsNullOrEmpty), "clear restore snapshot last");
    }
    static void SilentFailure()
    {
        var cph = new FakeToggleCPH { IgnoreWrites = true };
        Assert(!Code(cph).Execute(), "unapplied OBS writes must fail verification");
        Assert(cph.Globals.Values.OfType<string>().Any(x => !string.IsNullOrEmpty(x)), "failed panic retains recovery");
    }
    static void FeedbackStates()
    {
        MockFeedback();
        var cph = new FakeToggleCPH();
        Assert(Code(cph).Execute(), "panic with feedback"); Label("ВЫКЛ", "1");
        Assert(Code(cph).Execute(), "restore with feedback"); Label("ВКЛ", "0");
        cph.FailOnce = "GetSceneList";
        Assert(!Code(cph).Execute(), "OBS failure"); Label("ОШИБКА", "1");
    }
    static void InitFeedback()
    {
        MockFeedback();
        var cph = new FakeToggleCPH();
        var init = typeof(CPHInline).GetMethod("Init");
        Assert(init != null, "read-only Init feedback sync exists");
        init.Invoke(Code(cph), null); Label("ВКЛ", "0");
        Assert(cph.Writes.Count == 0 && cph.Globals.Count == 0, "Init never mutates OBS or persistent state");
        Assert(Code(cph).Execute(), "panic before Init");
        int writes = cph.Writes.Count;
        init.Invoke(Code(cph), null); Label("ВЫКЛ", "1");
        Assert(cph.Writes.Count == writes, "blocked Init never mutates OBS");
        cph.Muted = false;
        init.Invoke(Code(cph), null); Label("ОШИБКА", "1");
        Assert(cph.Writes.Count == writes, "inconsistent Init only reports error");
    }
    public static void Main()
    {
        MockFeedback();
        Panic(); Console.WriteLine("PASS panic: mute + NONE before all visibility writes; persistent snapshot");
        Restore(); Console.WriteLine("PASS restore: original mixed visibility and audio after host recreation");
        SilentFailure(); Console.WriteLine("PASS silent OBS failure: readback rejects ignored writes; recovery retained");
        FeedbackStates(); Console.WriteLine("PASS feedback: configured endpoint; OFF/ON/ERROR labels and blocked values");
        InitFeedback(); Console.WriteLine("PASS Init: read-only state sync and inconsistent-state warning");
    }
}
