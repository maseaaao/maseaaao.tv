using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using Newtonsoft.Json.Linq;

// Hosts the moderation engine inside Streamer.bot. One Action starts it; others call
// ExecuteMethod("AI Moderation Engine", ...) so every path shares the same queue.
public class CPHInline
{
    private const string IntakeKey = "aiModeration.intake.v1";
    private const string CommandKey = "aiModeration.command.v1";
    private static readonly object Gate = new object();
    private static readonly object IntakeGate = new object();
    private static ModerationFiles files;
    private static ModerationEngine engine;
    private static ModerationWebServer web;
    private static Thread classifier;
    private static Thread output;
    private static int generation;
    private static volatile bool running;
    private static CPHInline host;
    private static ManualResetEvent stopped = new ManualResetEvent(false);

    public bool Execute()
    {
        lock (Gate) { host = this; }
        if (!EnsureStarted()) return false;
        // Keep the dedicated worker queue alive exactly like the DonationAlerts watcher.
        try { stopped.WaitOne(); } catch (Exception) { }
        return true;
    }

    public bool Start() { return EnsureStarted(); }

    private bool EnsureStarted()
    {
        lock (Gate)
        {
            if (host == null) host = this;
            if (engine != null) return true;
            return StartEngineLocked();
        }
    }

    private bool StartEngineLocked()
    {
        try
        {
            files = new ModerationFiles();
            var config = files.ReadConfig();
            engine = new ModerationEngine(files, new ModerationHttpTransport(), config);
            running = true;
            int currentGeneration = ++generation;
            classifier = new Thread((ThreadStart)delegate { ClassifyLoop(currentGeneration, engine); })
                { IsBackground = true, Name = "AI Moderation Classifier" };
            output = new Thread((ThreadStart)delegate { OutputLoop(currentGeneration, engine); })
                { IsBackground = true, Name = "AI Moderation Output" };
            classifier.Start();
            output.Start();
            if (web == null)
            {
                try
                {
                    web = new ModerationWebServer(
                        delegate { return engine; },
                        delegate { return files; },
                        RestartEngine,
                        Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "custom", "moderation"),
                        delegate { return CPH.GetGlobalVar<string>("daAccessToken", true) ?? ""; });
                    web.Start();
                    CPH.LogInfo("AI moderation web UI: http://127.0.0.1:" + ModerationWebServer.Port + "/");
                }
                catch (Exception)
                {
                    web = null;
                    CPH.LogWarn("AI moderation web UI failed to start; the queue keeps running without it.");
                }
            }
            CPH.LogInfo("AI moderation started. Output is " + (engine.Configuration.Paused ? "paused" : "enabled") + ".");
            return true;
        }
        catch (Exception ex)
        {
            running = false;
            CPH.LogWarn("AI moderation failed to start: " + ex.GetType().Name + ". No donation text will be released.");
            SafeDisposeEngine();
            return false;
        }
    }

    private void ClassifyLoop(int currentGeneration, ModerationEngine current)
    {
        while (running && currentGeneration == generation && current != null && !current.StopToken.IsCancellationRequested)
        {
            try
            {
                if (!current.ProcessOne(current.StopToken)) current.StopToken.WaitHandle.WaitOne(400);
            }
            catch (OperationCanceledException) { return; }
            catch (ObjectDisposedException) { return; }
            catch (Exception)
            {
                try { Host().CPH.LogWarn("AI moderation: classifier stopped on a storage or runtime error."); } catch (Exception) { }
                try { current.StopToken.WaitHandle.WaitOne(1000); } catch (Exception) { return; }
            }
        }
    }

    private void OutputLoop(int currentGeneration, ModerationEngine current)
    {
        while (running && currentGeneration == generation && current != null && !current.StopToken.IsCancellationRequested)
        {
            ModerationItem item;
            try { item = current.ClaimNext(); }
            catch (ObjectDisposedException) { return; }
            catch (Exception)
            {
                try { Host().CPH.LogWarn("AI moderation: output queue unavailable; nothing is released."); } catch (Exception) { }
                try { current.StopToken.WaitHandle.WaitOne(1000); } catch (Exception) { return; }
                continue;
            }
            if (item == null)
            {
                try { current.StopToken.WaitHandle.WaitOne(400); } catch (Exception) { return; }
                continue;
            }
            var config = current.Configuration;
            if (config.Paused || !config.OutputsReady)
            {
                // Stop may have been requested after ClaimNext; put the item back without showing it.
                try { current.ReturnToAllowed(item.Platform, item.Id, item.DeliveryToken); } catch (Exception) { }
                try { current.StopToken.WaitHandle.WaitOne(400); } catch (Exception) { return; }
                continue;
            }
            bool delivered = false;
            try { delivered = ModerationOutput.Display(Host().CPH, item, config, current.StopToken); }
            catch (Exception) { delivered = false; }
            try { current.Complete(item.Platform, item.Id, item.DeliveryToken, delivered); }
            catch (Exception) { }
            if (!delivered)
            {
                try { Host().CPH.LogWarn("AI moderation: delivery failed; the event is not replayed automatically."); } catch (Exception) { }
            }
        }
    }

    private static CPHInline Host()
    {
        var current = host;
        if (current == null) throw new InvalidOperationException("moderation host unavailable");
        return current;
    }

    public bool EnqueueIntake()
    {
        lock (IntakeGate)
        {
            if (!EnsureStarted()) return false;
            string raw = CPH.GetGlobalVar<string>(IntakeKey, false) ?? "";
            CPH.SetGlobalVar(IntakeKey, "", false);
            if (string.IsNullOrWhiteSpace(raw)) return false;
            if (raw.Length > 16384)
            {
                CPH.LogWarn("AI moderation: intake payload too large; event withheld.");
                return false;
            }
            try
            {
                var value = JObject.Parse(raw);
                var item = new ModerationItem
                {
                    Id = (string)value["id"],
                    Platform = (string)value["platform"],
                    Kind = (string)value["kind"],
                    Username = (string)value["username"],
                    Message = (string)value["message"],
                    Amount = (string)value["amount"],
                    Currency = (string)value["currency"],
                    ConvertedAmount = (string)value["convertedAmount"],
                    AudioPath = (string)value["audioPath"]
                };
                bool added = engine.Enqueue(item);
                if (!added) CPH.LogWarn("AI moderation: event rejected as duplicate or invalid; nothing was released.");
                return added;
            }
            catch (Exception)
            {
                CPH.LogWarn("AI moderation: intake payload invalid; event withheld.");
                return false;
            }
        }
    }

    public bool ShowWindow() { return OpenWebUi(); }

    public bool OpenWebUi()
    {
        if (!EnsureStarted()) return false;
        try
        {
            Process.Start(new ProcessStartInfo("http://127.0.0.1:" + ModerationWebServer.Port + "/")
                { UseShellExecute = true });
            return true;
        }
        catch (Exception)
        {
            CPH.LogWarn("AI moderation: web UI could not be opened in the default browser.");
            return false;
        }
    }

    public bool StopOutput()
    {
        return StopOutputInternal();
    }

    private bool StopOutputInternal()
    {
        if (engine == null) return false;
        try
        {
            var config = engine.Configuration;
            config.Paused = true;
            engine.Configure(config);
            engine.CancelActiveDisplay();
            files.SaveConfig(config);
            ModerationOutput.Stop(CPH, config);
            CPH.LogInfo("AI moderation: output paused by operator.");
            return true;
        }
        catch (Exception)
        {
            CPH.LogWarn("AI moderation: output could not be paused; stop the OBS source manually.");
            return false;
        }
    }

    public bool ResumeOutput()
    {
        if (!EnsureStarted()) return false;
        try
        {
            var config = engine.Configuration;
            config.Paused = false;
            engine.Configure(config);
            files.SaveConfig(config);
            if (!config.OutputsReady) CPH.LogWarn("AI moderation: output stays blocked until legacy public paths are disabled.");
            return true;
        }
        catch (Exception)
        {
            CPH.LogWarn("AI moderation: output could not be resumed.");
            return false;
        }
    }

    public bool RestartEngine()
    {
        lock (Gate)
        {
            if (host == null) host = this;
            try
            {
                running = false;
                generation++;
                SafeDisposeEngine();
                return StartEngineLocked();
            }
            catch (Exception)
            {
                try { CPH.LogWarn("AI moderation: restart failed; no donation text will be released."); } catch (Exception) { }
                return false;
            }
        }
    }

    public bool RunCommand()
    {
        if (!EnsureStarted()) return false;
        string raw = CPH.GetGlobalVar<string>(CommandKey, false) ?? "";
        CPH.SetGlobalVar(CommandKey, "", false);
        if (string.IsNullOrWhiteSpace(raw) || raw.Length > 2048) return false;
        try
        {
            var value = JObject.Parse(raw);
            string operation = (string)value["operation"];
            string platform = (string)value["platform"];
            string id = (string)value["id"];
            if (operation != "allow" && operation != "block" && operation != "retry" && operation != "replay") return false;
            bool changed = operation == "replay" ? engine.Replay(platform, id) : engine.Review(platform, id, operation);
            if (!changed) CPH.LogWarn("AI moderation: manual operation is not available for this status.");
            else CPH.LogInfo("AI moderation: manual " + operation + " applied.");
            return changed;
        }
        catch (Exception)
        {
            CPH.LogWarn("AI moderation: manual command invalid.");
            return false;
        }
    }

    public void Dispose()
    {
        lock (Gate)
        {
            running = false;
            generation++;
            if (web != null) { try { web.Dispose(); } catch (Exception) { } web = null; }
            SafeDisposeEngine();
            try { stopped.Set(); } catch (Exception) { }
        }
    }

    private static void SafeDisposeEngine()
    {
        if (engine != null)
        {
            try { engine.Dispose(); } catch (Exception) { }
            engine = null;
        }
    }
}
