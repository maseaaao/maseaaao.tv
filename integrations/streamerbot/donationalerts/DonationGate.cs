using System;
using System.Globalization;
using System.IO;
using Newtonsoft.Json.Linq;

// DonationHandler_After: put the event into the moderation queue. It never sends to chat,
// OBS or TTS itself; the shared host releases only an allowed item.
public class CPHInline
{
    private const string IntakeKey = "aiModeration.intake.v1";
    private static readonly object IntakeGate = new object();

    public bool Execute()
    {
        // The default queue may run donations concurrently; serialize the short hand-off.
        lock (IntakeGate)
        {
            return Enqueue();
        }
    }

    private bool Enqueue()
    {
        string id = Arg("daId");
        string amount = Arg("daAmount");
        string currency = Arg("daCurrency");
        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(amount) || string.IsNullOrWhiteSpace(currency))
        {
            CPH.LogWarn("AI moderation: donation is missing id, amount or currency; event withheld.");
            return false;
        }
        string type = Arg("daType");
        string username = Arg("daUsername");
        if (string.IsNullOrWhiteSpace(username) || username == "Anonymous") username = "Аноним";
        string audioPath = type == "audio" ? PreserveAudio(Arg("daAudio")) : "";
        var payload = new JObject
        {
            ["id"] = id,
            ["platform"] = "donationalerts",
            ["kind"] = type == "audio" ? "audio" : "text",
            ["username"] = username,
            ["message"] = type == "audio" ? "[голосовое сообщение]" : Arg("daMessage"),
            ["amount"] = amount,
            ["currency"] = currency,
            ["convertedAmount"] = Arg("daAmountConverted"),
            ["audioPath"] = audioPath
        };
        CPH.SetGlobalVar(IntakeKey, payload.ToString(Newtonsoft.Json.Formatting.None), false);
        bool queued = CPH.ExecuteMethod("AI Moderation Engine", "EnqueueIntake");
        if (!queued) CPH.LogWarn("AI moderation: event was not queued; nothing was released.");
        return queued;
    }

    private string Arg(string key)
    {
        object value;
        return CPH.TryGetArg(key, out value) && value != null
            ? Convert.ToString(value, CultureInfo.InvariantCulture)
            : "";
    }

    private static string PreserveAudio(string source)
    {
        if (string.IsNullOrWhiteSpace(source) || !File.Exists(source)) return "";
        try
        {
            var info = new FileInfo(source);
            if (info.Length <= 0 || info.Length > 50L * 1024 * 1024) return "";
            string directory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "maseaaao.tv", "moderation", "audio");
            Directory.CreateDirectory(directory);
            // The provider id is untrusted; generate the local filename instead of using it verbatim.
            string target = Path.Combine(directory, Guid.NewGuid().ToString("N") + Path.GetExtension(source));
            File.Copy(source, target, false);
            return target;
        }
        catch (Exception) { return ""; }
    }
}
