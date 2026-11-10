using System;
using System.Globalization;
using Newtonsoft.Json.Linq;

// Action "AI Moderation | Ручное": owner-only operations with explicit arguments.
// moderationOperation = allow | block | retry | stop | resume
// moderationPlatform + moderationId are required for allow/block/retry.
public class CPHInline
{
    private const string CommandKey = "aiModeration.command.v1";
    private static readonly object CommandGate = new object();

    public bool Execute()
    {
        lock (CommandGate)
        {
            return Run();
        }
    }

    private bool Run()
    {
        string operation = Arg("moderationOperation");
        if (operation == "stop") return CPH.ExecuteMethod("AI Moderation Engine", "StopOutput");
        if (operation == "resume") return CPH.ExecuteMethod("AI Moderation Engine", "ResumeOutput");
        if (operation != "allow" && operation != "block" && operation != "retry" && operation != "replay") return false;
        string platform = Arg("moderationPlatform");
        string id = Arg("moderationId");
        if (string.IsNullOrWhiteSpace(platform) || string.IsNullOrWhiteSpace(id)) return false;
        var payload = new JObject
        {
            ["operation"] = operation,
            ["platform"] = platform,
            ["id"] = id
        };
        CPH.SetGlobalVar(CommandKey, payload.ToString(Newtonsoft.Json.Formatting.None), false);
        return CPH.ExecuteMethod("AI Moderation Engine", "RunCommand");
    }

    private string Arg(string key)
    {
        object value;
        return CPH.TryGetArg(key, out value) && value != null
            ? Convert.ToString(value, CultureInfo.InvariantCulture)
            : "";
    }
}
