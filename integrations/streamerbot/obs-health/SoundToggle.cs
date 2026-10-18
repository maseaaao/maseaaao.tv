using System;
using System.Net.Http;
using System.Text;

public class CPHInline
{
    private static string CompanionBaseUrl { get { return CompanionEndpoint.Get(); } }
    private static readonly HttpClient Http = new HttpClient
    {
        Timeout = TimeSpan.FromSeconds(2)
    };

    public bool Execute()
    {
        string stored = CPH.GetGlobalVar<string>("obs.health.sound.enabled", true);
        bool currentlyEnabled = string.IsNullOrWhiteSpace(stored) || string.Equals(stored, "true", StringComparison.OrdinalIgnoreCase);
        bool newValue = !currentlyEnabled;
        CPH.SetGlobalVar("obs.health.sound.enabled", newValue ? "true" : "false", true);
        CPH.SetGlobalVar("obs.health.companion.obs_health_sound.sentAt", 0L, false);
        SetCompanionVariable("obs_health_sound", newValue ? "ON" : "OFF");
        CPH.ShowToastNotification("OBS Health", newValue ? "Повторяющийся звук включён." : "Повторяющийся звук выключен.");
        return true;
    }

    private void SetCompanionVariable(string variableName, string value)
    {
        try
        {
            string endpoint = CompanionBaseUrl.TrimEnd('/') + "/api/custom-variable/" + variableName + "/value";
            using (var content = new StringContent(value, Encoding.UTF8, "text/plain"))
            using (HttpResponseMessage response = Http.PostAsync(endpoint, content).GetAwaiter().GetResult())
            {
                if (!response.IsSuccessStatusCode)
                    CPH.LogWarn("Unable to update Companion variable: HTTP " + (int)response.StatusCode);
            }
        }
        catch (Exception exception)
        {
            CPH.LogWarn("Unable to update Companion variable: " + exception.Message);
        }
    }
}