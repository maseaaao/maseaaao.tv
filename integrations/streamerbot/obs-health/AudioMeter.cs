namespace ObsHealthAudio
{
    using System;
    using System.Diagnostics;
    using System.Globalization;
    using System.IO;
    using System.Net.WebSockets;
    using System.Security.Cryptography;
    using System.Text;
    using System.Threading;
    using Newtonsoft.Json.Linq;

    // Уровень микса OBS: obs-websocket отдаёт его только high-volume событием
    // InputVolumeMeters, поэтому Action на пару секунд подключается к серверу OBS
    // отдельным клиентом и слушает событие, не трогая основное подключение Streamer.bot.
    internal sealed class AudioMeterResult
    {
        public bool Success;
        public double PeakDb = -100.0;
        public string Error = string.Empty;
    }

    internal static class ObsAudioMeter
    {
        private const int ConnectTimeoutMilliseconds = 2000;
        private const int IdentifyTimeoutMilliseconds = 2000;
        private const int ReceiveBufferBytes = 8192;
        private const int InputVolumeMetersSubscription = 1 << 16;

        public static AudioMeterResult Sample(int sampleMilliseconds)
        {
            try
            {
                JObject connection = LoadConnection();
                string host = ReadString(connection, "host");
                int port = ReadInt(connection, "port", 4455);
                string password = ReadString(connection, "password");
                return Sample(host, port, password, sampleMilliseconds);
            }
            catch (Exception exception)
            {
                return Failure(exception);
            }
        }

        internal static AudioMeterResult Sample(string host, int port, string password, int sampleMilliseconds)
        {
            AudioMeterResult result = new AudioMeterResult();
            ClientWebSocket socket = new ClientWebSocket();
            try
            {
                socket.Options.KeepAliveInterval = TimeSpan.Zero;
                Connect(socket, host, port);
                JObject hello = ReadMessage(socket, IdentifyTimeoutMilliseconds);
                if (hello == null || ReadInt(hello, "op", -1) != 0)
                {
                    throw new InvalidOperationException("OBS не прислал Hello.");
                }

                JObject helloData = hello["d"] as JObject;
                if (helloData == null)
                {
                    throw new InvalidOperationException("OBS прислал Hello без данных.");
                }

                int rpcVersion = ReadInt(helloData, "rpcVersion", 1);
                JObject identify = new JObject();
                identify["op"] = 1;
                JObject identifyData = new JObject();
                identifyData["rpcVersion"] = rpcVersion;
                JObject authentication = helloData["authentication"] as JObject;
                if (authentication != null)
                {
                    identifyData["authentication"] = CreateAuthentication(
                        password,
                        ReadString(authentication, "challenge"),
                        ReadString(authentication, "salt"));
                }

                identifyData["eventSubscriptions"] = InputVolumeMetersSubscription;
                identify["d"] = identifyData;
                Send(socket, identify.ToString(Newtonsoft.Json.Formatting.None));

                JObject identified = ReadMessage(socket, IdentifyTimeoutMilliseconds);
                if (identified == null || ReadInt(identified, "op", -1) != 2)
                {
                    throw new InvalidOperationException("OBS отклонил подключение: неверный пароль obs-websocket.");
                }

                result.Success = true;
                CollectPeak(socket, sampleMilliseconds, result);
                return result;
            }
            catch (Exception exception)
            {
                return Failure(exception);
            }
            finally
            {
                try
                {
                    socket.Dispose();
                }
                catch
                {
                    // Сокет уже закрыт или аварийно оборван — для замера это не важно.
                }
            }
        }

        private static void CollectPeak(ClientWebSocket socket, int sampleMilliseconds, AudioMeterResult result)
        {
            Stopwatch watch = Stopwatch.StartNew();
            using (CancellationTokenSource sampling = new CancellationTokenSource(sampleMilliseconds + 500))
            {
                while (watch.ElapsedMilliseconds < sampleMilliseconds)
                {
                    string text;
                    if (!TryReceiveText(socket, sampling.Token, out text))
                    {
                        return;
                    }

                    JObject message = TryParse(text);
                    if (message == null || ReadInt(message, "op", -1) != 5)
                    {
                        continue;
                    }

                    JObject data = message["d"] as JObject;
                    if (data == null || ReadString(data, "eventType") != "InputVolumeMeters")
                    {
                        continue;
                    }

                    JObject eventData = data["eventData"] as JObject;
                    JArray inputs = eventData == null ? null : eventData["inputs"] as JArray;
                    if (inputs == null)
                    {
                        continue;
                    }

                    for (int index = 0; index < inputs.Count; index++)
                    {
                        JObject input = inputs[index] as JObject;
                        if (input == null)
                        {
                            continue;
                        }

                        double peakDb;
                        if (TryReadPeakDb(input, out peakDb) && peakDb > result.PeakDb)
                        {
                            result.PeakDb = peakDb;
                        }
                    }
                }
            }
        }

        private static JObject LoadConnection()
        {
            string path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "data", "obs.json");
            if (!File.Exists(path))
            {
                throw new FileNotFoundException("Не найден data/obs.json Streamer.bot.", path);
            }

            JObject document = JObject.Parse(File.ReadAllText(path));
            JArray connections = document["connections"] as JArray;
            if (connections == null || connections.Count == 0)
            {
                throw new InvalidOperationException("В Streamer.bot нет подключения к OBS.");
            }

            JObject first = null;
            for (int index = 0; index < connections.Count; index++)
            {
                JObject connection = connections[index] as JObject;
                if (connection == null)
                {
                    continue;
                }

                if (first == null)
                {
                    first = connection;
                }

                JToken isDefault = connection["default"];
                if (isDefault != null && isDefault.Type == JTokenType.Boolean && (bool)isDefault)
                {
                    return connection;
                }
            }

            return first;
        }

        private static void Connect(ClientWebSocket socket, string host, int port)
        {
            string address = string.IsNullOrWhiteSpace(host) ? "127.0.0.1" : host.Trim();
            string url = "ws://" + address + ":" + port.ToString(CultureInfo.InvariantCulture) + "/";
            using (CancellationTokenSource timeout = new CancellationTokenSource(ConnectTimeoutMilliseconds))
            {
                socket.ConnectAsync(new Uri(url), timeout.Token).ConfigureAwait(false).GetAwaiter().GetResult();
            }
        }

        private static void Send(ClientWebSocket socket, string text)
        {
            byte[] payload = Encoding.UTF8.GetBytes(text);
            using (CancellationTokenSource timeout = new CancellationTokenSource(IdentifyTimeoutMilliseconds))
            {
                socket.SendAsync(new ArraySegment<byte>(payload), WebSocketMessageType.Text, true, timeout.Token)
                    .ConfigureAwait(false)
                    .GetAwaiter()
                    .GetResult();
            }
        }

        private static JObject ReadMessage(ClientWebSocket socket, int timeoutMilliseconds)
        {
            using (CancellationTokenSource timeout = new CancellationTokenSource(timeoutMilliseconds))
            {
                string text;
                return TryReceiveText(socket, timeout.Token, out text) ? TryParse(text) : null;
            }
        }

        private static bool TryReceiveText(ClientWebSocket socket, CancellationToken token, out string text)
        {
            text = null;
            byte[] buffer = new byte[ReceiveBufferBytes];
            MemoryStream payload = new MemoryStream();
            try
            {
                while (true)
                {
                    WebSocketReceiveResult chunk = socket
                        .ReceiveAsync(new ArraySegment<byte>(buffer), token)
                        .ConfigureAwait(false)
                        .GetAwaiter()
                        .GetResult();
                    if (chunk.MessageType == WebSocketMessageType.Close)
                    {
                        return false;
                    }

                    if (chunk.MessageType != WebSocketMessageType.Text)
                    {
                        continue;
                    }

                    payload.Write(buffer, 0, chunk.Count);
                    if (chunk.EndOfMessage)
                    {
                        break;
                    }
                }
            }
            catch (OperationCanceledException)
            {
                // Окно замера закончилось — это штатное завершение, а не ошибка.
                return false;
            }

            text = Encoding.UTF8.GetString(payload.ToArray());
            return true;
        }

        private static JObject TryParse(string text)
        {
            if (string.IsNullOrWhiteSpace(text))
            {
                return null;
            }

            try
            {
                return JObject.Parse(text);
            }
            catch (Newtonsoft.Json.JsonException)
            {
                return null;
            }
        }

        private static bool TryReadPeakDb(JObject input, out double peakDb)
        {
            peakDb = -100.0;
            // obs-websocket 5 присылает множители по каналам (inputLevelsMul),
            // а не готовые децибелы; inputVolumeDb оставлен для старых сборок.
            JArray rows = input["inputLevelsMul"] as JArray;
            if (rows != null)
            {
                double peakMultiplier = 0.0;
                for (int rowIndex = 0; rowIndex < rows.Count; rowIndex++)
                {
                    JArray row = rows[rowIndex] as JArray;
                    if (row == null)
                    {
                        continue;
                    }

                    for (int index = 0; index < row.Count; index++)
                    {
                        double multiplier;
                        if (!double.TryParse(row[index].ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out multiplier))
                        {
                            continue;
                        }

                        if (multiplier > peakMultiplier)
                        {
                            peakMultiplier = multiplier;
                        }
                    }
                }

                peakDb = peakMultiplier > 0.0 ? 20.0 * Math.Log10(peakMultiplier) : -100.0;
                return true;
            }

            JToken level = input["inputVolumeDb"];
            if (level == null)
            {
                return false;
            }

            return double.TryParse(level.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out peakDb);
        }

        private static string CreateAuthentication(string password, string challenge, string salt)
        {
            using (SHA256 sha256 = SHA256.Create())
            {
                string secret = Convert.ToBase64String(sha256.ComputeHash(Encoding.UTF8.GetBytes((password ?? string.Empty) + salt)));
                return Convert.ToBase64String(sha256.ComputeHash(Encoding.UTF8.GetBytes(secret + challenge)));
            }
        }

        private static string ReadString(JObject source, string propertyName)
        {
            JToken value = source == null ? null : source[propertyName];
            return value == null || value.Type == JTokenType.Null ? string.Empty : value.ToString();
        }

        private static int ReadInt(JObject source, string propertyName, int fallback)
        {
            JToken value = source == null ? null : source[propertyName];
            if (value == null)
            {
                return fallback;
            }

            int parsed;
            return int.TryParse(value.ToString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed) ? parsed : fallback;
        }

        private static AudioMeterResult Failure(Exception exception)
        {
            AudioMeterResult result = new AudioMeterResult();
            result.Success = false;
            result.Error = exception.GetBaseException().Message;
            return result;
        }
    }
}
