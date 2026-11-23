using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;

// Жизненный цикл YouTube-трансляции и записи (VOD).
//
// Задача действия — гарантировать три вещи:
//   1) после завершения эфира запись переводится в «Доступ по ссылке» (unlisted);
//   2) причина завершения фиксируется: штатная остановка или сбой;
//   3) при неопределённом состоянии ничего не удаляется и не трогается чужое видео.
//
// Автоматическое удаление записи намеренно не реализовано: в установленной версии
// Streamer.bot нет метода удаления видео, а собственный OAuth-клиент YouTube Data API
// не заводится (решение владельца). Удаление остаётся ручным, ссылка приходит в Telegram.
//
// Состояние хранится в persistent globals, чтобы пережить перезапуск Streamer.bot.
public class CPHInline
{
    private const string ActionName = "OBS | VOD | Lifecycle";
    private const string TelegramAction = "Telegram | SEND";

    // Признак намеренной остановки ставит Action «STATE | STOP» до выключения эфира.
    private const string IntentKey = "vod.session.intent";
    private const string StopAtKey = "vod.session.stopAt";
    private const string BroadcastKey = "vod.session.broadcastId";
    private const string StartedAtKey = "vod.session.startedAt";
    private const string LastResultKey = "vod.last.result";
    private const string LastBroadcastKey = "vod.last.broadcastId";
    private const string LastWatchKey = "vod.last.watchUrl";
    private const string LastStudioKey = "vod.last.studioUrl";

    private const int ObsConnection = 0;
    // Окно, в котором явный маркер остановки считается относящимся к текущему эфиру.
    private const long IntentWindowSeconds = 180;

    public bool Execute()
    {
        string eventType = CPH.GetEventType().ToString();
        switch (eventType)
        {
            case "ObsStreamingStopped":
                return OnStreamStopped();
            case "ObsDisconnected":
                return OnObsDisconnected();
            case "YouTubeBroadcastStarted":
                return OnBroadcastStarted();
            case "YouTubeBroadcastEnded":
                return OnBroadcastEnded();
            default:
                CPH.LogInfo("[" + ActionName + "] Событие без обработчика: " + eventType);
                return true;
        }
    }

    // --- Эфир начался: запоминаем идентификатор записи ----------------------
    private bool OnBroadcastStarted()
    {
        string broadcastId = ReadBroadcastId();
        if (string.IsNullOrWhiteSpace(broadcastId))
        {
            CPH.LogWarn("[" + ActionName + "] Событие старта без broadcast.id.");
            return true;
        }

        CPH.SetGlobalVar(BroadcastKey, broadcastId, true);
        CPH.SetGlobalVar(StartedAtKey, NowUnix(), true);
        CPH.SetGlobalVar(IntentKey, "unknown", true);
        CPH.SetGlobalVar(StopAtKey, 0L, true);
        StartReplayBuffer();
        CPH.LogInfo("[" + ActionName + "] Эфир начался: " + broadcastId);
        return true;
    }

    // Клипы по !clip берутся из буфера повтора, поэтому он должен работать весь эфир.
    private void StartReplayBuffer()
    {
        try
        {
            CPH.ObsSendRaw("StartReplayBuffer", "{}", ObsConnection);
        }
        catch (Exception ex)
        {
            CPH.LogWarn("[" + ActionName + "] Replay Buffer не запущен: " + ex.Message);
        }
    }

    // --- Поток OBS остановлен: определяем намерение -------------------------
    private bool OnStreamStopped()
    {
        bool explicitIntent = HasRecentGracefulIntent();
        bool cleanLog = IsCleanObsStop();
        bool graceful = explicitIntent || cleanLog;

        CPH.SetGlobalVar(IntentKey, graceful ? "graceful" : "unknown", true);
        CPH.SetGlobalVar(StopAtKey, NowUnix(), true);
        CPH.LogInfo("[" + ActionName + "] Остановка потока: " +
            (graceful ? "штатная" : "неопределённая") +
            " (маркер: " + explicitIntent + ", журнал OBS: " + cleanLog + ").");
        return true;
    }

    private bool OnObsDisconnected()
    {
        // Связь с OBS пропала без события остановки: это не намеренное завершение.
        if (string.IsNullOrWhiteSpace(CPH.GetGlobalVar<string>(BroadcastKey, true)))
            return true;

        CPH.SetGlobalVar(IntentKey, "unknown", true);
        CPH.LogWarn("[" + ActionName + "] OBS отключился во время эфира — завершение считается аварийным.");
        return true;
    }

    // --- Трансляция завершена на стороне YouTube ---------------------------
    private bool OnBroadcastEnded()
    {
        string endedId = ReadBroadcastId();
        string sessionId = CPH.GetGlobalVar<string>(BroadcastKey, true) ?? "";

        if (string.IsNullOrWhiteSpace(endedId))
        {
            CPH.LogWarn("[" + ActionName + "] Событие завершения без broadcast.id — запись не меняем.");
            return true;
        }

        // Чужую или постороннюю трансляцию не трогаем: идентификатор обязан совпасть
        // с тем, что мы записали при старте этой сессии.
        if (!string.IsNullOrWhiteSpace(sessionId) && !string.Equals(sessionId, endedId, StringComparison.Ordinal))
        {
            CPH.LogWarn("[" + ActionName + "] Завершился другой эфир (" + endedId + "), сессия " + sessionId + ". Пропуск.");
            return true;
        }

        string intent = CPH.GetGlobalVar<string>(IntentKey, true) ?? "unknown";
        bool graceful = string.Equals(intent, "graceful", StringComparison.Ordinal);

        bool unlisted = SetUnlisted(endedId);
        string link = "https://www.youtube.com/watch?v=" + endedId;
        string studio = "https://studio.youtube.com/video/" + endedId + "/edit";

        string text = "⚫ YouTube: эфир завершён\n" + link + "\n" +
            (graceful
                ? "Штатное завершение. Запись переведена в «Доступ по ссылке»."
                : "Завершение не подтверждено как намеренное — запись сохранена.") +
            (unlisted ? "" : "\n⚠️ Не удалось перевести запись в «Доступ по ссылке» — проверьте YouTube Studio.") +
            "\n\n🗑 Удалить запись: " + studio +
            "\nОткроется YouTube Studio — нажмите «Удалить».";

        CPH.SetGlobalVar(LastBroadcastKey, endedId, true);
        CPH.SetGlobalVar(LastWatchKey, link, true);
        CPH.SetGlobalVar(LastStudioKey, studio, true);
        Notify(text);

        CPH.SetGlobalVar(LastResultKey, new Dictionary<string, object>
        {
            ["broadcastId"] = endedId,
            ["intent"] = intent,
            ["unlisted"] = unlisted,
            ["finishedAt"] = NowUnix()
        }, true);

        // Сессия закрыта: следующий старт начнёт её заново.
        CPH.SetGlobalVar(BroadcastKey, "", true);
        CPH.SetGlobalVar(IntentKey, "unknown", true);
        CPH.SetGlobalVar(StopAtKey, 0L, true);
        CPH.LogInfo("[" + ActionName + "] Эфир " + endedId + " завершён, unlisted=" + unlisted + ", intent=" + intent + ".");
        return true;
    }

    private bool SetUnlisted(string broadcastId)
    {
        try
        {
            if (CPH.YouTubeSetPrivacy("unlisted", broadcastId))
                return true;
        }
        catch (Exception ex)
        {
            CPH.LogError("[" + ActionName + "] YouTubeSetPrivacy: " + ex.Message);
        }

        // Повторная попытка: YouTube иногда отвечает ошибкой сразу после завершения.
        try
        {
            System.Threading.Thread.Sleep(3000);
            return CPH.YouTubeSetPrivacy("unlisted", broadcastId);
        }
        catch (Exception ex)
        {
            CPH.LogError("[" + ActionName + "] Повторный YouTubeSetPrivacy: " + ex.Message);
            return false;
        }
    }

    private void Notify(string text)
    {
        try
        {
            CPH.SetArgument("telegramText", text);
            CPH.SetArgument("telegramSilent", false);
            CPH.SetArgument("telegramDisablePreview", false);
            CPH.RunAction(TelegramAction, true);
        }
        catch (Exception ex)
        {
            CPH.LogWarn("[" + ActionName + "] Telegram недоступен: " + ex.Message);
        }
    }

    private string ReadBroadcastId()
    {
        string value;
        if (CPH.TryGetArg("broadcast.id", out value) && !string.IsNullOrWhiteSpace(value))
            return value.Trim();
        if (CPH.TryGetArg("broadcastId", out value) && !string.IsNullOrWhiteSpace(value))
            return value.Trim();
        return "";
    }

    private bool HasRecentGracefulIntent()
    {
        string intent = CPH.GetGlobalVar<string>(IntentKey, true) ?? "";
        if (!string.Equals(intent, "graceful", StringComparison.Ordinal))
            return false;
        long stopAt = CPH.GetGlobalVar<long>(StopAtKey, true);
        return stopAt > 0 && NowUnix() - stopAt <= IntentWindowSeconds;
    }

    // Штатная остановка из интерфейса OBS не оставляет в журнале ни реконнектов,
    // ни ошибок кодировщика. Это и есть второй (и основной) признак намерения.
    private bool IsCleanObsStop()
    {
        try
        {
            string path = NewestObsLog();
            if (path == null)
                return false;

            List<string> lines;
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            using (var reader = new StreamReader(stream))
            {
                lines = new List<string>();
                string line;
                while ((line = reader.ReadLine()) != null)
                    lines.Add(line);
            }

            int start = lines.FindLastIndex(l => l.IndexOf("==== Streaming Start", StringComparison.OrdinalIgnoreCase) >= 0);
            if (start < 0 || start >= lines.Count - 1)
                return false;

            bool stopped = false;
            for (int i = start; i < lines.Count; i++)
            {
                string line = lines[i];
                if (line.IndexOf("==== Streaming Stop", StringComparison.OrdinalIgnoreCase) >= 0)
                    stopped = true;
                if (HasFailureMarker(line))
                    return false;
            }
            return stopped;
        }
        catch (Exception ex)
        {
            CPH.LogWarn("[" + ActionName + "] Журнал OBS недоступен: " + ex.Message);
            return false;
        }
    }

    private static bool HasFailureMarker(string line)
    {
        string[] markers =
        {
            "reconnect", "encoder error", "failed to connect", "connection failed",
            "disconnected from", "socket error", "timed out", "streaming error",
            "an error occurred"
        };
        string lower = line.ToLowerInvariant();
        return markers.Any(marker => lower.Contains(marker));
    }

    private static string NewestObsLog()
    {
        string dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "obs-studio", "logs");
        if (!Directory.Exists(dir))
            return null;
        return Directory.GetFiles(dir, "*.txt")
            .Select(p => new FileInfo(p))
            .OrderByDescending(f => f.LastWriteTimeUtc)
            .Select(f => f.FullName)
            .FirstOrDefault();
    }

    private static long NowUnix()
    {
        return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds;
    }
}
