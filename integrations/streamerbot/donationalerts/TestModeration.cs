using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;

public sealed class MemoryStore : IModerationStore
{
    public ModerationState State;
    public int Saves;
    public ModerationState Load()
    {
        return State == null ? null : JsonConvert.DeserializeObject<ModerationState>(JsonConvert.SerializeObject(State));
    }
    public void Save(ModerationState state)
    {
        State = JsonConvert.DeserializeObject<ModerationState>(JsonConvert.SerializeObject(state));
        Saves++;
    }
}

public sealed class FakeTransport : IModerationTransport
{
    private readonly object gate = new object();
    public readonly List<string> Calls = new List<string>();
    public Func<string, string> Handler;
    public string Complete(string provider, ModerationConfig config, string session, string payload, CancellationToken cancellation)
    {
        lock (gate) Calls.Add(provider);
        if (Handler == null) throw new InvalidOperationException("http_500");
        return Handler(provider);
    }
}

public static class TestModeration
{
    private static int passed;
    private static void Assert(bool value, string name)
    {
        if (!value) throw new Exception("FAIL: " + name);
        passed++;
    }
    private static string Decision(string decision, string reason) { return "{\"decision\":\"" + decision + "\",\"reason\":\"" + reason + "\"}"; }
    private static ModerationItem Item(string id, string message = "спасибо за стрим", string kind = "text")
    {
        return new ModerationItem { Id = id, Platform = "donationalerts", Kind = kind, Username = "Зритель", Message = message, Amount = "100", Currency = "RUB" };
    }
    private static ModerationEngine NewEngine(MemoryStore store, FakeTransport transport, ModerationConfig config = null)
    {
        return new ModerationEngine(store, transport, config ?? new ModerationConfig());
    }
    private static ModerationItem Find(ModerationEngine engine, string id) { return engine.Snapshot().First(x => x.Id == id); }

    public static void Main()
    {
        TestDecisionContract();
        TestAllowAndBlock();
        TestFallback();
        TestBothProvidersFail();
        TestRulesMissing();
        TestAudioAndLimits();
        TestHistoryImport();
        TestDeduplication();
        TestRestartRecovery();
        TestManualAndDelivery();
        TestOverflowAndRetention();
        TestNormalization();
        TestTransportKeySafety();
        TestStorage();
        TestConcurrency();
        Console.WriteLine("PASS " + passed + " assertions");
    }

    private static void TestDecisionContract()
    {
        var ok = ModerationEngine.ParseDecision(Decision("allow", "шутка"));
        Assert(ok.Item1 == "allow" && ok.Item2 == "шутка", "valid decision");
        var fenced = ModerationEngine.ParseDecision("```json\n{\"decision\":\"block\",\"reason\":\"угроза\"}\n```");
        Assert(fenced.Item1 == "block", "fenced decision");
        foreach (var raw in new[] {
            "{\"decision\":\"allow\",\"reason\":\"ok\",\"extra\":1}",
            "{\"decision\":\"allow\",\"reason\":\"ok\",\"reason\":\"dup\"}",
            "{\"decision\":\"yes\",\"reason\":\"ok\"}",
            "{\"decision\":\"allow\",\"reason\":\"\"}",
            "not json"
        })
        {
            bool rejected = false;
            try { ModerationEngine.ParseDecision(raw); } catch (InvalidOperationException) { rejected = true; }
            Assert(rejected, "invalid decision rejected: " + raw);
        }
    }

    private static void TestAllowAndBlock()
    {
        var store = new MemoryStore();
        var transport = new FakeTransport { Handler = p => Decision("allow", "обычная шутка") };
        using (var engine = NewEngine(store, transport))
        {
            Assert(engine.Enqueue(Item("1")), "enqueue allow");
            Assert(engine.ProcessOne(CancellationToken.None), "process allow");
            var item = Find(engine, "1");
            Assert(item.Status == "allowed" && item.Provider == "OpenCode Go", "allowed by Go");
            Assert(transport.Calls.Count == 1 && transport.Calls[0] == "OpenCode Go", "Go is first");
        }

        store = new MemoryStore();
        transport = new FakeTransport { Handler = p => Decision("block", "жёсткое оскорбление") };
        using (var engine = NewEngine(store, transport))
        {
            engine.Enqueue(Item("2"));
            engine.ProcessOne(CancellationToken.None);
            var item = Find(engine, "2");
            Assert(item.Status == "blocked" && item.Reason == "жёсткое оскорбление", "blocked by Go");
            Assert(transport.Calls.Count == 1, "Go block does not trigger fallback");
        }
    }

    private static void TestFallback()
    {
        var store = new MemoryStore();
        var transport = new FakeTransport { Handler = p => p == "OpenCode Go" ? throw new InvalidOperationException("invalid_decision") : Decision("allow", "резерв") };
        using (var engine = NewEngine(store, transport))
        {
            engine.Enqueue(Item("3"));
            engine.ProcessOne(CancellationToken.None);
            var item = Find(engine, "3");
            Assert(item.Status == "allowed" && item.Provider == "DeepSeek API", "fallback to DeepSeek");
            Assert(transport.Calls.SequenceEqual(new[] { "OpenCode Go", "DeepSeek API" }), "fallback order");
            Assert(item.ProviderError.Contains("invalid_decision"), "invalid Go response recorded");
        }
    }

    private static void TestBothProvidersFail()
    {
        var store = new MemoryStore();
        var transport = new FakeTransport { Handler = p => { throw new InvalidOperationException("http_503"); } };
        using (var engine = NewEngine(store, transport))
        {
            engine.Enqueue(Item("4"));
            engine.ProcessOne(CancellationToken.None);
            var item = Find(engine, "4");
            Assert(item.Status == "review" && item.Reason == "providers_unavailable", "both providers fail safe");
            Assert(item.Provider == "", "no provider claims a decision");
            Assert(item.ProviderError.Contains("http_503"), "known error code retained");
            Assert(!item.ProviderError.Contains("key"), "no secret text in error");
        }
    }

    private static void TestRulesMissing()
    {
        var store = new MemoryStore();
        var transport = new FakeTransport { Handler = p => Decision("allow", "ok") };
        var config = new ModerationConfig { Rules = " " };
        using (var engine = NewEngine(store, transport, config))
        {
            engine.Enqueue(Item("5"));
            engine.ProcessOne(CancellationToken.None);
            var item = Find(engine, "5");
            Assert(item.Status == "review" && item.Reason == "rules_not_configured", "missing rules never allow");
            Assert(transport.Calls.Count == 0, "no provider call without rules");
        }
    }

    private static void TestAudioAndLimits()
    {
        var store = new MemoryStore();
        var transport = new FakeTransport { Handler = p => Decision("allow", "ok") };
        using (var engine = NewEngine(store, transport))
        {
            engine.Enqueue(Item("6", "[голосовое сообщение]", "audio"));
            var audio = Find(engine, "6");
            Assert(audio.Status == "review" && audio.Reason == "audio_requires_manual_review", "audio manual review");
            engine.Enqueue(Item("7", new string('x', 5000)));
            var longItem = Find(engine, "7");
            Assert(longItem.Status == "review" && longItem.Reason == "input_too_long", "long input withheld");
            Assert(longItem.Message.Length == 4000, "long input truncated");
            Assert(engine.Review("donationalerts", "6", "allow"), "audio can be allowed manually");
            Assert(Find(engine, "6").Status == "allowed", "audio allow released");
            Assert(!engine.Review("donationalerts", "7", "allow"), "truncated input cannot be allowed");
        }
    }

    private static void TestHistoryImport()
    {
        var store = new MemoryStore();
        var transport = new FakeTransport { Handler = p => Decision("allow", "ok") };
        using (var engine = NewEngine(store, transport))
        {
            var old = Item("history-1");
            old.CreatedUtc = new DateTime(2025, 1, 2, 3, 4, 5, DateTimeKind.Utc);
            Assert(engine.ImportHistorical(new List<ModerationItem> { old, old.Copy() }) == 1, "history deduplicates by id");
            Assert(Find(engine, "history-1").Status == "historical", "history is archived, not queued for output");
            Assert(engine.ClaimNext() == null, "history never auto-displays");
            var config = engine.Configuration;
            config.OutputsReady = true;
            config.Paused = false;
            engine.Configure(config);
            Assert(engine.Replay("donationalerts", "history-1"), "history can be replayed explicitly");
            Assert(engine.ClaimNext() != null, "replayed history is displayable");
        }
    }

    private static void TestDeduplication()
    {
        var store = new MemoryStore();
        var transport = new FakeTransport { Handler = p => Decision("allow", "ok") };
        using (var engine = NewEngine(store, transport))
        {
            Assert(engine.Enqueue(Item("8")), "first event accepted");
            Assert(!engine.Enqueue(Item("8")), "duplicate rejected");
            Assert(engine.Snapshot().Count == 1, "one queued item");
            Assert(!engine.Enqueue(new ModerationItem { Id = "", Platform = "donationalerts", Kind = "text" }), "empty id rejected");
        }
    }

    private static void TestRestartRecovery()
    {
        var store = new MemoryStore
        {
            State = new ModerationState
            {
                SessionId = "session",
                Items = new List<ModerationItem>
                {
                    new ModerationItem { Id = "9", Platform = "donationalerts", Kind = "text", Status = "checking" },
                    new ModerationItem { Id = "10", Platform = "donationalerts", Kind = "text", Status = "displaying" }
                }
            }
        };
        var transport = new FakeTransport();
        using (var engine = NewEngine(store, transport))
        {
            Assert(Find(engine, "9").Status == "review" && Find(engine, "9").Reason == "restart_during_check", "checking becomes review");
            Assert(Find(engine, "10").Status == "delivery_unknown" && Find(engine, "10").Reason == "restart_during_delivery", "displaying is not replayed");
            Assert(store.State.Items.First(x => x.Id == "9").Status == "review", "restart recovery persisted");
        }
    }

    private static void TestManualAndDelivery()
    {
        var store = new MemoryStore();
        var transport = new FakeTransport { Handler = p => { throw new InvalidOperationException("http_500"); } };
        using (var engine = NewEngine(store, transport))
        {
            engine.Enqueue(Item("11"));
            engine.ProcessOne(CancellationToken.None);
            Assert(Find(engine, "11").Status == "review", "manual candidate in review");
            var config = engine.Configuration;
            config.OutputsReady = true;
            config.Paused = false;
            engine.Configure(config);
            Assert(engine.Review("donationalerts", "11", "allow"), "manual allow");
            var claimed = engine.ClaimNext();
            Assert(claimed != null && claimed.Status == "displaying" && claimed.DeliveryToken.Length == 32, "claim marks displaying");
            Assert(engine.ActiveDisplay() != null && engine.ActiveDeliveryToken() == claimed.DeliveryToken, "active display exposed");
            Assert(engine.ReturnToAllowed("donationalerts", "11", claimed.DeliveryToken), "stop returns item to allowed");
            Assert(engine.ActiveDisplay() == null && engine.ActiveDeliveryToken() == "", "stop clears active display");
            Assert(Find(engine, "11").Status == "allowed", "returned item is not lost");
            var again = engine.ClaimNext();
            Assert(again != null && again.DeliveryToken != claimed.DeliveryToken, "reclaim after stop");
            Assert(engine.ActiveDisplay() != null, "active display after reclaim");
            Assert(engine.ClaimNext() == null, "no second claim expected");
            Assert(engine.CancelActiveDisplay() && engine.ActiveDisplay() == null, "pause cancels active display");
            Assert(Find(engine, "11").Status == "allowed", "cancelled display returns to allowed");
            var third = engine.ClaimNext();
            Assert(third != null, "reclaim after pause");
            Assert(engine.Complete("donationalerts", "11", "wrong", true) == false, "wrong delivery token rejected");
            Assert(engine.Complete("donationalerts", "11", third.DeliveryToken, true), "delivery complete");
            Assert(engine.ActiveDisplay() == null, "complete clears active display");
            Assert(Find(engine, "11").Status == "displayed", "displayed after delivery");
            Assert(!engine.Complete("donationalerts", "11", third.DeliveryToken, true), "delivery cannot repeat");
            Assert(engine.Replay("donationalerts", "11"), "replay displayed item");
            Assert(Find(engine, "11").Status == "allowed", "replayed item becomes allowed");
            var replay = engine.ClaimNext();
            Assert(replay != null && engine.Complete("donationalerts", "11", replay.DeliveryToken, true),
                "replayed item can be delivered again");
        }
    }

    private static void TestOverflowAndRetention()
    {
        var old = new ModerationItem
        {
            Id = "old",
            Platform = "donationalerts",
            Kind = "text",
            Username = "старый",
            Message = "старое сообщение",
            Status = "blocked",
            UpdatedUtc = DateTime.UtcNow.AddDays(-2)
        };
        var store = new MemoryStore
        {
            State = new ModerationState { SessionId = "session", Items = new List<ModerationItem> { old } }
        };
        var transport = new FakeTransport { Handler = p => Decision("allow", "ok") };
        using (var engine = NewEngine(store, transport))
        {
            for (int i = 0; i < 101; i++) engine.Enqueue(Item("q" + i));
            var items = engine.Snapshot();
            Assert(items.Count(x => x.Status == "pending") == 100, "queue capped at 100 pending");
            Assert(items.First(x => x.Id == "q100").Reason == "queue_overflow", "overflow becomes review");
            var retained = items.First(x => x.Id == "old");
            Assert(retained.Message == "" && retained.Username == "" && retained.Reason == "retained_id_only", "old content redacted, id retained");
        }
    }

    private static void TestNormalization()
    {
        Assert(ModerationEngine.Normalize("ＭАТ") == "mat", "full-width and homoglyph normalization");
        Assert(ModerationEngine.Compact("м а т") == "mat", "split letters compacted");
        Assert(ModerationEngine.Normalize("  Hello   World ") == "hello world", "whitespace collapsed");
    }

    private static void TestTransportKeySafety()
    {
        using (var transport = new ModerationHttpTransport())
        {
            bool missing = false;
            try { transport.Complete("OpenCode Go", new ModerationConfig(), "s", "{}", CancellationToken.None); }
            catch (InvalidOperationException ex) { missing = ex.Message == "missing_key"; }
            Assert(missing, "missing key rejected before network");
            bool invalid = false;
            try { transport.Complete("OpenCode Go", new ModerationConfig { GoKey = "x", GoModel = new string('m', 101) }, "s", "{}", CancellationToken.None); }
            catch (InvalidOperationException ex) { invalid = ex.Message == "invalid_model"; }
            Assert(invalid, "oversized model rejected");
        }
    }

    private static void TestConcurrency()
    {
        var store = new MemoryStore();
        var transport = new FakeTransport { Handler = p => Decision("allow", "ok") };
        using (var engine = NewEngine(store, transport))
        {
            var writers = Enumerable.Range(0, 20)
                .Select(i => Task.Run(() => engine.Enqueue(Item("concurrent" + i))))
                .ToArray();
            Task.WaitAll(writers);
            Assert(engine.Snapshot().Count == 20, "concurrent enqueue keeps every event");
            Parallel.For(0, 4, i =>
            {
                while (engine.ProcessOne(CancellationToken.None)) { }
            });
            Assert(engine.Snapshot().All(x => x.Status == "allowed"), "concurrent workers classify once per event");
            Assert(transport.Calls.Count == 20, "each event gets one provider call");
        }
    }

    private static void TestStorage()
    {
        string dir = Path.Combine(Path.GetTempPath(), "moderation-test-" + Guid.NewGuid().ToString("N"));
        try
        {
            var files = new ModerationFiles(dir);
            var config = new ModerationConfig { GoKey = "secret-go-key", OutputsReady = true, ObsTextSource = "AI | Донат" };
            files.SaveConfig(config);
            var loaded = files.ReadConfig();
            Assert(loaded.GoKey == "secret-go-key" && loaded.OutputsReady, "DPAPI config roundtrip");
            byte[] raw = File.ReadAllBytes(Path.Combine(dir, "settings.dpapi"));
            Assert(!Encoding.UTF8.GetString(raw).Contains("secret-go-key"), "keys are not stored as plaintext");

            var state = new ModerationState { SessionId = "s", Items = new List<ModerationItem> { Item("stored") } };
            files.Save(state);
            var restored = files.Load();
            Assert(restored.SessionId == "s" && restored.Items.Count == 1 && restored.Items[0].Id == "stored", "DPAPI queue roundtrip");
            Assert(!Encoding.UTF8.GetString(File.ReadAllBytes(Path.Combine(dir, "queue.dpapi"))).Contains("спасибо"), "message text is encrypted");
        }
        finally
        {
            if (Directory.Exists(dir)) Directory.Delete(dir, true);
        }
    }
}
