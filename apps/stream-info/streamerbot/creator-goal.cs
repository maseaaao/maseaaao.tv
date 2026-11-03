using System;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using Newtonsoft.Json.Linq;

// Streamer.bot: Execute Code. Action name: Creator Goal.
// Reads the active Twitch follower goal and publishes it to the persistent
// global `twitchGoal` for the OBS goal block and the social strip.
public class CPHInline
{
    public bool Execute()
    {
        string token = CPH.TwitchOAuthToken;
        string clientId = CPH.TwitchClientId;
        if (string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(clientId))
        {
            CPH.LogWarn("[Creator Goal] Twitch OAuth не подключён.");
            CPH.SetGlobalVar("twitchGoal", "", true);
            return false;
        }

        try
        {
            var broadcaster = CPH.TwitchGetBroadcaster();
            using (var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) })
            using (var request = new HttpRequestMessage(
                HttpMethod.Get,
                "https://api.twitch.tv/helix/goals?broadcaster_id=" + Uri.EscapeDataString(broadcaster.UserId)))
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                request.Headers.TryAddWithoutValidation("Client-Id", clientId);
                using (var response = http.SendAsync(request).GetAwaiter().GetResult())
                {
                    string body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                    if (!response.IsSuccessStatusCode)
                    {
                        CPH.LogWarn("[Creator Goal] Helix " + (int)response.StatusCode + ": " + body);
                        CPH.SetGlobalVar("twitchGoal", "", true);
                        return false;
                    }

                    var data = JObject.Parse(body)["data"] as JArray;
                    var goal = data?.FirstOrDefault(g => (string)g["type"] == "follower");
                    if (goal == null)
                    {
                        CPH.SetGlobalVar("twitchGoal", "", true);
                        return true;
                    }

                    var payload = new JObject
                    {
                        ["type"] = goal["type"],
                        ["current"] = goal["current_amount"],
                        ["target"] = goal["target_amount"],
                        ["description"] = goal["description"],
                        ["updated"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds()
                    };
                    CPH.SetGlobalVar("twitchGoal", payload.ToString(Newtonsoft.Json.Formatting.None), true);
                    return true;
                }
            }
        }
        catch (Exception ex)
        {
            CPH.LogWarn("[Creator Goal] " + ex.Message);
            CPH.SetGlobalVar("twitchGoal", "", true);
            return false;
        }
    }
}
