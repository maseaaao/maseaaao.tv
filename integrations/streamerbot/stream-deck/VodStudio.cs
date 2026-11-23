using System;

public class CPHInline
{
    public bool Execute()
    {
        string url = CPH.GetGlobalVar<string>("vod.last.studioUrl", true);
        if (string.IsNullOrWhiteSpace(url))
            url = "https://studio.youtube.com/channel/UCyJNPWpOcPfMo5csKa27yGg/videos";
        try
        {
            System.Diagnostics.Process.Start(url);
            return true;
        }
        catch (Exception ex)
        {
            CPH.LogWarn("Cannot open YouTube Studio: " + ex.Message);
            return false;
        }
    }
}
