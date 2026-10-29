public static class CompanionEndpoint
{
    private static readonly object Sync = new object();
    private static string cached;
    private static System.DateTime checkedAt;
    public static string Get()
    {
        lock (Sync) {
            if (cached != null && (System.DateTime.UtcNow - checkedAt).TotalSeconds < 60) return cached;
            var directory = System.Environment.GetEnvironmentVariable("COMPANION_CONFIG_DIR");
            if (string.IsNullOrWhiteSpace(directory)) directory = System.Environment.GetEnvironmentVariable("COMPANION_CONFIG_DIR", System.EnvironmentVariableTarget.User);
            if (string.IsNullOrWhiteSpace(directory)) directory = System.IO.Path.Combine(System.AppDomain.CurrentDomain.BaseDirectory, "custom", "companion", "data");
            var file = System.IO.Path.Combine(directory, "config.json");
            var config = Newtonsoft.Json.Linq.JObject.Parse(System.IO.File.ReadAllText(file));
            string host = (string)config["bind_ip"];
            if (string.IsNullOrEmpty(host) || host == "0.0.0.0" || host == "::") host = "127.0.0.1";
            var url = new System.UriBuilder("http", host, (int)config["http_port"]);
            cached = url.Uri.GetLeftPart(System.UriPartial.Authority);
            checkedAt = System.DateTime.UtcNow;
            return cached;
        }
    }
}
