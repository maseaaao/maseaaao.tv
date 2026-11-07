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
    public class CPHInlineBase { public FakeDroidCamCPH CPH; }
}

public class FakeDroidCamCPH
{
    public const string Camera = "7503a63b-3929-46b3-9a95-cf61ccca44e2";
    public const string Clone = "665bdddb-f41e-468e-a18d-252c85cdbec5";
    public const string Group = "11111111-2222-3333-4444-555555555555";

    public readonly List<string> Writes = new List<string>();
    public readonly Dictionary<string, JArray> Items = new Dictionary<string, JArray>
    {
        { "scene:camera", new JArray(Item(Camera, 1, true)) },
        { "scene:game", new JArray(Item(Clone, 2, true), GroupItem(9)) },
        { "scene:v1", new JArray(Item(Clone, 3, true)) },
        { Group, new JArray(Item(Camera, 4, false)) }
    };
    public readonly Dictionary<string, string[]> CanvasScenes = new Dictionary<string, string[]>
    {
        { "canvas:main", new[] { "scene:camera", "scene:game" } },
        { "canvas:vertical", new[] { "scene:v1" } }
    };
    public bool Activated = true;
    public bool Canvases = true;
    public bool IgnoreWrites;
    public string FailOnce;

    public static JObject Item(string source, int id, bool enabled)
    {
        return new JObject { ["sourceUuid"] = source, ["sceneItemId"] = id, ["sceneItemEnabled"] = enabled, ["isGroup"] = false };
    }
    public static JObject GroupItem(int id)
    {
        return new JObject { ["sourceUuid"] = Group, ["sceneItemId"] = id, ["sceneItemEnabled"] = true, ["isGroup"] = true };
    }
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
            case "GetCanvasList":
                if (!Canvases) throw new Exception("Unsupported request");
                return new JObject { ["canvases"] = new JArray(CanvasScenes.Keys.Select(k => new JObject { ["canvasUuid"] = k, ["canvasName"] = k })) }.ToString();
            case "GetSceneList":
                var canvas = (string)data["canvasUuid"];
                var names = canvas == null ? CanvasScenes["canvas:main"] : CanvasScenes[canvas];
                return new JObject { ["scenes"] = new JArray(names.Select(n => new JObject { ["sceneUuid"] = n, ["sceneName"] = n })) }.ToString();
            case "GetSceneItemList":
            case "GetGroupSceneItemList":
                return new JObject { ["sceneItems"] = Items[(string)data["sceneUuid"]].DeepClone() }.ToString();
            case "GetSceneItemEnabled":
                return new JObject { ["sceneItemEnabled"] = Items[(string)data["sceneUuid"]].Single(x => (int)x["sceneItemId"] == (int)data["sceneItemId"])["sceneItemEnabled"].DeepClone() }.ToString();
            case "GetInputSettings":
                if ((string)data["inputUuid"] != Camera) throw new Exception("Wrong input UUID");
                return new JObject { ["inputKind"] = "droidcam_obs", ["inputSettings"] = new JObject { ["activated"] = Activated } }.ToString();
            case "SetInputSettings":
                if ((string)data["inputUuid"] != Camera) throw new Exception("Wrong input UUID");
                if (!(bool)data["overlay"]) throw new Exception("Settings must be merged");
                Activated = (bool)data["inputSettings"]["activated"];
                return "{}";
            case "SetSceneItemEnabled":
            {
                var list = Items[(string)data["sceneUuid"]];
                var item = list.Single(x => (int)x["sceneItemId"] == (int)data["sceneItemId"]);
                item["sceneItemEnabled"] = data["sceneItemEnabled"].DeepClone();
                return "{}";
            }
            default: throw new Exception("Forbidden OBS request: " + method);
        }
    }
}

public class FakeDroidCamHttp : HttpMessageHandler
{
    public readonly Dictionary<string, string> Values = new Dictionary<string, string>();
    public bool Fail;
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellation)
    {
        if (request.RequestUri.Authority != "192.168.31.225:8000") throw new Exception("Wrong configured Companion endpoint");
        if (Fail) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
        string key = request.RequestUri.AbsolutePath;
        if (request.Method == HttpMethod.Post) Values[key] = request.Content.ReadAsStringAsync().Result;
        string value;
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(Values.TryGetValue(key, out value) ? value : "") });
    }
}

public class TestDroidCamToggle
{
    static FakeDroidCamHttp Feedback;

    static void MockFeedback()
    {
        Feedback = new FakeDroidCamHttp();
        typeof(CompanionEndpoint).GetField("cached", BindingFlags.Static | BindingFlags.NonPublic).SetValue(null, "http://192.168.31.225:8000");
        typeof(CompanionEndpoint).GetField("checkedAt", BindingFlags.Static | BindingFlags.NonPublic).SetValue(null, DateTime.UtcNow);
        var field = typeof(CPHInline).GetField("Http", BindingFlags.Static | BindingFlags.NonPublic);
        if (field != null) field.SetValue(null, new HttpClient(Feedback));
    }
    static void Assert(bool value, string message) { if (!value) throw new Exception(message); }
    static CPHInline Code(FakeDroidCamCPH cph) { return new CPHInline { CPH = cph }; }
    static void Label(string state, string text)
    {
        string value;
        Assert(Feedback.Values.TryGetValue("/api/custom-variable/droidcam_state/value", out value) && value == state, "Companion state " + state);
        Assert(Feedback.Values.TryGetValue("/api/custom-variable/droidcam_label/value", out value) && value == "📷\n" + text, "Companion label " + text);
    }
    static bool AllItems(FakeDroidCamCPH cph, bool enabled)
    {
        return cph.Items["scene:camera"][0]["sceneItemEnabled"].Value<bool>() == enabled
            && cph.Items["scene:game"][0]["sceneItemEnabled"].Value<bool>() == enabled
            && cph.Items["scene:v1"][0]["sceneItemEnabled"].Value<bool>() == enabled;
    }
    static void Init() { MockFeedback(); }

    static void TurnOff()
    {
        Init();
        var cph = new FakeDroidCamCPH();
        Assert(Code(cph).Execute(), "turn off succeeds");
        Assert(!cph.Activated, "DroidCam input deactivated");
        Assert(AllItems(cph, false), "camera hidden in every scene and canvas");
        Assert(cph.Writes[0].StartsWith("SetInputSettings:"), "deactivate before hiding");
        Label("0", "ВЫКЛ");
    }

    static void TurnOn()
    {
        Init();
        var cph = new FakeDroidCamCPH { Activated = false };
        foreach (var scene in new[] { "scene:camera", "scene:game", "scene:v1" })
            foreach (JObject item in cph.Items[scene]) item["sceneItemEnabled"] = false;
        Assert(Code(cph).Execute(), "turn on succeeds");
        Assert(cph.Activated, "DroidCam input activated");
        Assert(AllItems(cph, true), "camera shown in every scene and canvas");
        Assert(cph.Writes.Last().StartsWith("SetInputSettings:"), "activate after showing: hidden source never starts video");
        Label("1", "ВКЛ");
    }

    static void ReadOnlyInit()
    {
        Init();
        var cph = new FakeDroidCamCPH();
        var init = typeof(CPHInline).GetMethod("Init");
        Assert(init != null, "read-only Init sync exists");
        init.Invoke(Code(cph), null);
        Label("1", "ВКЛ");
        Assert(cph.Writes.Count == 0, "Init never mutates OBS");
        cph.Activated = false;
        init.Invoke(Code(cph), null);
        Label("0", "ВЫКЛ");
        Assert(cph.Writes.Count == 0, "Init never mutates OBS");
    }

    static void SilentFailure()
    {
        Init();
        var cph = new FakeDroidCamCPH { IgnoreWrites = true };
        Assert(!Code(cph).Execute(), "unapplied OBS writes must fail verification");
        Label("0", "ОШИБКА");
    }

    static void ObsFailure()
    {
        Init();
        var cph = new FakeDroidCamCPH { FailOnce = "GetSceneList" };
        cph.Canvases = false;
        Assert(!Code(cph).Execute(), "OBS failure reported");
        Label("0", "ОШИБКА");
    }

    static void NoCanvasFallback()
    {
        Init();
        var cph = new FakeDroidCamCPH { Canvases = false };
        Assert(Code(cph).Execute(), "falls back to plain GetSceneList");
        Assert(!cph.Items["scene:camera"][0]["sceneItemEnabled"].Value<bool>(), "main-canvas camera hidden without canvas support");
        Assert(!cph.Items["scene:game"][0]["sceneItemEnabled"].Value<bool>(), "main-canvas clone hidden without canvas support");
        Assert(cph.Items["scene:v1"][0]["sceneItemEnabled"].Value<bool>(), "vertical canvas needs GetCanvasList: untouched in fallback");
    }

    static void GroupNesting()
    {
        Init();
        var cph = new FakeDroidCamCPH();
        cph.Items["scene:game"] = new JArray(FakeDroidCamCPH.GroupItem(9));
        cph.Items[FakeDroidCamCPH.Group] = new JArray(FakeDroidCamCPH.Item(FakeDroidCamCPH.Camera, 4, true));
        Assert(Code(cph).Execute(), "group nesting scanned");
        Assert(!cph.Items[FakeDroidCamCPH.Group][0]["sceneItemEnabled"].Value<bool>(), "camera inside a group hidden");
    }

    public static void Main()
    {
        MockFeedback();
        TurnOff(); Console.WriteLine("PASS off: deactivate then hide every camera item");
        TurnOn(); Console.WriteLine("PASS on: show every camera item then activate");
        ReadOnlyInit(); Console.WriteLine("PASS Init: read-only state sync");
        SilentFailure(); Console.WriteLine("PASS silent OBS failure: readback rejects ignored writes");
        ObsFailure(); Console.WriteLine("PASS OBS failure: error label");
        NoCanvasFallback(); Console.WriteLine("PASS fallback: GetCanvasList unsupported");
        GroupNesting(); Console.WriteLine("PASS groups: nested camera item toggled");
    }
}
