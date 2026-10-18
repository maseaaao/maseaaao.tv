using System;
using System.Diagnostics;
using System.IO;

public class CPHInline
{
    public bool Execute()
    {
        const string command = "__COMMAND__";
        const string script = @"__SCRIPT__";
        try
        {
            if (!File.Exists(script))
                throw new FileNotFoundException("Yandex Music control script is missing.", script);
            var start = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), @"System32\WindowsPowerShell\v1.0\powershell.exe"),
                Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\" -Command " + command,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            using (var process = Process.Start(start))
            {
                var output = process.StandardOutput.ReadToEndAsync();
                var error = process.StandardError.ReadToEndAsync();
                if (!process.WaitForExit(15000))
                {
                    process.Kill();
                    throw new TimeoutException("Yandex Music control timed out.");
                }
                string stdout = output.GetAwaiter().GetResult().Trim();
                string stderr = error.GetAwaiter().GetResult().Trim();
                if (process.ExitCode != 0)
                    throw new InvalidOperationException(stderr.Length > 0 ? stderr : stdout);
                CPH.LogInfo("[YandexMusic] " + command + " OK: " + stdout);
                return true;
            }
        }
        catch (Exception ex)
        {
            CPH.LogError("[YandexMusic] " + command + " failed: " + ex.Message);
            return false;
        }
    }
}
