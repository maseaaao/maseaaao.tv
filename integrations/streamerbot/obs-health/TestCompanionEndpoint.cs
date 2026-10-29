using System;
using System.IO;
using System.Reflection;

public static class TestCompanionEndpoint
{
    private static void Assert(bool value, string message)
    {
        if (!value) throw new Exception(message);
    }

    public static int Main(string[] args)
    {
        if (args.Length != 1) throw new ArgumentException("Pass a disposable fixture directory.");
        string previous = Environment.GetEnvironmentVariable("COMPANION_CONFIG_DIR");
        string first = Path.Combine(args[0], "first");
        string second = Path.Combine(args[0], "second");
        Directory.CreateDirectory(first);
        Directory.CreateDirectory(second);
        File.WriteAllText(Path.Combine(first, "config.json"), "{\"bind_ip\":\"0.0.0.0\",\"http_port\":18123}");
        File.WriteAllText(Path.Combine(second, "config.json"), "{\"bind_ip\":\"localhost\",\"http_port\":18124}");
        try
        {
            Environment.SetEnvironmentVariable("COMPANION_CONFIG_DIR", first);
            Assert(CompanionEndpoint.Get() == "http://127.0.0.1:18123", "external Companion data directory and wildcard bind");
            Environment.SetEnvironmentVariable("COMPANION_CONFIG_DIR", second);
            Assert(CompanionEndpoint.Get() == "http://127.0.0.1:18123", "existing 60-second cache preserved");
            typeof(CompanionEndpoint).GetField("checkedAt", BindingFlags.NonPublic | BindingFlags.Static).SetValue(null, DateTime.UtcNow.AddMinutes(-2));
            Assert(CompanionEndpoint.Get() == "http://localhost:18124", "external directory reread after cache expiry");
            Console.WriteLine("PASS: external Companion directory, wildcard bind, cache and refresh; no network or live commands.");
            return 0;
        }
        catch (Exception error)
        {
            Console.WriteLine("FAIL: Companion endpoint regression: " + error.GetType().Name);
            return 1;
        }
        finally
        {
            Environment.SetEnvironmentVariable("COMPANION_CONFIG_DIR", previous);
            Directory.Delete(first, true);
            Directory.Delete(second, true);
        }
    }
}
