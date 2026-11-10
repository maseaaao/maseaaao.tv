using System;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using Streamer.bot.Plugin.Interface;

// Public outputs for allowed donations. Never call this for pending, blocked or review items.
public static class ModerationOutput
{
    private static readonly Regex Spaces = new Regex(@"\s+", RegexOptions.CultureInvariant);

    public static bool Display(IInlineInvokeProxy cph, ModerationItem item, ModerationConfig config, CancellationToken token)
    {
        if (cph == null || item == null || config == null ||
            (item.Status != "allowed" && item.Status != "displaying")) return false;
        string message = Message(item);
        if (string.IsNullOrWhiteSpace(message)) return false;

        try
        {
            if (cph.TwitchGetBroadcaster() != null)
            {
                cph.SendMessage(Shorten(message, 490), true, true);
            }
        }
        catch (Exception) { cph.LogWarn("AI moderation: Twitch chat delivery failed."); }

        try
        {
            var broadcast = cph.YouTubeGetLatestMonitoredBroadcast();
            if (broadcast != null && broadcast.Status == "live" && !string.IsNullOrWhiteSpace(broadcast.LiveChatId))
            {
                cph.SendYouTubeMessage(Shorten(message, 195), true, true, broadcast.Id);
            }
        }
        catch (Exception) { cph.LogWarn("AI moderation: YouTube chat delivery failed."); }

        // The local browser source owns the visual alert and the provider's voice recording.
        // Keeping the item active for DisplaySeconds gives it time to fetch /api/current and play audio.
        int seconds = Math.Max(3, Math.Min(60, config.DisplaySeconds));
        token.WaitHandle.WaitOne(seconds * 1000);
        return true;
    }

    public static void Stop(IInlineInvokeProxy cph, ModerationConfig config)
    {
        // The browser source hides itself when the host releases the active item.
    }

    public static string Message(ModerationItem item)
    {
        string name = Clean(item.Username, 60);
        if (string.IsNullOrWhiteSpace(name) || name == "Anonymous") name = "Аноним";
        string amount = Clean(item.Amount, 30);
        string currency = Clean(item.Currency, 10);
        string message = "💰 " + name + " — " + amount + " " + currency;
        string content = Clean(item.Message, 400);
        if (!string.IsNullOrWhiteSpace(content)) message += ": " + content;
        return message.Trim();
    }

    private static string Clean(string value, int limit)
    {
        string text = new string((value ?? "")
            .Where(c => !char.IsControl(c) || c == '\n' || c == '\t')
            .ToArray());
        return Shorten(Spaces.Replace(text, " ").Trim(), limit);
    }

    private static string Shorten(string value, int limit)
    {
        if (string.IsNullOrEmpty(value) || value.Length <= limit) return value ?? "";
        int end = limit - 1;
        if (char.IsHighSurrogate(value[end - 1])) end--;
        return value.Substring(0, end) + "…";
    }
}
