using System;

// Action "AI Moderation | Панель": opens the localhost web UI in the default browser.
public class CPHInline
{
    public bool Execute() { return CPH.ExecuteMethod("AI Moderation Engine", "OpenWebUi"); }
}
