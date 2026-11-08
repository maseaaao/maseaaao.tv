using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;

internal static class TestCameraPresentation
{
    public static void Run()
    {
        foreach (double y in new[] { 96.5, 551.25, 1006.0 })
        {
            var transforms = new Dictionary<int, JObject>();
            var filters = new Dictionary<string, JObject>();
            var items = new JArray();
            string[] names = { "КАМЕРА [clone]", "ДОНАТЕРЫ", "СОЦСЕТИ — ПОЛОСА — КАМЕРА+ИГРА (Г)", "ЧТО ИГРАЕТ" };
            double[] positions = { y, y - 64.5, y + 270, y + 306 };
            for (int n = 0; n < names.Length; n++)
            {
                items.Add(new JObject { ["sourceName"] = names[n], ["sceneItemId"] = n });
                transforms[n] = new JObject { ["positionX"] = 32, ["positionY"] = positions[n], ["height"] = n == 0 ? 270 : 64.5, ["scaleX"] = 0.25, ["scaleY"] = 0.25, ["boundsWidth"] = 0, ["boundsHeight"] = 0, ["rotation"] = 0, ["cropLeft"] = 0, ["cropTop"] = 0, ["cropRight"] = 0, ["cropBottom"] = 0 };
            }
            Func<string, JObject, JObject> obs = (method, data) =>
            {
                string filter = (string)data["filterName"];
                switch (method)
                {
                    case "GetSceneItemList": return new JObject { ["sceneItems"] = items.DeepClone() };
                    case "GetSourceFilterList":
                        var list = new JArray();
                        foreach (string key in filters.Keys) list.Add(new JObject { ["filterName"] = key });
                        return new JObject { ["filters"] = list };
                    case "GetSceneItemTransform": return new JObject { ["sceneItemTransform"] = transforms[(int)data["sceneItemId"]].DeepClone() };
                    case "CreateSourceFilter": filters.Add(filter, (JObject)data["filterSettings"].DeepClone()); return new JObject();
                    case "SetSourceFilterSettings": filters[filter].Merge(data["filterSettings"]); return new JObject();
                    case "SetSourceFilterEnabled":
                        if ((bool)data["filterEnabled"])
                        {
                            var settings = filters[filter];
                            int index = Array.IndexOf(names, (string)settings["source"]);
                            transforms[index]["positionY"] = settings["pos"]["y"].DeepClone();
                            transforms[index]["scaleY"] = settings["scale"]["y"].DeepClone();
                        }
                        return new JObject();
                    default: throw new Exception("Unexpected presentation request: " + method);
                }
            };
            var presentation = new CameraPresentation(obs);
            presentation.Prepare(new[] { "game" });
            if (filters.Count != 8 || (double)transforms[0]["positionY"] != y) throw new Exception("Preparation changed the active layout.");
            presentation.Apply(false);
            if (Math.Abs((double)transforms[1]["positionY"] + 64.5 - (double)transforms[2]["positionY"]) > 0.001) throw new Exception("Collapsed donors and socials are separated.");
            if ((double)transforms[0]["scaleY"] >= 0.001) throw new Exception("Camera did not collapse.");
            // Re-prepare while collapsed, like a new Action instance after OBS restart.
            presentation = new CameraPresentation(obs);
            presentation.Prepare(new[] { "game" });
            presentation.Apply(true);
            for (int i = 0; i < positions.Length; i++)
                if (Math.Abs((double)transforms[i]["positionY"] - positions[i]) > 0.001) throw new Exception("Layout drift after restoring camera.");
        }
        Console.WriteLine("PASS presentation: top/center/bottom collapse, adjacent donors/socials, restart and exact restore");
    }
}
