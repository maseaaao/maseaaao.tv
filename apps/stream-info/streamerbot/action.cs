using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

public class CPHInline
{
    private const int ApiVersion = 6;
    private static readonly ShortLivedCache<JObject> StateCache =
        new ShortLivedCache<JObject>(TimeSpan.FromSeconds(5));
    private static readonly TwitchCategorySearchService CategorySearch = new TwitchCategorySearchService();
    private static readonly HttpClient CategoryHttpClient = new HttpClient { Timeout = System.Threading.Timeout.InfiniteTimeSpan };
    private static readonly HttpClient TwitchHttpClient = new HttpClient
    {
        Timeout = TimeSpan.FromSeconds(10)
    };
    private const string ReplyEvent = "stream_info_api_response";
    // Токен подстановки названия в шаблоне: короткий, чтобы не загромождать шаблон.
    private const string TemplateToken = "$s";
    // Текущая категория Twitch для повтора игры в YouTube.
    private const string GameToken = "$g";
    // Шаблоны, сохранённые до перехода на `$s`, продолжают работать.
    private const string LegacyTemplateToken = "%subtitle%";
    private const string DefaultTwitchTemplate = "🔴 $s| !tg !yt !tw !donate";
    private const string DefaultYouTubeTemplate = "🔴 $g | $s| !tg !yt !tw !donate";
    private const string TwitchTemplateKey = "stream_info.template.twitch";
    private const string YouTubeTemplateKey = "stream_info.template.youtube";
    private const string SubtitleKey = "stream_info.template.subtitle";
    private const string TwitchCategoryKey = "stream_info.preset.twitchCategoryId";
    private const string YouTubeCategoryKey = "stream_info.preset.youtubeCategoryName";
    private const string SharedTagsKey = "stream_info.preset.tagsJson";
    private const string TwitchTagsKey = "stream_info.preset.twitchTagsJson";
    private const string YouTubeTagsKey = "stream_info.preset.youtubeTagsJson";
    private const string AutomaticYouTubeCommand = "applyYouTubeStart";
    // Every YouTube stream starts in Gaming; tags are copied from Twitch.
    private const string YouTubeStartCategory = "Видеоигры";

    public bool Execute()
    {
        string command = null;
        string requestId = null;

        try
        {
            CPH.TryGetArg("command", out command);
            CPH.TryGetArg("requestId", out requestId);
            CPH.TryGetArg("payloadJson", out string payloadJson);

            // The native trigger is YouTube Broadcast Started, so an execution
            // without a command is the automatic start-metadata path.
            if (string.IsNullOrWhiteSpace(command) && string.IsNullOrWhiteSpace(requestId))
                command = AutomaticYouTubeCommand;
            if (string.IsNullOrWhiteSpace(command))
                throw new InvalidOperationException("Команда не указана.");
            bool shouldReply = !string.IsNullOrWhiteSpace(requestId);
            if (!shouldReply &&
                !string.Equals(command, "applyPreset", StringComparison.Ordinal) &&
                !string.Equals(command, AutomaticYouTubeCommand, StringComparison.Ordinal))
                throw new InvalidOperationException("requestId не указан.");

            JObject payload = string.IsNullOrWhiteSpace(payloadJson) ? new JObject() : JObject.Parse(payloadJson);
            JObject data;

            switch (command)
            {
                case "getState":
                    data = GetState();
                    break;
                case "searchTwitchCategories":
                    data = SearchTwitchCategories(payload.Value<string>("query"), payload.Value<string>("cursor"));
                    break;
                case "updateTwitch":
                    data = UpdateTwitch(payload);
                    break;
                case "updateYouTube":
                    data = UpdateYouTube(payload);
                    break;
                case "saveTemplates":
                    data = SaveTemplates(payload);
                    break;
                case "applyPreset":
                    data = ApplyPreset();
                    break;
                case AutomaticYouTubeCommand:
                    data = ApplyYouTubeStart();
                    break;
                default:
                    throw new InvalidOperationException("Неизвестная команда: " + command);
            }

            bool ok = data["ok"] == null || data.Value<bool>("ok");
            if (shouldReply)
                Reply(requestId, command, ok, data, ok ? null : "Не все поля удалось изменить.");
            else if (!ok)
                CPH.LogError(string.Equals(command, AutomaticYouTubeCommand, StringComparison.Ordinal)
                    ? "[STREAM INFO | API] Стартовые параметры YouTube применены не полностью."
                    : "[STREAM INFO | API] Пресет применён не полностью.");
        }
        catch (Exception ex)
        {
            CPH.LogError("[STREAM INFO | API] " + ex.Message);
            if (!string.IsNullOrWhiteSpace(requestId))
                Reply(requestId, command ?? "unknown", false, null, ex.Message);
        }

        // C# responses are delivered out-of-band through the code event.
        return true;
    }

    private JObject GetState()
    {
        return StateCache.GetOrCreate(BuildState, state => (JObject)state.DeepClone());
    }

    private JObject BuildState()
    {
        return new JObject
        {
            ["apiVersion"] = ApiVersion,
            ["twitch"] = GetTwitchState(),
            ["youtube"] = GetYouTubeState(),
            ["templates"] = GetTemplates()
        };
    }

    private JObject GetTemplates()
    {
        string twitchTemplate = MigrateLegacyToken(CPH.GetGlobalVar<string>(TwitchTemplateKey, true));
        string youtubeTemplate = MigrateLegacyToken(CPH.GetGlobalVar<string>(YouTubeTemplateKey, true));
        string subtitle = CPH.GetGlobalVar<string>(SubtitleKey, true);
        bool configured = twitchTemplate != null || youtubeTemplate != null || subtitle != null;

        return new JObject
        {
            ["twitchTemplate"] = string.IsNullOrWhiteSpace(twitchTemplate) ? DefaultTwitchTemplate : twitchTemplate,
            ["youtubeTemplate"] = string.IsNullOrWhiteSpace(youtubeTemplate) ? DefaultYouTubeTemplate : youtubeTemplate,
            ["subtitle"] = subtitle ?? "",
            ["configured"] = configured
        };
    }

    private JObject SaveTemplates(JObject payload)
    {
        string twitchTemplate = payload["twitchTemplate"] == null
            ? CPH.GetGlobalVar<string>(TwitchTemplateKey, true)
            : payload.Value<string>("twitchTemplate");
        string youtubeTemplate = payload["youtubeTemplate"] == null
            ? CPH.GetGlobalVar<string>(YouTubeTemplateKey, true)
            : payload.Value<string>("youtubeTemplate");
        twitchTemplate = MigrateLegacyToken(twitchTemplate) ?? DefaultTwitchTemplate;
        youtubeTemplate = MigrateLegacyToken(youtubeTemplate) ?? DefaultYouTubeTemplate;
        string subtitle = (payload.Value<string>("subtitle") ?? "").Trim();

        Ensure(HasExactlyOneSubtitle(twitchTemplate), "Шаблон Twitch: нужен ровно один " + TemplateToken + ".");
        Ensure(HasExactlyOneSubtitle(youtubeTemplate), "Шаблон YouTube: нужен ровно один " + TemplateToken + ".");
        CPH.SetGlobalVar(TwitchTemplateKey, twitchTemplate, true);
        CPH.SetGlobalVar(YouTubeTemplateKey, youtubeTemplate, true);
        CPH.SetGlobalVar(SubtitleKey, subtitle, true);
        StateCache.Invalidate();

        return new JObject { ["ok"] = true, ["templates"] = GetTemplates() };
    }

    private JObject ApplyPreset()
    {
        JObject templates = GetTemplates();
        var platforms = new JObject();
        bool allOk = true;
        string twitchCategory = CPH.GetGlobalVar<string>(TwitchCategoryKey, true);
        string gameName = "";
        try
        {
            gameName = !string.IsNullOrWhiteSpace(twitchCategory)
                ? GetTwitchCategoryName(twitchCategory)
                : GetTwitchState().Value<string>("categoryName") ?? "";
        }
        catch (Exception ex)
        {
            CPH.LogVerbose("[STREAM INFO | API] Twitch category unavailable for template: " + ex.Message);
        }

        JObject twitchPayload = new JObject
        {
            ["title"] = TitleFromTemplate(templates.Value<string>("twitchTemplate"), templates.Value<string>("subtitle"), gameName)
        };
        if (!string.IsNullOrWhiteSpace(twitchCategory)) twitchPayload["categoryId"] = twitchCategory;
        JArray twitchTags = GetPresetTags(SharedTagsKey) ?? GetPresetTags(TwitchTagsKey);
        if (twitchTags != null) twitchPayload["tags"] = twitchTags;
        AddPresetResult(platforms, "twitch", twitchPayload, UpdateTwitch, ref allOk);

        JObject youtubePayload = new JObject
        {
            ["title"] = TitleFromTemplate(templates.Value<string>("youtubeTemplate"), templates.Value<string>("subtitle"), gameName)
        };
        string youtubeCategory = CPH.GetGlobalVar<string>(YouTubeCategoryKey, true);
        if (!string.IsNullOrWhiteSpace(youtubeCategory)) youtubePayload["categoryName"] = youtubeCategory;
        JArray youtubeTags = GetPresetTags(SharedTagsKey) ?? GetPresetTags(YouTubeTagsKey);
        if (youtubeTags != null) youtubePayload["tags"] = youtubeTags;
        try
        {
            var broadcast = CPH.YouTubeGetLatestMonitoredBroadcast();
            bool live = broadcast != null && string.Equals(broadcast.Status, "live", StringComparison.OrdinalIgnoreCase);
            if (live)
                AddPresetResult(platforms, "youtube", youtubePayload, UpdateYouTube, ref allOk);
            else
                platforms["youtube"] = new JObject { ["ok"] = true, ["skipped"] = true };
        }
        catch (Exception ex)
        {
            platforms["youtube"] = new JObject { ["ok"] = false, ["error"] = ex.Message };
            allOk = false;
        }

        return new JObject { ["ok"] = allOk, ["platforms"] = platforms };
    }

    private JObject ApplyYouTubeStart()
    {
        JObject result = AutomaticYouTubePolicy.RunWhenReady(
            () =>
            {
                var broadcast = CPH.YouTubeGetLatestMonitoredBroadcast();
                return broadcast != null &&
                    string.Equals(broadcast.Status, "live", StringComparison.OrdinalIgnoreCase);
            },
            () => System.Threading.Thread.Sleep(1000),
            () =>
            {
                var payload = new JObject { ["categoryName"] = YouTubeStartCategory };
                try
                {
                    JObject twitch = GetTwitchState();
                    JArray tags = twitch["tags"] as JArray;
                    if (twitch.Value<bool>("connected") && tags != null && tags.Count > 0)
                        payload["tags"] = tags.DeepClone();
                }
                catch (Exception ex)
                {
                    CPH.LogVerbose("[STREAM INFO | API] Twitch tags unavailable for YouTube start: " + ex.Message);
                }
                return UpdateYouTube(payload);
            });
        if (result.Value<bool>("ok"))
            CPH.LogInfo("[STREAM INFO | API] YouTube start metadata applied.");
        return result;
    }

    private void AddPresetResult(JObject platforms, string platform, JObject payload, Func<JObject, JObject> update, ref bool allOk)
    {
        try
        {
            JObject result = update(payload);
            platforms[platform] = result;
            allOk &= result.Value<bool>("ok");
        }
        catch (Exception ex)
        {
            platforms[platform] = new JObject { ["ok"] = false, ["error"] = ex.Message };
            allOk = false;
        }
    }

    private JArray GetPresetTags(string key)
    {
        string serialized = CPH.GetGlobalVar<string>(key, true);
        if (string.IsNullOrWhiteSpace(serialized)) return null;
        JToken parsed = JToken.Parse(serialized);
        var tags = parsed as JArray;
        Ensure(tags != null, key + " должен содержать JSON-массив тегов.");
        return tags;
    }

    // Шаблон прежнего формата переводим в `$s`, чтобы старые сохранения не ломали заголовок.
    private static string MigrateLegacyToken(string template)
    {
        return template != null && template.IndexOf(LegacyTemplateToken, StringComparison.Ordinal) >= 0
            ? template.Replace(LegacyTemplateToken, TemplateToken)
            : template;
    }

    private static bool HasExactlyOneSubtitle(string template)
    {
        string source = template ?? "";
        int first = source.IndexOf(TemplateToken, StringComparison.Ordinal);
        return first >= 0 && source.IndexOf(TemplateToken, first + TemplateToken.Length, StringComparison.Ordinal) < 0;
    }

    private static string TitleFromTemplate(string template, string subtitle, string gameName)
    {
        string value = ReplaceTemplateToken(template ?? "", GameToken, gameName);
        return ReplaceTemplateToken(value, TemplateToken, subtitle).Trim();
    }

    private static string ReplaceTemplateToken(string template, string token, string rawValue)
    {
        string value = (rawValue ?? "").Trim();
        if (value.Length > 0)
            return template.Replace(token, value);

        string result = template;
        int marker = result.IndexOf(token, StringComparison.Ordinal);
        while (marker >= 0)
        {
            string before = result.Substring(0, marker);
            string after = result.Substring(marker + token.Length);
            // Removing an empty token may remove one adjacent whitespace
            // character, but never normalizes unrelated template text.
            result = before.Length > 0 && after.Length > 0 &&
                char.IsWhiteSpace(before[before.Length - 1]) && char.IsWhiteSpace(after[0])
                ? before.Substring(0, before.Length - 1) + after
                : before + after;
            marker = result.IndexOf(token, StringComparison.Ordinal);
        }
        return result;
    }

    private JObject GetTwitchState()
    {
        // An unauthenticated installation can throw before returning a broadcaster.
        try
        {
            var broadcaster = CPH.TwitchGetBroadcaster();
            if (broadcaster == null || string.IsNullOrWhiteSpace(broadcaster.UserId))
            {
                return new JObject
                {
                    ["connected"] = false,
                    ["live"] = false
                };
            }

            JObject channel = TwitchGet("channels?broadcaster_id=" + Uri.EscapeDataString(broadcaster.UserId));
            JObject channelInfo = FirstData(channel);
            if (channelInfo == null)
                throw new InvalidOperationException("Twitch не вернул сведения о канале.");

            string categoryId = channelInfo.Value<string>("game_id") ?? "";
            string categoryName = channelInfo.Value<string>("game_name") ?? "";
            string imageUrl = GetTwitchCategoryImage(categoryId);
            JObject stream = TwitchGet("streams?user_id=" + Uri.EscapeDataString(broadcaster.UserId));

            return new JObject
            {
                ["connected"] = true,
                ["accountName"] = broadcaster.UserName ?? broadcaster.UserLogin,
                ["login"] = broadcaster.UserLogin ?? "",
                ["broadcasterId"] = broadcaster.UserId,
                ["live"] = FirstData(stream) != null,
                ["title"] = channelInfo.Value<string>("title") ?? "",
                ["categoryId"] = categoryId,
                ["categoryName"] = categoryName,
                ["categoryImageUrl"] = imageUrl,
                ["tags"] = channelInfo["tags"] as JArray ?? new JArray()
            };
        }
        catch (Exception ex)
        {
            CPH.LogVerbose("[STREAM INFO | API] Twitch unavailable: " + ex.Message);
            return new JObject { ["connected"] = false, ["live"] = false };
        }
    }

    private JObject GetYouTubeState()
    {
        // Streamer.bot can throw before returning null when YouTube has never
        // been authenticated. A missing platform stays a normal state.
        try
        {
            var broadcaster = CPH.YouTubeGetBroadcaster();
            var broadcast = CPH.YouTubeGetLatestMonitoredBroadcast();
            bool live = broadcast != null && string.Equals(broadcast.Status, "live", StringComparison.OrdinalIgnoreCase);
            string channelId = broadcaster == null ? "" : broadcaster.UserId ?? "";
            if (string.IsNullOrWhiteSpace(channelId) && broadcast != null)
                channelId = broadcast.ChannelId ?? "";

            if (broadcast == null)
            {
                return new JObject
                {
                    ["connected"] = broadcaster != null,
                    ["live"] = false,
                    ["accountName"] = broadcaster == null ? "" : broadcaster.UserName ?? "",
                    ["channelId"] = channelId
                };
            }

            return new JObject
            {
                ["connected"] = broadcaster != null,
                ["accountName"] = broadcaster == null ? "" : broadcaster.UserName ?? "",
                ["channelId"] = channelId,
                ["live"] = live,
                ["broadcastId"] = broadcast.Id ?? "",
                ["status"] = broadcast.Status ?? "",
                ["title"] = broadcast.Title ?? "",
                ["categoryId"] = broadcast.CategoryId ?? "",
                ["categoryName"] = broadcast.CategoryName ?? "",
                ["tags"] = new JArray((broadcast.Tags ?? new List<string>()).ToArray())
            };
        }
        catch (Exception ex)
        {
            CPH.LogVerbose("[STREAM INFO | API] YouTube unavailable: " + ex.Message);
            return new JObject { ["connected"] = false, ["live"] = false };
        }
    }

    private JObject SearchTwitchCategories(string query, string cursor)
    {
        // Capture credentials once: all sources and the cache key belong to the
        // same connected account, even if Streamer.bot reconnects mid-request.
        string token = CPH.TwitchOAuthToken;
        string clientId = CPH.TwitchClientId;
        Ensure(!string.IsNullOrWhiteSpace(token) && !string.IsNullOrWhiteSpace(clientId), "Twitch OAuth не подключён в Streamer.bot.");
        string scope = TwitchCategorySearchService.Fingerprint(clientId + "\n" + token);
        TwitchCategoryPage page = CategorySearch.SearchAsync(query, cursor, scope, async (path, cancellation) =>
        {
            string content = await TwitchCategoryTransport.GetAsync(CategoryHttpClient, path, token, clientId, cancellation).ConfigureAwait(false);
            cancellation.ThrowIfCancellationRequested();
            JObject response = JObject.Parse(content);
            JArray data = response["data"] as JArray;
            if (data == null) throw new InvalidOperationException("Twitch category response has no data array.");
            return new TwitchCategoryPage {
                Results = data.Select(item => new TwitchCategoryMatch(item.Value<string>("id") ?? "",
                    item.Value<string>("name") ?? "", NormalizeBoxArt(item.Value<string>("box_art_url") ?? ""))).ToList(),
                Cursor = response["pagination"] == null ? null : response["pagination"].Value<string>("cursor")
            };
        }).GetAwaiter().GetResult();
        JArray results = new JArray(page.Results.Select(item => new JObject
        {
            ["id"] = item.Id,
            ["name"] = item.Name,
            ["imageUrl"] = item.ImageUrl
        }));
        var result = new JObject { ["ok"] = true, ["results"] = results,
            ["cursor"] = page.Cursor == null ? JValue.CreateNull() : new JValue(page.Cursor),
            ["hasMore"] = page.HasMore, ["partial"] = page.Partial };
        if (page.Warnings.Count > 0) result["warnings"] = new JArray(page.Warnings);
        return result;
    }

    private JObject UpdateTwitch(JObject payload)
    {
        var broadcaster = CPH.TwitchGetBroadcaster();
        if (broadcaster == null || string.IsNullOrWhiteSpace(broadcaster.UserId))
            throw new InvalidOperationException("Twitch broadcaster не подключён в Streamer.bot.");

        string title = payload["title"] == null ? null : payload.Value<string>("title");
        string categoryId = payload["categoryId"] == null ? null : payload.Value<string>("categoryId");
        List<string> tags = payload["tags"] == null ? null : ReadTags(payload["tags"]);
        if (payload["title"] != null)
            Ensure(!string.IsNullOrWhiteSpace(title) && title.Length <= 140, "Название Twitch должно содержать от 1 до 140 символов.");
        if (payload["categoryId"] != null)
            Ensure(!string.IsNullOrWhiteSpace(categoryId), "Не выбрана категория Twitch.");
        if (tags != null)
            Ensure(tags.Count <= 10 && tags.All(t => t.Length <= 25 && !t.Any(char.IsWhiteSpace)), "Теги Twitch: максимум 10, до 25 символов, без пробелов.");
        Ensure(title != null || categoryId != null || tags != null, "Нет изменений Twitch для сохранения.");

        JObject fields = new JObject();
        bool allOk = true;
        string pendingField = null;
        try
        {
            if (title != null)
            {
                pendingField = "title";
                bool result = CPH.SetChannelTitle(title);
                fields["title"] = result;
                allOk &= result;
            }
            if (categoryId != null)
            {
                pendingField = "category";
                bool result = CPH.SetChannelGameById(categoryId);
                fields["category"] = result;
                allOk &= result;
            }
            if (tags != null)
            {
                pendingField = "tags";
                bool result = CPH.TwitchSetChannelTags(tags);
                fields["tags"] = result;
                allOk &= result;
            }
            return new JObject { ["ok"] = allOk, ["fields"] = fields };
        }
        catch (Exception ex)
        {
            // The failed call may have changed Twitch before throwing. Preserve
            // completed fields and report the uncertain field without retrying it.
            return new JObject { ["ok"] = false, ["fields"] = fields,
                ["failedField"] = pendingField, ["error"] = ex.Message };
        }
        finally
        {
            StateCache.Invalidate();
        }
    }

    private JObject UpdateYouTube(JObject payload)
    {
        var broadcast = CPH.YouTubeGetLatestMonitoredBroadcast();
        if (broadcast == null || !string.Equals(broadcast.Status, "live", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Стрим YouTube должен быть запущен.");

        Ensure(payload["title"] != null || payload["categoryName"] != null || payload["tags"] != null,
            "Нет изменений YouTube для сохранения.");
        JObject fields = new JObject();
        bool allOk = true;
        string pendingField = null;
        try
        {
            if (payload["title"] != null)
            {
                pendingField = "title";
                string title = payload.Value<string>("title");
                Ensure(!string.IsNullOrWhiteSpace(title) && title.Length <= 100 && !title.Contains("<") && !title.Contains(">"),
                    "Название YouTube должно содержать до 100 символов и не включать < или >.");
                bool result = CPH.YouTubeSetTitle(title, broadcast.Id);
                fields["title"] = result;
                allOk &= result;
            }
            if (payload["categoryName"] != null)
            {
                pendingField = "category";
                string categoryName = payload.Value<string>("categoryName");
                Ensure(!string.IsNullOrWhiteSpace(categoryName), "Не выбрана категория YouTube.");
                bool result = CPH.YouTubeSetCategory(categoryName, broadcast.Id);
                fields["category"] = result;
                allOk &= result;
            }
            if (payload["tags"] != null)
            {
                pendingField = "tags";
                List<string> tags = ReadTags(payload["tags"]);
                Ensure(string.Join(",", tags).Length <= 500, "Общий размер тегов YouTube не может превышать 500 символов.");
                bool cleared = CPH.YouTubeClearTags(broadcast.Id);
                bool added = cleared && (tags.Count == 0 || CPH.YouTubeAddTags(tags, broadcast.Id));
                bool result = cleared && added;
                fields["tags"] = result;
                allOk &= result;
            }
            return new JObject { ["ok"] = allOk, ["fields"] = fields };
        }
        catch (Exception ex)
        {
            // A failed call may have changed YouTube before throwing. Preserve
            // completed fields and report the uncertain field without retrying it.
            return new JObject
            {
                ["ok"] = false,
                ["fields"] = fields,
                ["failedField"] = pendingField,
                ["error"] = ex.Message
            };
        }
        finally
        {
            StateCache.Invalidate();
        }
    }

    private JObject TwitchGet(string path)
    {
        string token = CPH.TwitchOAuthToken;
        string clientId = CPH.TwitchClientId;
        if (string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(clientId))
            throw new InvalidOperationException("Twitch OAuth не подключён в Streamer.bot.");

        using (var request = new HttpRequestMessage(HttpMethod.Get, "https://api.twitch.tv/helix/" + path))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Headers.TryAddWithoutValidation("Client-Id", clientId);
            using (HttpResponseMessage response = TwitchHttpClient.SendAsync(request).GetAwaiter().GetResult())
            {
                string content = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                if (!response.IsSuccessStatusCode)
                    throw new InvalidOperationException("Twitch Helix: " + (int)response.StatusCode + " " + content);
                return JObject.Parse(content);
            }
        }
    }

    private string GetTwitchCategoryImage(string categoryId)
    {
        if (string.IsNullOrWhiteSpace(categoryId))
            return "";

        JObject game = FirstData(TwitchGet("games?id=" + Uri.EscapeDataString(categoryId)));
        return game == null ? "" : NormalizeBoxArt(game.Value<string>("box_art_url") ?? "");
    }

    private string GetTwitchCategoryName(string categoryId)
    {
        if (string.IsNullOrWhiteSpace(categoryId))
            return "";

        JObject game = FirstData(TwitchGet("games?id=" + Uri.EscapeDataString(categoryId)));
        return game == null ? "" : game.Value<string>("name") ?? "";
    }

    private static JObject FirstData(JObject response)
    {
        return (response["data"] as JArray)?.OfType<JObject>().FirstOrDefault();
    }

    private static string NormalizeBoxArt(string url)
    {
        return url.Replace("{width}", "188").Replace("{height}", "250");
    }

    private static List<string> ReadTags(JToken token)
    {
        Ensure(token.Type == JTokenType.Array, "Теги Twitch должны быть массивом.");
        var tags = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string raw in token.Values<string>())
        {
            string tag = (raw ?? "").Trim();
            if (tag.Length == 0)
                throw new InvalidOperationException("Тег не может быть пустым.");
            if (!seen.Add(tag))
                throw new InvalidOperationException("Теги не должны повторяться.");
            tags.Add(tag);
        }
        return tags;
    }

    private void Reply(string requestId, string command, bool ok, JObject data, string message)
    {
        JObject response = new JObject
        {
            ["apiVersion"] = ApiVersion,
            ["requestId"] = requestId,
            ["command"] = command,
            ["ok"] = ok,
            ["data"] = data
        };
        if (!ok)
            response["error"] = new JObject { ["message"] = message ?? "Операция не выполнена." };
        else
            response["error"] = JValue.CreateNull();

        CPH.TriggerCodeEvent(ReplyEvent, response.ToString(Formatting.None));
    }

    private static void Ensure(bool condition, string message)
    {
        if (!condition)
            throw new InvalidOperationException(message);
    }
}
