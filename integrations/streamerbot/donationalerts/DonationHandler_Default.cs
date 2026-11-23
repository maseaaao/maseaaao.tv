using System;

public class CPHInline
{
    public bool Execute()
    {
        string username = Arg("daUsername");
        if (string.IsNullOrWhiteSpace(username) || username == "Anonymous") username = "Аноним";
        string amount = Arg("daAmount");
        string currency = Arg("daCurrency");
        string message = Arg("daMessage");
        string text = "💰 " + username + " — " + amount + " " + currency;
        if (!string.IsNullOrWhiteSpace(message)) text += ": " + message;

        try
        {
            var broadcast = CPH.YouTubeGetLatestMonitoredBroadcast();
            if (broadcast != null && broadcast.Status == "live" && !string.IsNullOrWhiteSpace(broadcast.LiveChatId))
                CPH.SendYouTubeMessage(Shorten(text, 190), true, true, broadcast.Id);
        }
        catch (Exception ex) { CPH.LogWarn("Donation chat (YouTube): " + ex.Message); }

        try
        {
            if (CPH.TwitchGetBroadcaster() != null)
                CPH.SendMessage(Shorten(text, 480), true, true);
        }
        catch (Exception ex) { CPH.LogWarn("Donation chat (Twitch): " + ex.Message); }

        return true;
    }

    private string Arg(string key)
    {
        object value;
        return CPH.TryGetArg(key, out value) && value != null
            ? Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture)
            : "";
    }

    private static string Shorten(string value, int max)
    {
        if (string.IsNullOrEmpty(value) || value.Length <= max) return value ?? "";
        return value.Substring(0, Math.Max(0, max - 1)) + "…";
    }
}
