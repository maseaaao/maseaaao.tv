using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;

// Outside the shared Google Drive/repository; encrypted for this Windows user.
public sealed class ModerationFiles : IModerationStore
{
    public readonly string DirectoryPath;

    public ModerationFiles()
        : this(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "maseaaao.tv", "moderation")) { }

    public ModerationFiles(string directory)
    {
        if (string.IsNullOrWhiteSpace(directory)) throw new ArgumentException("directory");
        DirectoryPath = directory;
    }

    private T Read<T>(string name) where T : class
    {
        string file = Path.Combine(DirectoryPath, name);
        if (!File.Exists(file)) return null;
        byte[] encrypted = File.ReadAllBytes(file);
        byte[] bytes = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser);
        return JsonConvert.DeserializeObject<T>(Encoding.UTF8.GetString(bytes));
    }

    private void Write(string name, object value)
    {
        Directory.CreateDirectory(DirectoryPath);
        string file = Path.Combine(DirectoryPath, name);
        string temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        byte[] encrypted = ProtectedData.Protect(
            Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(value)), null, DataProtectionScope.CurrentUser);
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                stream.Write(encrypted, 0, encrypted.Length);
                stream.Flush(true);
            }
            // Atomic replacement keeps a crash from leaving a half-written queue.
            if (File.Exists(file)) File.Replace(temporary, file, null);
            else File.Move(temporary, file);
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }

    public ModerationConfig ReadConfig()
    {
        try { return Read<ModerationConfig>("settings.dpapi") ?? new ModerationConfig(); }
        catch (Exception) { return new ModerationConfig(); }
    }

    public void SaveConfig(ModerationConfig value) { Write("settings.dpapi", value); }

    public ModerationState Load() { return Read<ModerationState>("queue.dpapi"); }

    public void Save(ModerationState state) { Write("queue.dpapi", state); }
}
