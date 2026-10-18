using System;
using System.Globalization;
using System.Text.RegularExpressions;

public class CPHInline
{
    public bool Execute()
    {
        string amount = Arg("daAmount");
        string currency = Arg("daCurrency");
        if (string.IsNullOrWhiteSpace(amount) || string.IsNullOrWhiteSpace(currency))
        {
            CPH.LogWarn("DonationAlerts: missing donation amount/currency; message skipped.");
            return false;
        }
        string name = Arg("daUsername");
        if (string.IsNullOrWhiteSpace(name) || name == "Anonymous") name = "Аноним";
        string content = Arg("daType") == "audio" ? "[голосовое сообщение]" : Arg("daMessage");
        string message = "💰 " + Clean(name, 60) + " — " + Clean(amount, 30) + " " + Clean(currency, 10);
        if (!string.IsNullOrWhiteSpace(content)) message += ": " + Clean(content, 400);
        bool sent = false;
        try
        {
            if (CPH.TwitchGetBroadcaster() != null)
            {
                CPH.SendMessage(Shorten(message, 490), true, true);
                sent = true;
            }
        }
        catch (Exception ex) { CPH.LogWarn("DonationAlerts: Twitch send failed: " + ex.Message); }
        try
        {
            var broadcast = CPH.YouTubeGetLatestMonitoredBroadcast();
            if (broadcast != null && broadcast.Status == "live" && !string.IsNullOrWhiteSpace(broadcast.LiveChatId))
            {
                CPH.SendYouTubeMessage(Shorten(message, 195), true, true, broadcast.Id);
                sent = true;
            }
        }
        catch (Exception ex) { CPH.LogWarn("DonationAlerts: YouTube send failed: " + ex.Message); }
        return sent;
    }

    private string Arg(string key)
    {
        object value;
        return CPH.TryGetArg(key, out value) && value != null ? Convert.ToString(value, CultureInfo.InvariantCulture) : "";
    }

    private static string Clean(string value, int limit)
    {
        return Shorten(Regex.Replace(value ?? "", @"\s+", " ").Trim(), limit);
    }

    private static string Shorten(string value, int limit)
    {
        if (value.Length <= limit) return value;
        int end = limit - 1;
        if (char.IsHighSurrogate(value[end - 1])) end--;
        return value.Substring(0, end) + "…";
    }
}
