using System;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;

public class CPHInline
{
    private const int ObsConnection = 0;
    // ОБЯЗАТЕЛЬНО поменяй на точные названия из OBS.
    private const string MicInputName = "1️⃣МИКРО";
    private const string CameraSourceName = "КАМЕРА";
    private static readonly string AlertSoundPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "maseaaao.tv", "apps", "obs-widgets", "dist", "sounds", "health-warning.mp3");
    private static string CompanionBaseUrl { get { return CompanionEndpoint.Get(); } }
    private const string TelegramSendActionName = "Telegram | SEND";
    // ВАЖНО: запускай этот Action каждые 10 секунд.
    // Так тяжёлые проверки выполняются реже, а реальные интервалы тревог
    // сохраняются за счёт скорректированного количества подтверждений.
    private const int CompanionTimeoutMilliseconds = 1500;
    private const int CompanionRetrySeconds = 60;
    // Сеть: предупреждаем только при сильной и устойчивой проблеме.
    private const double NetworkCongestionThreshold = 0.50;
    private const double NetworkCongestionRecoveryThreshold = 0.10;
    private const double NetworkDroppedFramesThresholdPercent = 1.0;
    // При запуске Action каждые 10 секунд: тревога примерно через 30 секунд.
    private const int NetworkBadChecksRequired = 3;
    // Восстановление только после примерно 60 секунд стабильной работы.
    private const int NetworkGoodChecksRequired = 6;
    // Раздельные пороги не дают настройке рендера затрагивать сеть и кодировщик.
    private const double EncoderDroppedFramesThresholdPercent = 2.0;
    private const double RenderDroppedFramesThresholdPercent = 3.0;
    // При шаге 10 секунд тревога и восстановление подтверждаются примерно 30 секунд.
    private const int EncoderRenderBadChecksRequired = 3;
    private const int EncoderRenderGoodChecksRequired = 3;
    // Камеру проверяем раз в 20 секунд при запуске общего Action каждые 10 секунд.
    private const int CameraCheckEveryRuns = 2;
    // Два повторно идентичных кадра после первого: около 40–60 секунд.
    private const int CameraSameChecksRequired = 2;
    // Отдельный порог, чтобы настройки рендера не меняли чувствительность камеры.
    private const int CameraEmptyChecksRequired = 2;
    private const int CameraErrorChecksRequired = 2;
    private const int CameraGoodChecksRequired = 2;
    // Одиночный сбой OBS-запроса не становится Telegram-тревогой.
    private const int InternalBadChecksRequired = 2;
    private const int InternalGoodChecksRequired = 2;
    // При сохраняющейся проблеме повторяем звук не чаще чем раз в 20 секунд.
    private const int SoundRepeatSeconds = 20;
    public bool Execute()
    {
        try
        {
            if (!CPH.ObsIsConnected(ObsConnection))
            {
                CPH.SetGlobalVar("obs.health.wasDisconnected", true, false);
                bool wasStreaming = CPH.GetGlobalVar<bool>("obs.health.lastStreaming", false);
                int failures = UpdateConsecutiveCounter("obs.health.connection.failures", true);
                if (wasStreaming && failures >= InternalBadChecksRequired)
                    ApplyHealthResult("CONNECTION", "Связь с OBS потеряна", 1);
                else
                    PublishCompanionState("OFFLINE", "НЕТ СВЯЗИ", GetSoundEnabled());
                return true;
            }
            if (CPH.GetGlobalVar<bool>("obs.health.wasDisconnected", false))
            {
                CPH.SetGlobalVar("obs.health.wasDisconnected", false, false);
                CPH.SetGlobalVar("obs.health.connection.failures", 0, false);
                foreach (string key in new[] { "obs_health_state", "obs_health_label", "obs_health_sound" })
                    CPH.SetGlobalVar("obs.health.companion." + key + ".sentAt", 0L, false);
                ResetRuntimeMetrics();
            }
            if (!CPH.ObsIsStreaming(ObsConnection))
            {
                CPH.SetGlobalVar("obs.health.lastStreaming", false, false);
                ResetRuntimeMetrics();
                CPH.SetGlobalVar("obs.health.signature", string.Empty, false);
                PublishCompanionState("IDLE", "IDLE", GetSoundEnabled());
                return true;
            }

            string streamStatus = SendObsRequest("GetStreamStatus", "{}");
            bool outputActive = ReadBoolean(streamStatus, "outputActive");
            if (!outputActive)
            {
                CPH.SetGlobalVar("obs.health.lastStreaming", false, false);
                ResetRuntimeMetrics();
                CPH.SetGlobalVar("obs.health.signature", string.Empty, false);
                PublishCompanionState("IDLE", "IDLE", GetSoundEnabled());
                return true;
            }

            CPH.SetGlobalVar("obs.health.lastStreaming", true, false);
            int runNumber = CPH.GetGlobalVar<int>("obs.health.runNumber", false) + 1;
            CPH.SetGlobalVar("obs.health.runNumber", runNumber, false);
            StringBuilder problemCodes = new StringBuilder();
            StringBuilder problemMessages = new StringBuilder();
            int problemCount = 0;
            CheckMicrophone(problemCodes, problemMessages, ref problemCount);
            CheckNetwork(streamStatus, problemCodes, problemMessages, ref problemCount);
            CheckRenderAndEncoder(problemCodes, problemMessages, ref problemCount);
            string cameraProblem = CheckCamera(runNumber);
            if (!string.IsNullOrEmpty(cameraProblem))
            {
                AddProblem(problemCodes, problemMessages, ref problemCount, "CAMERA", cameraProblem);
            }

            ApplySuccessfulHealthResult(problemCodes.ToString(), problemMessages.ToString(), problemCount);
        }
        catch (Exception exception)
        {
            CPH.LogError("OBS health-check failed: " + exception);
            HandleInternalFailure(exception);
        }

        return true;
    }

    private void CheckMicrophone(StringBuilder problemCodes, StringBuilder problemMessages, ref int problemCount)
    {
        string requestData = "{\"inputName\":\"" + EscapeJson(MicInputName) + "\"}";
        string response = SendObsRequest("GetInputMute", requestData);
        bool inputMuted = ReadBoolean(response, "inputMuted");
        if (inputMuted)
        {
            AddProblem(problemCodes, problemMessages, ref problemCount, "MIC", "Микрофон выключен");
        }
    }

    private void CheckNetwork(string streamStatus, StringBuilder problemCodes, StringBuilder problemMessages, ref int problemCount)
    {
        bool outputReconnecting = ReadBoolean(streamStatus, "outputReconnecting");
        double outputCongestion = ReadDouble(streamStatus, "outputCongestion");
        long outputSkippedFrames = ReadLong(streamStatus, "outputSkippedFrames");
        long outputTotalFrames = ReadLong(streamStatus, "outputTotalFrames");
        double recentDroppedPercent = CalculateRecentPercentage("obs.health.network", outputSkippedFrames, outputTotalFrames);
        bool networkProblemActive = CPH.GetGlobalVar<bool>("obs.health.network.problemActive", false);
        bool currentlyBad = outputReconnecting || outputCongestion >= NetworkCongestionThreshold || recentDroppedPercent >= NetworkDroppedFramesThresholdPercent;
        if (!networkProblemActive)
        {
            CPH.SetGlobalVar("obs.health.network.goodChecks", 0, false);
            int badChecks = UpdateConsecutiveCounter("obs.health.network.badChecks", currentlyBad);
            if (badChecks < NetworkBadChecksRequired)
            {
                return;
            }

            networkProblemActive = true;
            CPH.SetGlobalVar("obs.health.network.problemActive", true, false);
        }
        else
        {
            bool currentlyRecovered = !outputReconnecting && outputCongestion <= NetworkCongestionRecoveryThreshold && recentDroppedPercent < NetworkDroppedFramesThresholdPercent;
            int goodChecks = UpdateConsecutiveCounter("obs.health.network.goodChecks", currentlyRecovered);
            if (currentlyBad)
            {
                CPH.SetGlobalVar("obs.health.network.goodChecks", 0, false);
            }

            if (goodChecks >= NetworkGoodChecksRequired)
            {
                CPH.SetGlobalVar("obs.health.network.problemActive", false, false);
                CPH.SetGlobalVar("obs.health.network.badChecks", 0, false);
                CPH.SetGlobalVar("obs.health.network.goodChecks", 0, false);
                return;
            }
        }

        string message;
        if (outputReconnecting)
        {
            message = "Сеть: OBS переподключается";
        }
        else
        {
            message = "Сеть: congestion " + (outputCongestion * 100.0).ToString("0.0", CultureInfo.InvariantCulture) + "%; dropped " + recentDroppedPercent.ToString("0.00", CultureInfo.InvariantCulture) + "%";
        }

        AddProblem(problemCodes, problemMessages, ref problemCount, "NETWORK", message);
    }

    private void CheckRenderAndEncoder(StringBuilder problemCodes, StringBuilder problemMessages, ref int problemCount)
    {
        string stats = SendObsRequest("GetStats", "{}");
        long outputSkippedFrames = ReadLong(stats, "outputSkippedFrames");
        long outputTotalFrames = ReadLong(stats, "outputTotalFrames");
        long renderSkippedFrames = ReadLong(stats, "renderSkippedFrames");
        long renderTotalFrames = ReadLong(stats, "renderTotalFrames");
        double encoderDroppedPercent = CalculateRecentPercentage("obs.health.encoder", outputSkippedFrames, outputTotalFrames);
        double renderDroppedPercent = CalculateRecentPercentage("obs.health.render", renderSkippedFrames, renderTotalFrames);
        CheckFrameMetric(problemCodes, problemMessages, ref problemCount, "obs.health.encoder", "ENCODER", "Кодировщик", encoderDroppedPercent, EncoderDroppedFramesThresholdPercent);
        CheckFrameMetric(problemCodes, problemMessages, ref problemCount, "obs.health.render", "RENDER", "Рендер OBS", renderDroppedPercent, RenderDroppedFramesThresholdPercent);
    }

    private void CheckFrameMetric(StringBuilder problemCodes, StringBuilder problemMessages, ref int problemCount, string prefix, string code, string label, double recentDroppedPercent, double thresholdPercent)
    {
        string badChecksName = prefix + ".badChecks";
        string goodChecksName = prefix + ".goodChecks";
        string problemActiveName = prefix + ".problemActive";
        bool currentlyBad = recentDroppedPercent >= thresholdPercent;
        bool problemActive = CPH.GetGlobalVar<bool>(problemActiveName, false);
        int goodChecks = 0;
        if (!problemActive)
        {
            CPH.SetGlobalVar(goodChecksName, 0, false);
            int badChecks = UpdateConsecutiveCounter(badChecksName, currentlyBad);
            if (badChecks < EncoderRenderBadChecksRequired)
            {
                return;
            }

            problemActive = true;
            CPH.SetGlobalVar(problemActiveName, true, false);
        }
        else if (currentlyBad)
        {
            // Любая новая плохая проверка прерывает подтверждение восстановления.
            CPH.SetGlobalVar(goodChecksName, 0, false);
        }
        else
        {
            goodChecks = UpdateConsecutiveCounter(goodChecksName, true);
            if (goodChecks >= EncoderRenderGoodChecksRequired)
            {
                CPH.SetGlobalVar(problemActiveName, false, false);
                CPH.SetGlobalVar(badChecksName, 0, false);
                CPH.SetGlobalVar(goodChecksName, 0, false);
                return;
            }
        }

        string message;
        if (currentlyBad)
        {
            message = label + ": пропущено " + recentDroppedPercent.ToString("0.00", CultureInfo.InvariantCulture) + "% кадров";
        }
        else
        {
            message = label + ": восстановление подтверждается (" + goodChecks.ToString(CultureInfo.InvariantCulture) + "/" + EncoderRenderGoodChecksRequired.ToString(CultureInfo.InvariantCulture) + ")";
        }

        AddProblem(problemCodes, problemMessages, ref problemCount, code, message);
    }

    private string CheckCamera(int runNumber)
    {
        string previousProblem = CPH.GetGlobalVar<string>("obs.health.camera.problem", false) ?? string.Empty;
        if (runNumber % CameraCheckEveryRuns != 0)
        {
            return previousProblem;
        }

        try
        {
            string activeRequest = "{\"sourceName\":\"" + EscapeJson(CameraSourceName) + "\"}";
            string activeResponse = SendObsRequest("GetSourceActive", activeRequest);
            bool videoActive = ReadBoolean(activeResponse, "videoActive");
            // Камера сейчас не показана в Program — это не ошибка.
            if (!videoActive)
            {
                ResetCameraState();
                return string.Empty;
            }

            string screenshotRequest = "{" + "\"sourceName\":\"" + EscapeJson(CameraSourceName) + "\"," + "\"imageFormat\":\"png\"," + "\"imageWidth\":160," + "\"imageHeight\":90," + "\"imageCompressionQuality\":20" + "}";
            string screenshotResponse = SendObsRequest("GetSourceScreenshot", screenshotRequest);
            string currentImage = ReadString(screenshotResponse, "imageData");
            CPH.SetGlobalVar("obs.health.camera.errorChecks", 0, false);
            if (string.IsNullOrEmpty(currentImage))
            {
                CPH.SetGlobalVar("obs.health.camera.goodChecks", 0, false);
                int emptyChecks = UpdateConsecutiveCounter("obs.health.camera.emptyChecks", true);
                if (emptyChecks >= CameraEmptyChecksRequired)
                {
                    const string problem = "Камера: OBS не отдаёт кадр";
                    SetCameraProblem(problem);
                    return problem;
                }

                return previousProblem;
            }

            CPH.SetGlobalVar("obs.health.camera.emptyChecks", 0, false);
            string previousImage = CPH.GetGlobalVar<string>("obs.health.camera.previousImage", false) ?? string.Empty;
            int sameChecks = CPH.GetGlobalVar<int>("obs.health.camera.sameChecks", false);
            if (previousImage.Length > 0 && string.Equals(previousImage, currentImage, StringComparison.Ordinal))
            {
                sameChecks++;
            }
            else
            {
                sameChecks = 0;
            }

            CPH.SetGlobalVar("obs.health.camera.previousImage", currentImage, false);
            CPH.SetGlobalVar("obs.health.camera.sameChecks", sameChecks, false);
            if (previousImage.Length > 0 && string.Equals(previousImage, currentImage, StringComparison.Ordinal))
            {
                CPH.SetGlobalVar("obs.health.camera.goodChecks", 0, false);
                if (sameChecks >= CameraSameChecksRequired)
                {
                    const string problem = "Камера: кадр не меняется около минуты";
                    SetCameraProblem(problem);
                    return problem;
                }

                return previousProblem;
            }

            return ConfirmCameraRecovery(previousProblem);
        }
        catch (Exception exception)
        {
            CPH.LogWarn("Camera health-check error: " + exception.Message);
            CPH.SetGlobalVar("obs.health.camera.goodChecks", 0, false);
            int errorChecks = UpdateConsecutiveCounter("obs.health.camera.errorChecks", true);
            if (errorChecks < CameraErrorChecksRequired)
            {
                return previousProblem;
            }

            const string problem = "Камера: ошибка проверки источника";
            SetCameraProblem(problem);
            return problem;
        }
    }

    private string ConfirmCameraRecovery(string previousProblem)
    {
        if (string.IsNullOrEmpty(previousProblem))
        {
            CPH.SetGlobalVar("obs.health.camera.goodChecks", 0, false);
            return string.Empty;
        }

        int goodChecks = UpdateConsecutiveCounter("obs.health.camera.goodChecks", true);
        if (goodChecks < CameraGoodChecksRequired)
        {
            return previousProblem;
        }

        CPH.SetGlobalVar("obs.health.camera.goodChecks", 0, false);
        SetCameraProblem(string.Empty);
        return string.Empty;
    }

    private void ApplySuccessfulHealthResult(string signature, string messages, int problemCount)
    {
        CPH.SetGlobalVar("obs.health.internal.badChecks", 0, false);
        bool internalProblemActive = CPH.GetGlobalVar<bool>("obs.health.internal.problemActive", false);
        if (internalProblemActive)
        {
            int goodChecks = UpdateConsecutiveCounter("obs.health.internal.goodChecks", true);
            if (goodChecks < InternalGoodChecksRequired)
            {
                ApplyHealthResult("INTERNAL", "• Связь с OBS восстанавливается (" + goodChecks.ToString(CultureInfo.InvariantCulture) + "/" + InternalGoodChecksRequired.ToString(CultureInfo.InvariantCulture) + ")", 1);
                return;
            }

            CPH.SetGlobalVar("obs.health.internal.problemActive", false, false);
            CPH.SetGlobalVar("obs.health.internal.goodChecks", 0, false);
        }
        else
        {
            CPH.SetGlobalVar("obs.health.internal.goodChecks", 0, false);
        }

        ApplyHealthResult(signature, messages, problemCount);
    }

    private void HandleInternalFailure(Exception exception)
    {
        CPH.SetGlobalVar("obs.health.internal.goodChecks", 0, false);
        bool internalProblemActive = CPH.GetGlobalVar<bool>("obs.health.internal.problemActive", false);
        int badChecks = UpdateConsecutiveCounter("obs.health.internal.badChecks", true);
        if (!internalProblemActive && badChecks < InternalBadChecksRequired)
        {
            // Одиночный сбой только пишем в лог и сохраняем предыдущее состояние.
            return;
        }

        CPH.SetGlobalVar("obs.health.internal.problemActive", true, false);
        ApplyHealthResult("INTERNAL", "• Ошибка выполнения health-check: " + exception.Message, 1);
    }

    private void ApplyHealthResult(string signature, string messages, int problemCount)
    {
        string previousSignature = CPH.GetGlobalVar<string>("obs.health.signature", false) ?? string.Empty;
        bool previouslyHealthy = string.IsNullOrWhiteSpace(previousSignature);
        bool currentlyHealthy = string.IsNullOrWhiteSpace(signature);
        bool healthBoundaryChanged = previouslyHealthy != currentlyHealthy;
        if (healthBoundaryChanged)
        {
            SendHealthTelegramUpdate(currentlyHealthy, messages);
        }

        CPH.SetGlobalVar("obs.health.signature", signature, false);
        bool soundEnabled = GetSoundEnabled();
        long now = GetUnixTimeSeconds();
        long lastSoundAt = CPH.GetGlobalVar<long>("obs.health.lastSoundAt", false);
        bool soundCooldownElapsed = lastSoundAt <= 0 || now - lastSoundAt >= SoundRepeatSeconds;
        bool shouldPlaySound = problemCount > 0 && soundEnabled && soundCooldownElapsed;
        if (!currentlyHealthy && previouslyHealthy)
        {
            CPH.ShowToastNotification("OBS Health", messages);
        }

        if (shouldPlaySound)
        {
            if (File.Exists(AlertSoundPath))
            {
                CPH.PlaySound(AlertSoundPath, 0.3f, false, "obs-health-warning", true);
            }
            else
            {
                CPH.LogWarn("Health warning sound not found: " + AlertSoundPath);
            }

            CPH.SetGlobalVar("obs.health.lastSoundAt", now, false);
        }

        if (problemCount == 0)
        {
            CPH.SetGlobalVar("obs.health.lastSoundAt", 0L, false);
        }

        string state = problemCount == 0 ? "OK" : "WARN";
        string label;
        if (problemCount == 0)
        {
            label = "OK";
        }
        else if (problemCount == 1)
        {
            label = signature;
        }
        else
        {
            label = "WARN × " + problemCount;
        }

        PublishCompanionState(state, label, soundEnabled);
    }

    private void SendHealthTelegramUpdate(bool currentlyHealthy, string currentMessages)
    {
        string telegramMessage = currentlyHealthy ? "✅ OBS Health: все проблемы устранены." : "⚠️ OBS Health: обнаружена проблема\n\n" + currentMessages;
        CPH.SetArgument("telegramText", telegramMessage);
        CPH.SetArgument("telegramSilent", false);
        CPH.SetArgument("telegramDisablePreview", true);
        if (!CPH.RunAction(TelegramSendActionName, true))
        {
            CPH.LogWarn("Unable to run Telegram action: " + TelegramSendActionName);
        }
    }

    private string SendObsRequest(string requestType, string requestData)
    {
        string response = CPH.ObsSendRaw(requestType, requestData, ObsConnection);
        if (string.IsNullOrWhiteSpace(response))
        {
            throw new InvalidOperationException(requestType + " returned an empty response.");
        }

        return response;
    }

    private double CalculateRecentPercentage(string prefix, long currentSkipped, long currentTotal)
    {
        string initializedName = prefix + ".initialized";
        bool initialized = CPH.GetGlobalVar<bool>(initializedName, false);
        long previousSkipped = CPH.GetGlobalVar<long>(prefix + ".skipped", false);
        long previousTotal = CPH.GetGlobalVar<long>(prefix + ".total", false);
        CPH.SetGlobalVar(prefix + ".skipped", currentSkipped, false);
        CPH.SetGlobalVar(prefix + ".total", currentTotal, false);
        CPH.SetGlobalVar(initializedName, true, false);
        if (!initialized || currentSkipped < previousSkipped || currentTotal < previousTotal)
        {
            return 0.0;
        }

        long skippedDelta = currentSkipped - previousSkipped;
        long totalDelta = currentTotal - previousTotal;
        if (totalDelta <= 0)
        {
            return 0.0;
        }

        return skippedDelta * 100.0 / totalDelta;
    }

    private int UpdateConsecutiveCounter(string variableName, bool conditionMet)
    {
        if (!conditionMet)
        {
            CPH.SetGlobalVar(variableName, 0, false);
            return 0;
        }

        int value = CPH.GetGlobalVar<int>(variableName, false) + 1;
        CPH.SetGlobalVar(variableName, value, false);
        return value;
    }

    private void AddProblem(StringBuilder problemCodes, StringBuilder problemMessages, ref int problemCount, string code, string message)
    {
        if (problemCodes.Length > 0)
        {
            problemCodes.Append("|");
        }

        if (problemMessages.Length > 0)
        {
            problemMessages.AppendLine();
        }

        problemCodes.Append(code);
        problemMessages.Append("• ");
        problemMessages.Append(message);
        problemCount++;
    }

    private void PublishCompanionState(string state, string label, bool soundEnabled)
    {
        SetCompanionVariableIfChanged("obs_health_state", state);
        SetCompanionVariableIfChanged("obs_health_label", label);
        SetCompanionVariableIfChanged("obs_health_sound", soundEnabled ? "ON" : "OFF");
    }

    private void SetCompanionVariableIfChanged(string variableName, string value)
    {
        string cacheName = "obs.health.companion." + variableName;
        string previousValue = CPH.GetGlobalVar<string>(cacheName, false) ?? string.Empty;
        long now = GetUnixTimeSeconds();
        long sentAt = CPH.GetGlobalVar<long>(cacheName + ".sentAt", false);
        if (string.Equals(previousValue, value, StringComparison.Ordinal) && now - sentAt < 60)
        {
            return;
        }

        long retryAfter = CPH.GetGlobalVar<long>("obs.health.companion.retryAfter", false);
        if (retryAfter > now)
        {
            return;
        }

        try
        {
            string endpoint = CompanionBaseUrl.TrimEnd('/') + "/api/custom-variable/" + variableName + "/value";
            using (TimeoutWebClient client = new TimeoutWebClient(CompanionTimeoutMilliseconds))
            {
                client.Encoding = Encoding.UTF8;
                client.Headers[HttpRequestHeader.ContentType] = "text/plain; charset=utf-8";
                client.UploadString(endpoint, "POST", value);
            }

            CPH.SetGlobalVar(cacheName, value, false);
            CPH.SetGlobalVar(cacheName + ".sentAt", now, false);
            CPH.SetGlobalVar("obs.health.companion.retryAfter", 0L, false);
        }
        catch (Exception exception)
        {
            CPH.SetGlobalVar("obs.health.companion.retryAfter", now + CompanionRetrySeconds, false);
            CPH.LogWarn("Unable to update Companion variable " + variableName + ": " + exception.Message);
        }
    }

    private sealed class TimeoutWebClient : WebClient
    {
        private readonly int timeoutMilliseconds;
        public TimeoutWebClient(int timeoutMilliseconds)
        {
            this.timeoutMilliseconds = timeoutMilliseconds;
        }

        protected override WebRequest GetWebRequest(Uri address)
        {
            WebRequest request = base.GetWebRequest(address);
            request.Timeout = timeoutMilliseconds;
            HttpWebRequest httpRequest = request as HttpWebRequest;
            if (httpRequest != null)
            {
                httpRequest.ReadWriteTimeout = timeoutMilliseconds;
                httpRequest.KeepAlive = false;
            }

            return request;
        }
    }

    private bool GetSoundEnabled()
    {
        string stored = CPH.GetGlobalVar<string>("obs.health.sound.enabled", true);
        if (string.IsNullOrWhiteSpace(stored))
        {
            return true;
        }

        return string.Equals(stored, "true", StringComparison.OrdinalIgnoreCase);
    }

    private void ResetRuntimeMetrics()
    {
        string[] variables =
        {
            "obs.health.runNumber",
            "obs.health.network.initialized",
            "obs.health.network.skipped",
            "obs.health.network.total",
            "obs.health.network.badChecks",
            "obs.health.network.problemActive",
            "obs.health.network.goodChecks",
            "obs.health.encoder.initialized",
            "obs.health.encoder.skipped",
            "obs.health.encoder.total",
            "obs.health.encoder.badChecks",
            "obs.health.encoder.problemActive",
            "obs.health.encoder.goodChecks",
            "obs.health.render.initialized",
            "obs.health.render.skipped",
            "obs.health.render.total",
            "obs.health.render.badChecks",
            "obs.health.render.problemActive",
            "obs.health.render.goodChecks",
            "obs.health.camera.previousImage",
            "obs.health.camera.sameChecks",
            "obs.health.camera.emptyChecks",
            "obs.health.camera.errorChecks",
            "obs.health.camera.goodChecks",
            "obs.health.camera.problem",
            "obs.health.internal.badChecks",
            "obs.health.internal.goodChecks",
            "obs.health.internal.problemActive",
            "obs.health.lastSoundAt"
        };
        for (int index = 0; index < variables.Length; index++)
        {
            CPH.UnsetGlobalVar(variables[index], false);
        }
    }

    private void ResetCameraState()
    {
        CPH.UnsetGlobalVar("obs.health.camera.previousImage", false);
        CPH.UnsetGlobalVar("obs.health.camera.sameChecks", false);
        CPH.UnsetGlobalVar("obs.health.camera.emptyChecks", false);
        CPH.UnsetGlobalVar("obs.health.camera.errorChecks", false);
        CPH.UnsetGlobalVar("obs.health.camera.goodChecks", false);
        CPH.UnsetGlobalVar("obs.health.camera.problem", false);
    }

    private void SetCameraProblem(string value)
    {
        CPH.SetGlobalVar("obs.health.camera.problem", value, false);
    }

    private long GetUnixTimeSeconds()
    {
        DateTime epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        return (long)(DateTime.UtcNow - epoch).TotalSeconds;
    }

    private bool ReadBoolean(string json, string propertyName)
    {
        string raw = ReadRawValue(json, propertyName);
        bool value;
        if (!bool.TryParse(raw, out value))
        {
            throw new InvalidOperationException("OBS response has no valid boolean property '" + propertyName + "'.");
        }

        return value;
    }

    private long ReadLong(string json, string propertyName)
    {
        string raw = ReadRawValue(json, propertyName);
        long value;
        if (!long.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out value))
        {
            throw new InvalidOperationException("OBS response has no valid integer property '" + propertyName + "'.");
        }

        return value;
    }

    private double ReadDouble(string json, string propertyName)
    {
        string raw = ReadRawValue(json, propertyName);
        double value;
        if (!double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out value))
        {
            throw new InvalidOperationException("OBS response has no valid numeric property '" + propertyName + "'.");
        }

        return value;
    }

    private string ReadString(string json, string propertyName)
    {
        int start = FindValueStart(json, propertyName);
        if (start < 0 || start >= json.Length || json[start] != '"')
        {
            throw new InvalidOperationException("OBS response has no valid string property '" + propertyName + "'.");
        }

        start++;
        StringBuilder value = new StringBuilder();
        bool escaped = false;
        for (int index = start; index < json.Length; index++)
        {
            char character = json[index];
            if (escaped)
            {
                value.Append(character);
                escaped = false;
                continue;
            }

            if (character == '\\')
            {
                escaped = true;
                continue;
            }

            if (character == '"')
            {
                break;
            }

            value.Append(character);
        }

        return value.ToString();
    }

    private string ReadRawValue(string json, string propertyName)
    {
        int start = FindValueStart(json, propertyName);
        if (start < 0)
        {
            return string.Empty;
        }

        int end = start;
        while (end < json.Length)
        {
            char character = json[end];
            bool partOfValue = char.IsLetterOrDigit(character) || character == '-' || character == '+' || character == '.' || character == 'e' || character == 'E';
            if (!partOfValue)
            {
                break;
            }

            end++;
        }

        return json.Substring(start, end - start).Trim();
    }

    private int FindValueStart(string json, string propertyName)
    {
        string needle = "\"" + propertyName + "\"";
        int propertyIndex = json.IndexOf(needle, StringComparison.Ordinal);
        if (propertyIndex < 0)
        {
            return -1;
        }

        int colonIndex = json.IndexOf(':', propertyIndex + needle.Length);
        if (colonIndex < 0)
        {
            return -1;
        }

        int start = colonIndex + 1;
        while (start < json.Length && char.IsWhiteSpace(json[start]))
        {
            start++;
        }

        return start;
    }

    private string EscapeJson(string value)
    {
        if (value == null)
        {
            return string.Empty;
        }

        return value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n").Replace("\t", "\\t");
    }
}