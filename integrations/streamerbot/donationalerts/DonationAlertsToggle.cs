using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

// Import with obs-health/CompanionEndpoint.cs into one Execute C# Code sub-action.
public class CPHInline
{
    private const string InputUuid = "2f2c20ab-4450-4c45-b1a1-dc6a5eb236f5";
    private const string SnapshotKey = "donationalerts.panic.snapshot.v1";
    private const string NoMonitoring = "OBS_MONITORING_TYPE_NONE";
    private static readonly object Gate = new object();
    private static HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };

    private void Feedback(bool blocked, bool error = false)
    {
        try
        {
            if (blocked) SetVariable("da_alerts_blocked", "1");
            SetVariable("da_alerts_label", "ДОНАТЫ\n" + (error ? "ОШИБКА" : blocked ? "ВЫКЛ" : "ВКЛ"));
            if (!blocked) SetVariable("da_alerts_blocked", "0");
        }
        catch (Exception) { CPH.LogWarn("DonationAlerts Companion feedback unavailable; OBS state was not changed by feedback failure."); }
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
            try
            {
                var items = FindItems();
                bool muted = Required<bool>(Read("GetInputMute", Input()), "inputMuted");
                string monitor = Required<string>(Read("GetInputAudioMonitorType", Input()), "monitorType");
                bool blocked = !string.IsNullOrWhiteSpace(CPH.GetGlobalVar<string>(SnapshotKey, true));
                bool anyVisible = false;
                foreach (JObject item in items) anyVisible |= Required<bool>(item, "enabled");
                bool error = items.Count == 0 || (blocked ? !muted || monitor != NoMonitoring || anyVisible : muted || !anyVisible);
                Feedback(blocked || error, error);
            }
            catch (Exception) { Feedback(true, true); }
        }
    }

    public bool Execute()
    {
        lock (Gate)
        {
            try
            {
                string collection = Required<string>(Read("GetSceneCollectionList"), "currentSceneCollectionName");
                var settings = Read("GetInputSettings", new JObject { ["inputUuid"] = InputUuid });
                if (Required<string>(settings, "inputKind") != "browser_source" || (bool?)settings["inputSettings"]["shutdown"] == true)
                    throw new InvalidOperationException("Browser must remain running while hidden.");
                var items = FindItems();
                if (items.Count == 0) throw new InvalidOperationException("Donation browser has no scene items.");
                string stored = CPH.GetGlobalVar<string>(SnapshotKey, true);
                if (!string.IsNullOrWhiteSpace(stored))
                {
                    var saved = JObject.Parse(stored);
                    if (Required<string>(saved, "collection") != collection) throw new InvalidOperationException("Scene collection changed.");
                    var savedItems = (JArray)saved["items"];
                    foreach (JObject previous in savedItems)
                    {
                        bool found = false;
                        foreach (JObject current in items)
                            if ((string)current["sceneUuid"] == (string)previous["sceneUuid"] && (int)current["sceneItemId"] == (int)previous["sceneItemId"]) found = true;
                        if (!found) throw new InvalidOperationException("Saved scene item missing or replaced.");
                    }
                    Write("SetInputMute", new JObject { ["inputUuid"] = InputUuid, ["inputMuted"] = true });
                    Write("SetInputAudioMonitorType", new JObject { ["inputUuid"] = InputUuid, ["monitorType"] = NoMonitoring });
                    foreach (JObject previous in savedItems)
                        Write("SetSceneItemEnabled", new JObject { ["sceneUuid"] = previous["sceneUuid"], ["sceneItemId"] = previous["sceneItemId"], ["sceneItemEnabled"] = Required<bool>(previous, "enabled") });
                    Write("SetInputAudioMonitorType", new JObject { ["inputUuid"] = InputUuid, ["monitorType"] = Required<string>(saved, "monitor") });
                    Write("SetInputMute", new JObject { ["inputUuid"] = InputUuid, ["inputMuted"] = Required<bool>(saved, "muted") });
                    CPH.SetGlobalVar(SnapshotKey, "", true);
                    Feedback(false);
                    return true;
                }
                var snapshot = new JObject
                {
                    ["collection"] = collection,
                    ["muted"] = Required<bool>(Read("GetInputMute", Input()), "inputMuted"),
                    ["monitor"] = Required<string>(Read("GetInputAudioMonitorType", Input()), "monitorType"),
                    ["items"] = items
                };
                CPH.SetGlobalVar(SnapshotKey, snapshot.ToString(Formatting.None), true);
                Write("SetInputMute", new JObject { ["inputUuid"] = InputUuid, ["inputMuted"] = true });
                Write("SetInputAudioMonitorType", new JObject { ["inputUuid"] = InputUuid, ["monitorType"] = NoMonitoring });
                foreach (JObject item in items)
                    Write("SetSceneItemEnabled", new JObject { ["sceneUuid"] = item["sceneUuid"], ["sceneItemId"] = item["sceneItemId"], ["sceneItemEnabled"] = false });
                Feedback(true);
                return true;
            }
            catch (Exception)
            {
                // Never log response bodies: browser settings can contain private URLs.
                CPH.LogWarn("DonationAlerts toggle failed; persistent restore state retained. Check OBS connection and scene collection.");
                Feedback(true, true);
                return false;
            }
        }
    }

    private static JObject Input() { return new JObject { ["inputUuid"] = InputUuid }; }
    private static T Required<T>(JObject value, string name)
    {
        if (value[name] == null || value[name].Type == JTokenType.Null) throw new InvalidOperationException("Missing OBS field.");
        return value[name].Value<T>();
    }
    private JObject Read(string method, JObject data = null)
    {
        var result = JObject.Parse(CPH.ObsSendRaw(method, (data ?? new JObject()).ToString(Formatting.None), 0));
        if ((bool?)result["requestStatus"]?["result"] == false) throw new InvalidOperationException("OBS request failed.");
        return result;
    }
    private void Write(string method, JObject data)
    {
        Read(method, data);
        string readMethod = method.Replace("Set", "Get");
        string field = method == "SetInputMute" ? "inputMuted" : method == "SetInputAudioMonitorType" ? "monitorType" : "sceneItemEnabled";
        JObject query = method == "SetSceneItemEnabled" ? new JObject { ["sceneUuid"] = data["sceneUuid"], ["sceneItemId"] = data["sceneItemId"] } : Input();
        if (!JToken.DeepEquals(Read(readMethod, query)[field], data[field])) throw new InvalidOperationException("OBS write did not apply.");
    }
    private JArray FindItems()
    {
        var items = new JArray();
        var visited = new HashSet<string>(StringComparer.Ordinal);
        foreach (JObject scene in Read("GetSceneList")["scenes"])
            FindScene(Required<string>(scene, "sceneUuid"), false, visited, items);
        return items;
    }
    private void FindScene(string scene, bool group, HashSet<string> visited, JArray items)
    {
        if (!visited.Add(scene)) return;
        foreach (JObject item in Read(group ? "GetGroupSceneItemList" : "GetSceneItemList", new JObject { ["sceneUuid"] = scene })["sceneItems"])
        {
            if ((string)item["sourceUuid"] == InputUuid)
                items.Add(new JObject { ["sceneUuid"] = scene, ["sceneItemId"] = Required<int>(item, "sceneItemId"), ["enabled"] = Required<bool>(item, "sceneItemEnabled") });
            if ((bool?)item["isGroup"] == true) FindScene(Required<string>(item, "sourceUuid"), true, visited, items);
        }
    }
}
