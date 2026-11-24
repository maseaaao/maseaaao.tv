using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.RegularExpressions;

// Stream Deck button "КЛИП": Twitch clip of the last 60 seconds via the Twitch API.
// Uses only framework assemblies so Streamer.bot can compile it inline.
public class CPHInline
{
    private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };

    public bool Execute()
    {
        try
        {
            var broadcaster = CPH.TwitchGetBroadcaster();
            if (broadcaster == null) throw new InvalidOperationException("Twitch broadcaster is not connected.");

            string url = "https://api.twitch.tv/helix/clips?broadcaster_id=" +
                Uri.EscapeDataString(broadcaster.UserId) + "&duration=60";
            using (var request = new HttpRequestMessage(HttpMethod.Post, url))
            {
                request.Headers.Add("Client-Id", CPH.TwitchClientId);
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", CPH.TwitchOAuthToken);
                using (var response = Http.SendAsync(request).GetAwaiter().GetResult())
                {
                    string body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                    if (!response.IsSuccessStatusCode)
                    {
                        int code = (int)response.StatusCode;
                        throw new InvalidOperationException(
                            code == 401 || code == 403 ? "Twitch: нет прав clips:edit" : "Twitch API " + code);
                    }

                    Match id = Regex.Match(body, "\"id\"\\s*:\\s*\"([^\"]+)\"");
                    if (!id.Success) throw new InvalidOperationException("Twitch returned no clip.");

                    string clipUrl = "https://clips.twitch.tv/" + id.Groups[1].Value;
                    PublishResult(true, clipUrl, "");
                    CPH.LogInfo("Twitch clip created: " + clipUrl);
                    try { CPH.StreamDeckSetTitle("clip", "КЛИП\n✓"); } catch (Exception) { }
                    System.Threading.Thread.Sleep(1200);
                    try { CPH.StreamDeckSetTitle("clip", "КЛИП"); } catch (Exception) { }
                }
            }
        }
        catch (Exception ex)
        {
            PublishResult(false, "", ex.Message);
            CPH.LogWarn("Twitch clip failed: " + ex.Message);
            try { CPH.StreamDeckSetTitle("clip", "КЛИП\nОШИБКА"); } catch (Exception) { }
        }
        return true;
    }

    // The chat command reads the result through action arguments: an If/Else input parses
    // %arguments% and ~persisted globals~ only, so non-persisted globals never reach it.
    private void PublishResult(bool ok, string url, string error)
    {
        CPH.SetArgument("clip.last.ok", ok);
        CPH.SetArgument("clip.last.url", url);
        CPH.SetArgument("clip.last.error", error);
        CPH.SetGlobalVar("clip.last.ok", ok, false);
        CPH.SetGlobalVar("clip.last.url", url, false);
        CPH.SetGlobalVar("clip.last.error", error, false);
    }
}
