using System;
using System.Collections.Generic;
using System.Globalization;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading;
using Newtonsoft.Json.Linq;

// One-way import of the DonationAlerts history. It never marks history as allowed for output:
// imported rows get the terminal status "historical" and stay out of chat/OBS until replayed.
public static class ModerationHistory
{
    private const string Endpoint = "https://www.donationalerts.com/api/v1/alerts/donations";
    private const int MaxPages = 100;

    public static List<ModerationItem> Fetch(string accessToken)
    {
        if (string.IsNullOrWhiteSpace(accessToken)) throw new InvalidOperationException("missing_token");
        var items = new List<ModerationItem>();
        using (var handler = new HttpClientHandler { AllowAutoRedirect = false })
        using (var http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(30) })
        {
            http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            http.DefaultRequestHeaders.UserAgent.ParseAdd("maseaaao-stream-moderation/1.0");
            http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            int lastPage = 1;
            for (int page = 1; page <= MaxPages; page++)
            {
                string url = Endpoint + "?page=" + page.ToString(CultureInfo.InvariantCulture);
                using (var response = http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead).GetAwaiter().GetResult())
                {
                    if (!response.IsSuccessStatusCode)
                        throw new InvalidOperationException("http_" + (int)response.StatusCode);
                    using (var stream = response.Content.ReadAsStreamAsync().GetAwaiter().GetResult())
                    using (var memory = new System.IO.MemoryStream())
                    {
                        byte[] buffer = new byte[4096];
                        int count;
                        while ((count = stream.ReadAsync(buffer, 0, buffer.Length).GetAwaiter().GetResult()) > 0)
                        {
                            if (memory.Length + count > 4 * 1024 * 1024) throw new InvalidOperationException("response_too_large");
                            memory.Write(buffer, 0, count);
                        }
                        var root = JToken.Parse(Encoding.UTF8.GetString(memory.ToArray()));
                        var data = root as JArray ?? root["data"] as JArray;
                        if (data == null) throw new InvalidOperationException("invalid_response");
                        if (data.Count == 0) break;
                        foreach (var token in data)
                        {
                            var item = ToItem(token as JObject);
                            if (item != null) items.Add(item);
                        }
                        var meta = root["meta"] as JObject;
                        if (meta != null && meta["last_page"] != null)
                            lastPage = Math.Max(1, (int)meta["last_page"]);
                        if (page >= lastPage) break;
                    }
                }
                Thread.Sleep(250);
            }
        }
        return items;
    }

    private static ModerationItem ToItem(JObject value)
    {
        if (value == null) return null;
        string id = Text(value["id"]);
        if (string.IsNullOrWhiteSpace(id)) return null;
        string messageType = Text(value["message_type"]).ToLowerInvariant();
        string message = Text(value["message"]);
        string kind = messageType == "audio" ? "audio" : "text";
        if (kind == "audio") message = "[голосовое сообщение]";
        var item = new ModerationItem
        {
            Id = id,
            Platform = "donationalerts",
            Kind = kind,
            Username = string.IsNullOrWhiteSpace(Text(value["username"])) ? "Аноним" : Text(value["username"]),
            Message = message,
            Amount = Text(value["amount"]),
            Currency = Text(value["currency"]),
            ConvertedAmount = Text(value["amount_in_user_currency"]),
            CreatedUtc = Date(value["created_at"]),
            UpdatedUtc = DateTime.UtcNow
        };
        return item;
    }

    private static string Text(JToken token)
    {
        if (token == null || token.Type == JTokenType.Null) return "";
        if (token.Type == JTokenType.Float || token.Type == JTokenType.Integer)
            return token.ToString(Newtonsoft.Json.Formatting.None);
        return token.ToString();
    }

    private static DateTime Date(JToken token)
    {
        string raw = Text(token);
        DateTime parsed;
        string[] formats = { "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd'T'HH:mm:ss'Z'", "o" };
        if (DateTime.TryParseExact(raw, formats, CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out parsed)) return parsed;
        if (DateTime.TryParse(raw, CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out parsed)) return parsed;
        return DateTime.UtcNow;
    }
}
