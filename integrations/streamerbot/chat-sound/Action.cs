using System;
using System.IO;

public class CPHInline
{
    public bool Execute()
    {
        string soundPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "maseaaao.tv", "integrations", "streamerbot", "chat-sound", "notif.mp3");
        if (!File.Exists(soundPath))
        {
            CPH.LogWarn("Chat notification sound not found: " + soundPath);
            return false;
        }

        CPH.PlaySound(soundPath, 0.15f, false, "chat-notification", false);
        return true;
    }
}