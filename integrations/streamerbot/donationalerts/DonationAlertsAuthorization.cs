using System;
public class CPHInline
{
    public bool Execute()
    {
        if (!CPH.ExecuteMethod("DonationAlerts Integration", "CreateAuthLink")) return false;
        if (!CPH.ExecuteMethod("DonationAlerts Integration", "ObtainAccessToken")) return false;
        CPH.RunAction("-- DonationAlerts Background Watcher", false);
        return true;
    }
}