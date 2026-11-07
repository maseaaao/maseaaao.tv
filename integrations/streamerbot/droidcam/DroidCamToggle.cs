using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

// Import with obs-health/CompanionEndpoint.cs into one Execute C# Code sub-action.
public class CPHInline
{
    // Источник DroidCam и его source-clone в коллекции obsmainscenes.
    private const string CameraUuid = "7503a63b-3929-46b3-9a95-cf61ccca44e2";
    private const string CloneUuid = "665bdddb-f41e-468e-a18d-252c85cdbec5";
    private static readonly object Gate = new object();
    private static HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };

    // Обратная связь: droidcam_state = 1/0, droidcam_label = подпись кнопки.
    private void Feedback(bool? on)
    {
        try
        {
            SetVariable("droidcam_state", on == true ? "1" : "0");
            SetVariable("droidcam_label", on == null ? "📷\nОШИБКА" : on == true ? "📷\nВКЛ" : "📷\nВЫКЛ");
        }
        catch (Exception) { CPH.LogWarn("DroidCam Companion feedback unavailable; OBS state was not changed by feedback failure."); }
    }
    private static void SetVariable(string name, string value)
    {
        string url = CompanionEndpoint.Get().TrimEnd('/') + "/api/custom-variable/" + name + "/value";
        using (var content = new StringContent(value, Encoding.UTF8, "text/plain"))
        using (var response = Http.PostAsync(url, content).GetAwaiter().GetResult()) response.EnsureSuccessStatusCode();
        using (var response = Http.GetAsync(url).GetAwaiter().GetResult())
        {
            response.EnsureSuccessStatusCode();
            if (response.Content.ReadAsStringAsync().GetAwaiter().GetResult() != value) throw new InvalidOperationException("Companion feedback readback mismatch.");
        }
    }

    public void Init()
    {
        lock (Gate)
        {
            try { Feedback(ReadState()); }
            catch (Exception) { Feedback(null); }
        }
    }

    public bool Execute()
    {
        lock (Gate)
        {
            try
            {
                var items = FindItems();
                if (items.Count == 0) throw new InvalidOperationException("DroidCam source has no scene items.");
                bool anyVisible = false;
                foreach (JObject item in items) anyVisible |= Required<bool>(item, "enabled");
                bool on = !(anyVisible && ReadActivated());
                if (on)
                {
                    // Сначала показываем элементы: скрытый вход не запускает видео даже после активации.
                    SetVisible(items, true);
                    SetActivated(true);
                }
                else
                {
                    SetActivated(false);
                    SetVisible(items, false);
                }
                Feedback(on);
                return true;
            }
            catch (Exception)
            {
                // Ни URL, ни настройки источника в лог не попадают.
                CPH.LogWarn("DroidCam toggle failed; check the OBS connection, scene collection and the camera source.");
                Feedback(null);
                return false;
            }
        }
    }

    private bool? ReadState()
    {
        bool anyVisible = false;
        foreach (JObject item in FindItems()) anyVisible |= Required<bool>(item, "enabled");
        return anyVisible && ReadActivated();
    }

    private bool ReadActivated()
    {
        var settings = Read("GetInputSettings", new JObject { ["inputUuid"] = CameraUuid });
        if (Required<string>(settings, "inputKind") != "droidcam_obs") throw new InvalidOperationException("Camera input is not a DroidCam source.");
        JToken value = settings["inputSettings"] == null ? null : settings["inputSettings"]["activated"];
        if (value == null || value.Type == JTokenType.Null) throw new InvalidOperationException("DroidCam input has no activated setting.");
        return value.Value<bool>();
    }

    private void SetActivated(bool on)
    {
        Write("SetInputSettings", new JObject
        {
            ["inputUuid"] = CameraUuid,
            ["inputSettings"] = new JObject { ["activated"] = on },
            ["overlay"] = true
        });
        if (ReadActivated() != on) throw new InvalidOperationException("OBS did not apply the DroidCam state.");
    }

    private void SetVisible(JArray items, bool visible)
    {
        foreach (JObject item in items)
        {
            Write("SetSceneItemEnabled", new JObject
            {
                ["sceneUuid"] = item["sceneUuid"],
                ["sceneItemId"] = item["sceneItemId"],
                ["sceneItemEnabled"] = visible
            });
            var check = Read("GetSceneItemEnabled", new JObject { ["sceneUuid"] = item["sceneUuid"], ["sceneItemId"] = item["sceneItemId"] });
            if (Required<bool>(check, "sceneItemEnabled") != visible) throw new InvalidOperationException("OBS did not apply scene item visibility.");
        }
    }

    private static T Required<T>(JObject value, string name)
    {
        if (value == null || value[name] == null || value[name].Type == JTokenType.Null) throw new InvalidOperationException("Missing OBS field.");
        return value[name].Value<T>();
    }
    private JObject Read(string method, JObject data = null)
    {
        var result = JObject.Parse(CPH.ObsSendRaw(method, (data ?? new JObject()).ToString(Formatting.None), 0));
        JToken status = result["requestStatus"];
        if (status != null && status["result"] != null && status["result"].Type == JTokenType.Boolean && !status["result"].Value<bool>())
            throw new InvalidOperationException("OBS request failed.");
        return result;
    }
    private void Write(string method, JObject data) { Read(method, data); }

    private JArray FindItems()
    {
        var items = new JArray();
        var visited = new HashSet<string>(StringComparer.Ordinal);
        foreach (string scene in ListScenes()) ScanScene(scene, false, visited, items);
        return items;
    }

    // Сцены всех канвасов (горизонтальный и Aitum Vertical); старые сборки obs-websocket обслуживает обычный GetSceneList.
    private List<string> ListScenes()
    {
        var scenes = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        JObject canvases = null;
        try { canvases = Read("GetCanvasList"); } catch (Exception) { canvases = null; }
        if (canvases != null && canvases["canvases"] is JArray list && list.Count > 0)
        {
            foreach (JObject canvas in list)
            {
                string uuid = canvas["canvasUuid"] == null ? null : canvas["canvasUuid"].Value<string>();
                var response = string.IsNullOrEmpty(uuid) ? Read("GetSceneList") : Read("GetSceneList", new JObject { ["canvasUuid"] = uuid });
                CollectScenes(response, seen, scenes);
            }
            return scenes;
        }
        CollectScenes(Read("GetSceneList"), seen, scenes);
        return scenes;
    }
    private static void CollectScenes(JObject response, HashSet<string> seen, List<string> scenes)
    {
        if (!(response["scenes"] is JArray list)) throw new InvalidOperationException("OBS returned no scene list.");
        foreach (JObject scene in list)
        {
            string uuid = Required<string>(scene, "sceneUuid");
            if (seen.Add(uuid)) scenes.Add(uuid);
        }
    }

    private void ScanScene(string scene, bool group, HashSet<string> visited, JArray items)
    {
        if (!visited.Add(scene)) return;
        foreach (JObject item in Read(group ? "GetGroupSceneItemList" : "GetSceneItemList", new JObject { ["sceneUuid"] = scene })["sceneItems"])
        {
            string uuid = item["sourceUuid"] == null ? null : item["sourceUuid"].Value<string>();
            if (uuid == CameraUuid || uuid == CloneUuid)
                items.Add(new JObject
                {
                    ["sceneUuid"] = scene,
                    ["sceneItemId"] = Required<int>(item, "sceneItemId"),
                    ["enabled"] = Required<bool>(item, "sceneItemEnabled")
                });
            if (item["isGroup"] != null && item["isGroup"].Type == JTokenType.Boolean && item["isGroup"].Value<bool>() && !string.IsNullOrEmpty(uuid))
                ScanScene(uuid, true, visited, items);
        }
    }
}
