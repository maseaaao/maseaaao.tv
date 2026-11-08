using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json.Linq;

// Import beside DroidCamToggle.cs. Move Source renders the animation inside OBS.
public sealed class CameraPresentation
{
    public const int Duration = 350;
    public const string Placeholder = "КАМЕРА — ЗАГЛУШКА";
    public const string Artwork = "КАТЕГОРИЯ — АРТ 16:9";
    private const string Prefix = "CAM — ";
    private readonly Func<string, JObject, JObject> Obs;
    private readonly List<string> Gameplay = new List<string>();
    private readonly List<Tuple<string, int>> Placeholders = new List<Tuple<string, int>>();
    public CameraPresentation(Func<string, JObject, JObject> obs) { Obs = obs; }

    public static List<string> ListScenes(Func<string, JObject, JObject> obs)
    {
        var scenes = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        JObject canvases = null;
        try { canvases = obs("GetCanvasList", new JObject()); } catch (Exception) { }
        var requests = new List<JObject>();
        var list = canvases?["canvases"] as JArray;
        if (list != null && list.Count > 0)
            foreach (JObject canvas in list) requests.Add(new JObject { ["canvasUuid"] = canvas["canvasUuid"] });
        else requests.Add(new JObject());
        foreach (var request in requests)
            foreach (JObject scene in (JArray)obs("GetSceneList", request)["scenes"])
            {
                string uuid = (string)scene["sceneUuid"];
                if (string.IsNullOrEmpty(uuid)) throw new InvalidOperationException("Missing scene UUID.");
                if (seen.Add(uuid)) scenes.Add(uuid);
            }
        return scenes;
    }

    public void Prepare(IEnumerable<string> scenes)
    {
        foreach (string scene in scenes)
        {
            var items = (JArray)Obs("GetSceneItemList", new JObject { ["sceneUuid"] = scene })["sceneItems"];
            JObject camera = null, donors = null, social = null, music = null;
            bool verticalGame = false, cameraScene = false;
            foreach (JObject item in items)
            {
                string name = (string)item["sourceName"];
                if (name == "КАМЕРА" || name == "КАМЕРА [clone]") camera = item;
                if (name == "ДОНАТЕРЫ") donors = item;
                if (name == "ЧТО ИГРАЕТ") music = item;
                if (name == "СОЦСЕТИ — ПОЛОСА — КАМЕРА+ИГРА (Г)") social = item;
                if (name == "СОЦСЕТИ — ПОЛОСА — КАМЕРА (Г)" || name == "ЧАТ") cameraScene = true;
                if (name == "ЭКРАН") verticalGame = true;
            }
            if (camera == null) continue;
            if (social != null && donors != null && music != null)
            {
                Gameplay.Add(scene);
                // Existing filters are the persistent full-size layout, even after OBS restarts collapsed.
                var filters = (JArray)Obs("GetSourceFilterList", new JObject { ["sourceUuid"] = scene })["filters"];
                bool prepared = false;
                foreach (JObject filter in filters) if ((string)filter["filterName"] == Prefix + "OFF — CAMERA") prepared = true;
                if (prepared) continue;
                var ct = Transform(scene, camera);
                double height = (double)ct["height"], y = (double)ct["positionY"];
                double anchor = y < 300 ? 0 : y > 850 ? 1 : 0.5;
                foreach (bool on in new[] { false, true })
                {
                    AddMove(scene, camera, "CAMERA", ct, on, on ? 0 : height * anchor, true);
                    AddMove(scene, donors, "DONORS", Transform(scene, donors), on, on ? 0 : height * anchor, false);
                    AddMove(scene, social, "SOCIAL", Transform(scene, social), on, on ? 0 : height * (anchor - 1), false);
                    AddMove(scene, music, "MUSIC", Transform(scene, music), on, on ? 0 : height * (anchor - 1), false);
                }
            }
            else if (cameraScene || verticalGame)
            {
                string source = verticalGame && !cameraScene ? Artwork : Placeholder;
                int id = EnsureUnderlay(scene, source, camera, items);
                if (source == Placeholder) Placeholders.Add(Tuple.Create(scene, id));
            }
        }
    }

    private JObject Transform(string scene, JObject item)
    {
        return (JObject)Obs("GetSceneItemTransform", new JObject { ["sceneUuid"] = scene, ["sceneItemId"] = item["sceneItemId"] })["sceneItemTransform"];
    }

    private void AddMove(string scene, JObject item, string label, JObject transform, bool on, double dy, bool camera)
    {
        var settings = new JObject
        {
            ["source"] = item["sourceName"], ["custom_duration"] = true, ["duration"] = Duration,
            ["easing_match"] = 3, ["easing_function_match"] = 2, ["transform"] = true,
            ["enabled_match_moving"] = false, ["start_trigger"] = 0,
            ["pos"] = new JObject { ["x"] = transform["positionX"], ["y"] = (double)transform["positionY"] + dy },
            ["scale"] = new JObject { ["x"] = transform["scaleX"], ["y"] = camera && !on ? 0.0001 : (double)transform["scaleY"] },
            ["bounds"] = new JObject { ["x"] = transform["boundsWidth"], ["y"] = transform["boundsHeight"] },
            ["rot"] = transform["rotation"],
            ["crop"] = new JObject { ["left"] = transform["cropLeft"], ["top"] = transform["cropTop"], ["right"] = transform["cropRight"], ["bottom"] = transform["cropBottom"] },
            ["change_visibility"] = camera ? (on ? 1 : 2) : 0
        };
        Obs("CreateSourceFilter", new JObject { ["sourceUuid"] = scene, ["filterName"] = Prefix + (on ? "ON" : "OFF") + " — " + label, ["filterKind"] = "move_source_filter", ["filterSettings"] = settings });
        string name = Prefix + (on ? "ON" : "OFF") + " — " + label;
        Obs("SetSourceFilterEnabled", new JObject { ["sourceUuid"] = scene, ["filterName"] = name, ["filterEnabled"] = false });
        Obs("SetSourceFilterSettings", new JObject { ["sourceUuid"] = scene, ["filterName"] = name, ["filterSettings"] = new JObject { ["enabled_match_moving"] = true, ["start_trigger"] = 5 } });
    }

    private int EnsureUnderlay(string scene, string name, JObject camera, JArray items)
    {
        foreach (JObject item in items) if ((string)item["sourceName"] == name) return (int)item["sceneItemId"];
        string path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "custom", "assets", "camera", "cam-pug.jpg");
        if (!File.Exists(path)) throw new FileNotFoundException("Install custom/assets/camera/cam-pug.jpg before configuring camera presentation.");
        int id;
        bool exists = false;
        foreach (JObject input in (JArray)Obs("GetInputList", new JObject())["inputs"]) if ((string)input["inputName"] == name) exists = true;
        if (exists)
            id = (int)Obs("CreateSceneItem", new JObject { ["sceneUuid"] = scene, ["sourceName"] = name, ["sceneItemEnabled"] = true })["sceneItemId"];
        else
            id = (int)Obs("CreateInput", new JObject { ["sceneUuid"] = scene, ["inputName"] = name, ["inputKind"] = "image_source", ["inputSettings"] = new JObject { ["file"] = path }, ["sceneItemEnabled"] = true })["sceneItemId"];
        var transform = Transform(scene, camera);
        // A 16:9 image fits the camera rectangle without inheriting camera-specific crops.
        var fit = new JObject { ["positionX"] = transform["positionX"], ["positionY"] = transform["positionY"], ["alignment"] = 5, ["boundsType"] = "OBS_BOUNDS_SCALE_OUTER", ["boundsWidth"] = Math.Abs((double)transform["width"]), ["boundsHeight"] = Math.Abs((double)transform["height"]), ["boundsAlignment"] = 0, ["cropToBounds"] = true };
        Obs("SetSceneItemTransform", new JObject { ["sceneUuid"] = scene, ["sceneItemId"] = id, ["sceneItemTransform"] = fit });
        Obs("SetSceneItemIndex", new JObject { ["sceneUuid"] = scene, ["sceneItemId"] = id, ["sceneItemIndex"] = camera["sceneItemIndex"] });
        return id;
    }

    public void Apply(bool on)
    {
        foreach (string scene in Gameplay)
        {
            foreach (string label in new[] { "CAMERA", "DONORS", "SOCIAL", "MUSIC" })
            {
                // Disable the opposite direction first, including a move interrupted by a rapid toggle.
                foreach (bool direction in new[] { !on, on })
                    Obs("SetSourceFilterEnabled", new JObject { ["sourceUuid"] = scene, ["filterName"] = Prefix + (direction ? "ON" : "OFF") + " — " + label, ["filterEnabled"] = direction == on });
            }
        }
        foreach (var item in Placeholders)
            Obs("SetSceneItemEnabled", new JObject { ["sceneUuid"] = item.Item1, ["sceneItemId"] = item.Item2, ["sceneItemEnabled"] = !on });
    }
}
