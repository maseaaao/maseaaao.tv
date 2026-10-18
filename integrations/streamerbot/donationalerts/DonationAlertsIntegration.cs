using System;
using System.Net;
using System.Text;
using System.Web;
using System.Threading.Tasks;
using System.IO;
using Newtonsoft.Json;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Threading;
using System.Security.Cryptography;
using System.Timers;

///----------------------------------------------------------------------------
///   Module:     DonationAlertsIntegration
///   Author:     play_code (https://twitch.tv/play_code)
///   Email:      info@play-code.live
///   Repository: https://github.com/play-code-live/streamer.bot-donationAlerts
///----------------------------------------------------------------------------
public class CPHInline
{
    public class PrefixedLogger
    {
        private IInlineInvokeProxy _CPH { get; set; }
        private const string Prefix = "-- Donation Alerts:";

        public PrefixedLogger(IInlineInvokeProxy _CPH)
        {
            this._CPH = _CPH;
        }
        public void WebError(WebException e)
        {
            var response = e.Response as HttpWebResponse;
            if (response == null) { Error("Network error without HTTP response"); return; }
            var statusCodeResponse = response.StatusCode;
            int statusCodeResponseAsInt = ((int)response.StatusCode);
            Error("WebException with status code " + statusCodeResponseAsInt.ToString(), statusCodeResponse);
        }
        public void Error(string message)
        {
            message = string.Format("{0} {1}", Prefix, message);
            _CPH.LogWarn(message);
        }
        public void Error(string message, params Object[] additional)
        {
            string finalMessage = message;
            foreach (var line in additional)
            {
                finalMessage += ", " + line;
            }
            this.Error(finalMessage);
        }
        public void Debug(string message)
        {
            message = string.Format("{0} {1}", Prefix, message);
            _CPH.LogDebug(message);
        }
        public void Debug(string message, params Object[] additional)
        {
            string finalMessage = message;
            foreach (var line in additional)
            {
                finalMessage += ", " + line;
            }
            this.Debug(finalMessage);
        }
    }
    private Service Service { get; set; }
    private SocketService SocketService { get; set; }
    private PrefixedLogger Logger { get; set; }

    private const string DefaultHandlerActionName = "DonationHandler_Default";
    private const string DefaultGoalHandlerActionName = "DonationHandler_GoalHandler";
    private const string DefaultAfterDonationHandlerActionName = "DonationHandler_After";
    private const string TextPleaseConnect = "Please connect to DonationAlerts using the Webpage that opened to obtain your token. " +
            "Для продолжения подтвердите авторизацию в появившемся окне браузера";

    public void Init()
    {

        Logger = new PrefixedLogger(CPH);
        Service = new Service(new Client(), Logger, CPH.GetGlobalVar<string>("daClientId"), CPH.GetGlobalVar<string>("daClientSecret"));

        SocketService = new SocketService(Service, Logger);
    }
    public void Dispose()
    {
        if (SocketService != null) SocketService.Close();
    }
    public bool CreateAuthLink()
    {
        string authLink = Service.GetAuthLink();
        CPH.LogInfo("DonationAlerts: authorize using the browser window.");

        Logger.Debug("Opened URL in the default browser. Awaiting for confirmation");

        return Service.ServeAndListenAuth(delegate (string code)
        {
            CPH.SetGlobalVar("daCode", code, true);

            return code;
        });
    }
    public bool ObtainAccessToken()
    {
        string code = CPH.GetGlobalVar<string>("daCode");
        if (code == "")
        {
            Logger.Debug("Code argument has not arrivied. Make sure you initialized connection for the DA");
            return false;
        }

        var tokenData = Service.ObtainToken(code);
        if (tokenData == null)
            return false;

        CPH.SetGlobalVar("daAccessToken", tokenData.AccessToken, true);
        CPH.SetGlobalVar("daRefreshToken", tokenData.RefreshToken, true);

        Logger.Debug("AccessToken and RefreshToken are obtained successfully");

        return true;
    }
    public bool RefreshAccessToken()
    {
        if (args.ContainsKey("refresh_token_recursion_protection"))
            return false;
        Logger.Debug("Refreshing access token");

        string refreshToken = CPH.GetGlobalVar<string>("daRefreshToken");
        if (refreshToken == "")
        {
            Logger.Debug("RefreshToken argument has not arrived. Make sure you initialized connection for the DA");
            return false;
        }

        var tokenData = Service.RefreshToken(refreshToken);
        if (tokenData == null)
            return false;

        CPH.SetGlobalVar("daAccessToken", tokenData.AccessToken, true);
        CPH.SetGlobalVar("daRefreshToken", tokenData.RefreshToken, true);
        CPH.SetArgument("refresh_token_recursion_protection", true);

        return true;
    }
    public bool GetProfileInfo()
    {
        Logger.Debug("Obtaining socket token");
        string accessToken = CPH.GetGlobalVar<string>("daAccessToken");
        if (accessToken == "")
            return false;

        var profileInfo = Service.GetProfileInfo(accessToken);
        if (profileInfo == null)
            return this.RefreshAccessToken() && this.GetProfileInfo();

        CPH.SetGlobalVar("daSocketToken", profileInfo.SocketConnectionToken, true);
        CPH.SetGlobalVar("daUserId", profileInfo.Id, true);

        return true;
    }
    private bool donationHandlersRegistered;
    public bool DonationCheckerLoop()
    {
        string accessToken = CPH.GetGlobalVar<string>("daAccessToken");
        if (string.IsNullOrEmpty(accessToken))
        {
            CPH.LogInfo("DonationAlerts: authorization required; run -- DonationAlerts Authorization.");
            return false;
        }

        if (!donationHandlersRegistered) {
        SocketService
            .On(SocketService.EventStarted, delegate (string Event, Dictionary<string, string> Data)
            {
                Logger.Debug("Ready to connect to the socket");
            })
            .On(SocketService.EventConnected, delegate (string Event, Dictionary<string, string> Data)
            {
                Logger.Debug("Connected to the socket");
                CPH.LogInfo("DonationAlerts connected.");
            })
            .On(SocketService.EventAuthorized, delegate (string Event, Dictionary<string, string> Data)
            {
                Logger.Debug("Authorized successfully");
            })
            .On(SocketService.EventReconnected, delegate (string Event, Dictionary<string, string> Data)
            {
                Logger.Debug("Reconnected to the socket");
            })
            .On(SocketService.EventDisconnected, delegate (string Event, Dictionary<string, string> Data)
            {
                Logger.Debug("Disconnected from the socket", Data["description"]);
            })
            .On(SocketService.EventAuthError, delegate (string Event, Dictionary<string, string> Data)
            {
                CPH.LogWarn("DonationAlerts: authorization expired; run -- DonationAlerts Authorization again.");
            })
            .On(SocketService.EventGoalUpdated, delegate (string Event, Dictionary<string, string> Data)
            {
                ExportGoal(Data);
                if (CPH.ActionExists(DefaultGoalHandlerActionName))
                    CPH.RunAction(DefaultGoalHandlerActionName);
            })
            .On(SocketService.EventRecievedDonation, delegate (string Event, Dictionary<string, string> Data)
            {
                ExportDonation(Data);
                string targetActionName = string.Format("DonationHandler_{0}", Data["amount"]);
                if (CPH.ActionExists(targetActionName))
                    CPH.RunAction(targetActionName, false);
                else if (CPH.ActionExists(DefaultHandlerActionName))
                    CPH.RunAction(DefaultHandlerActionName);

                if (CPH.ActionExists(DefaultAfterDonationHandlerActionName))
                    CPH.RunAction(DefaultAfterDonationHandlerActionName);
            });


        donationHandlersRegistered = true;
        }
        SocketService.Start(accessToken);
        return true;
    }
    private void ExportDonation(Dictionary<string, string> Donation)
    {
        CPH.SetArgument("daMessage", "" );
        string username = "Anonymous";
        if (!string.IsNullOrEmpty(Donation["username"]))
            username = Donation["username"];
        string type = Donation["type"];

        CPH.SetArgument("daName", Donation["name"]);
        CPH.SetArgument("daUsername", username);
        CPH.SetArgument("daType", type);
        if (type == SocketService.DonationData.TypeText)
            CPH.SetArgument("daMessage", Donation["content"]);
        else if (type == SocketService.DonationData.TypeAudio) {
            CPH.SetArgument("daAudioUrl", Donation["content"]);
            CPH.SetArgument("daAudio", SaveFileToTemp(Donation["content"], Donation["id"] + ".wav"));
        }

        CPH.SetArgument("daAmount", Donation["amount"]);
        CPH.SetArgument("daCurrency", Donation["currency"]);
        CPH.SetArgument("daAmountConverted", Donation["amount_in_user_currency"]);
    }

    private void ExportGoal(Dictionary<string, string> GoalData)
    {
        CPH.SetArgument("daGoalIsActive", GoalData["is_active"]);
        CPH.SetArgument("daGoalIsDefault", GoalData["is_default"]);
        CPH.SetArgument("daGoalTitle", GoalData["title"]);
        CPH.SetArgument("daGoalCurrency", GoalData["currency"]);
        CPH.SetArgument("daGoalCurrent", GoalData["current"]);
        CPH.SetArgument("daGoalTarget", GoalData["target"]);
    }

    private string SaveFileToTemp(string fileUrl, string name)
    {
        string targetPath = Path.Combine(Path.GetTempPath(), name);
        using (var client = new WebClient())
        {
            client.DownloadFile(fileUrl, targetPath);
        }

        return targetPath;
    }
}

public class SocketService
{
    private const string SocketHost = "wss://centrifugo.donationalerts.com/connection/websocket";

    public const string EventStarted      = "started";
    public const string EventConnected    = "connected";
    public const string EventDisconnected = "disconnected";
    public const string EventReconnected  = "reconnected";
    public const string EventAuthorized   = "authorized";
    public const string EventSubscribed   = "subscribed";
    public const string EventAuthError    = "auth_error";

    public const string EventRecievedMessage  = "recieved_message";
    public const string EventRecievedDonation = "recieved_donation";
    public const string EventGoalUpdated      = "goal_updated";
    private EventObserver Observer { get; set; }
    private Service DaService { get; set; }
    private ClientWebSocket Socket { get; set; }
    private CPHInline.PrefixedLogger Logger { get; set; }

    private const int BufferSize = 3072;

    private string PreviousGoalEventHash = "";

    public SocketService(Service service, CPHInline.PrefixedLogger Logger)
    {
        Observer = new EventObserver();
        DaService = service;
        this.Logger = Logger;
    }
    public SocketService On(string EventName, EventObserver.Handler handler)
    {
        Observer.Subscribe(EventName, handler);
        return this;
    }
    private readonly object lifecycle = new object();
    private CancellationTokenSource cancellation;
    private bool running;
    private readonly HashSet<int> receivedIds = new HashSet<int>();
    private readonly Queue<int> receivedOrder = new Queue<int>();

    public Task Start(string accessToken)
    {
        CancellationTokenSource source;
        lock (lifecycle) {
            if (running) return Task.FromResult(0);
            running = true; source = cancellation = new CancellationTokenSource();
        }
        try { ConnectAndProcess(accessToken, source.Token); }
        finally {
            lock (lifecycle) { running = false; cancellation = null; }
            source.Dispose();
        }
        return Task.FromResult(0);
    }
    public void Close()
    {
        lock (lifecycle) {
            if (cancellation != null) cancellation.Cancel();
            if (Socket != null) Socket.Abort();
        }
    }
    private void ConnectAndProcess(string accessToken, CancellationToken token)
    {
        bool connectedBefore = false;
        int failures = 0;
        while (!token.IsCancellationRequested) {
            try {
                var profile = DaService.GetProfileInfo(accessToken);
                if (profile == null) { Observer.Dispatch(EventAuthError); return; }
                using (var socket = new ClientWebSocket()) {
                    lock (lifecycle) { Socket = socket; }
                    try {
                        Observer.Dispatch(EventStarted);
                        using (var handshake = CancellationTokenSource.CreateLinkedTokenSource(token)) {
                            handshake.CancelAfter(15000);
                            socket.ConnectAsync(new Uri(SocketHost), handshake.Token).GetAwaiter().GetResult();
                            string clientId = ObtainSocketClientId(profile.SocketConnectionToken, handshake.Token);
                            var channels = DaService.ObtainChannelSubscribeToken(accessToken, profile.Id, clientId);
                            foreach (var channel in channels) SubscribeToTheChannel(channel.Channel, channel.Token, handshake.Token);
                        }
                        Observer.Dispatch(connectedBefore ? EventReconnected : EventConnected);
                        connectedBefore = true;
                        var stable = System.Diagnostics.Stopwatch.StartNew();
                        while (!token.IsCancellationRequested && socket.State == WebSocketState.Open) {
                            string message = WebSocketMessages.Receive(socket, token);
                            if (message == null) break;
                            ProcessMessage(message);
                            if (stable.Elapsed.TotalSeconds >= 30) failures = 0;
                        }
                    } finally { lock (lifecycle) { if (Socket == socket) Socket = null; } }
                }
            } catch (OperationCanceledException) {
                if (token.IsCancellationRequested) return;
                Logger.Debug("DonationAlerts handshake or fragmented-message timeout");
            } catch (WebException ex) {
                var response = ex.Response as HttpWebResponse;
                bool unauthorized = response != null && (response.StatusCode == HttpStatusCode.Unauthorized || response.StatusCode == HttpStatusCode.Forbidden);
                if (response != null) response.Dispose();
                if (unauthorized) { Observer.Dispatch(EventAuthError); return; }
                Logger.Debug("DonationAlerts network unavailable");
            } catch (Exception) {
                Logger.Debug("DonationAlerts connection interrupted");
            }
            if (token.IsCancellationRequested) return;
            Observer.Dispatch(EventDisconnected, new Dictionary<string,string>{{"description","Connection unavailable; retry scheduled"}});
            int delay = Math.Min(30000, 1000 * (1 << Math.Min(failures++, 5)));
            if (token.WaitHandle.WaitOne(delay)) return;
        }
    }
    private void ProcessMessage(string rawMessage)
    {
        try {
            var envelope = JsonConvert.DeserializeObject<Dictionary<string, SocketMessage>>(rawMessage);
            SocketMessage message;
            if (envelope == null || !envelope.TryGetValue("result", out message) || message == null || string.IsNullOrEmpty(message.Channel)) return;
            switch (message.RecognizeType()) {
                case SocketMessage.TypeDonation:
                    var donationEvent = JsonConvert.DeserializeObject<Dictionary<string, DonationResponse>>(rawMessage)["result"];
                    if (!donationEvent.IsValid()) return;
                    var donation = donationEvent.Data.Donation;
                    if (donation.Id > 0) {
                        if (!receivedIds.Add(donation.Id)) return;
                        receivedOrder.Enqueue(donation.Id);
                        while (receivedOrder.Count > 1024) receivedIds.Remove(receivedOrder.Dequeue());
                    }
                    Observer.Dispatch(EventRecievedDonation, donation.ToDictionary());
                    break;
                case SocketMessage.TypeGoal:
                    var goalEvent = JsonConvert.DeserializeObject<Dictionary<string, GoalProgressResponse>>(rawMessage)["result"];
                    if (!goalEvent.IsValid()) return;
                    var goal = goalEvent.Data.GoalData;
                    var hash = Helper.GetMD5Hash(goal);
                    if (hash == PreviousGoalEventHash) return;
                    PreviousGoalEventHash = hash;
                    Observer.Dispatch(EventGoalUpdated, goal.ToDictionary());
                    break;
            }
        } catch (Exception) { Logger.Debug("DonationAlerts event could not be processed; payload omitted"); }
    }
    private void Send(object value, CancellationToken token)
    {
        Socket.SendAsync(new ArraySegment<byte>(Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(value))), WebSocketMessageType.Text, true, token).GetAwaiter().GetResult();
    }
    private string ObtainSocketClientId(string socketToken, CancellationToken token)
    {
        Send(new SocketClientRequest { Parameters = new SocketClientRequestParams { Token = socketToken } }, token);
        string message = WebSocketMessages.Receive(Socket, token);
        if (message == null) throw new IOException("Socket closed during authentication");
        var response = JsonConvert.DeserializeObject<SocketClientResponse>(message);
        if (response == null || response.Data == null || string.IsNullOrEmpty(response.Data.Client)) throw new InvalidDataException("Authentication response invalid");
        Observer.Dispatch(EventAuthorized, new Dictionary<string,string>{{"client",response.Data.Client},{"version",response.Data.Version}});
        return response.Data.Client;
    }
    private void SubscribeToTheChannel(string channel, string channelToken, CancellationToken token)
    {
        Send(new SubscribeRequest { Data = new SubscribeRequestData { Channel = channel, Token = channelToken } }, token);
        for (int i = 0; i < 16; i++) {
            string message = WebSocketMessages.Receive(Socket, token);
            if (message == null) throw new IOException("Socket closed during subscription");
            ProcessMessage(message);
            var response = JsonConvert.DeserializeObject<SubscribeResponse>(message);
            if (response != null && response.Data != null && response.Data.Channel == channel) {
                Observer.Dispatch(EventSubscribed, new Dictionary<string,string>{{"channel",channel}});
                return;
            }
        }
        throw new InvalidDataException("Subscription response missing");
    }

    private class SocketClientRequest
    {
        [JsonProperty("id")]
        public int Id = 1;
        [JsonProperty("params")]
        public SocketClientRequestParams Parameters { get; set; }
    }
    private class SocketClientRequestParams
    {
        [JsonProperty("token")]
        public string Token { get; set; }
    }
    private class SocketClientResponse
    {
        [JsonProperty("id")]
        public int Id { get; set; }
        [JsonProperty("result")]
        public SocketClientResponseData Data { get; set; }
    }
    private class SocketClientResponseData
    {
        [JsonProperty("client")]
        public string Client;
        [JsonProperty("version")]
        public string Version;
    }
    private class SubscribeRequest
    {
        [JsonProperty("id")]
        public int Id = 2;
        [JsonProperty("method")]
        public int Method = 1;
        [JsonProperty("params")]
        public SubscribeRequestData Data { get; set; }
    }
    private class SubscribeRequestData
    {
        [JsonProperty("channel")]
        public string Channel { get; set; }
        [JsonProperty("token")]
        public string Token { get; set; }
    }
    private class SubscribeResponse
    {
        [JsonProperty("id")]
        public int Id { get; set; }
        [JsonProperty("result")]
        public SubscribeResponseData Data { get; set; }
    }
    private class SubscribeResponseData
    {
        [JsonProperty("recoverable")]
        public bool IsRecoverable = false;
        [JsonProperty("seq")]
        public int seq = 0;
        [JsonProperty("type")]
        public int Type { get; set; }
        [JsonProperty("channel")]
        public string Channel { get; set; }
    }
    private class SocketMessage
    {
        public const string TypeDonation = "donation";
        public const string TypeGoal = "goal";
        public const string TypeUnknown = "unknown";

        [JsonProperty("channel")]
        public string Channel { get; set; }
        public string RecognizeType()
        {
            if (Channel.Contains("$alerts:donation"))
            {
                return TypeDonation;
            }
            else if (Channel.Contains("$goals:goal"))
            {
                return TypeGoal;
            }
            else
            {
                return TypeUnknown;
            }
        }
    }
    private class DonationResponse
    {
        [JsonProperty("channel")]
        public string Channel { get; set; }
        [JsonProperty("data")]
        public DonationResponseData Data = new DonationResponseData();

        public bool IsValid()
        {
            return Data.Donation.Amount > 0;
        }
    }
    private class DonationResponseData
    {
        [JsonProperty("seq")]
        public int Seq { get; set; }
        [JsonProperty("data")]
        public DonationData Donation = new DonationData();
    }
    public class DonationData
    {
        public const string TypeAudio = "audio";
        public const string TypeText = "text";

        [JsonProperty("id")]
        public int Id { get; set; }
        [JsonProperty("name")]
        public string Name { get; set; }
        [JsonProperty("message_type")]
        public string Type { get; set; }
        [JsonProperty("username")]
        public string UserName { get; set; }
        [JsonProperty("message")]
        public string Message { get; set; }
        [JsonProperty("amount")]
        public double Amount { get; set; }
        [JsonProperty("currency")]
        public string Currency { get; set; }
        [JsonProperty("amount_in_user_currency")]
        public double AmountInUserCurrency { get; set; }

        public Dictionary<string, string> ToDictionary() { return new Dictionary<string, string>
            {
                { "id", Id.ToString() },
                { "name", Name },
                { "username", UserName },
                { "type", Type },
                { "content", Message },
                { "amount", Amount.ToString() },
                { "currency", Currency },
                { "amount_in_user_currency", AmountInUserCurrency.ToString() },
            }; }
    }
    private class GoalProgressResponse
    {
        [JsonProperty("channel")]
        public string Channel { get; set; }
        [JsonProperty("data")]
        public GoalProgressData Data = new GoalProgressData();
        public bool IsValid()
        {
            return Data.GoalData.GoalAmount > 0;
        }
    }
    private class GoalProgressData
    {
        [JsonProperty("seq")]
        public int Seq { get; set; }
        [JsonProperty("data")]
        public GoalData GoalData = new GoalData();
    }
    private class GoalData
    {
        [JsonProperty("id")]
        public int Id { get; set; }
        [JsonProperty("is_active")]
        public bool IsActive { get; set; }
        [JsonProperty("is_default")]
        public bool IsDefault { get; set; }
        [JsonProperty("title")]
        public string Title { get; set; }
        [JsonProperty("currency")]
        public string Currency { get; set; }
        [JsonProperty("raised_amount")]
        public double RaisedAmount { get; set; }
        [JsonProperty("goal_amount")]
        public double GoalAmount { get; set; }

        public Dictionary<string, string> ToDictionary()
        {
            return new Dictionary<string, string>
            {
                { "id", Id.ToString() },
                { "is_active", IsActive.ToString() },
                { "is_default", IsDefault.ToString() },
                { "title", Title },
                { "currency", Currency },
                { "current", RaisedAmount.ToString() },
                { "target", GoalAmount.ToString() },
            };
        }
    }

}
public class Service
{
    public delegate string HandleCode(string code);

    private const string RedirectUrl = "http://127.0.0.1:8554/donationAlertsRedirectUri/";
    private const string DefaultScope = "oauth-donation-index oauth-user-show oauth-donation-subscribe oauth-goal-subscribe";

    private const string EndpointAuthorize = "/oauth/authorize";
    private const string EndpointToken = "/oauth/token";
    private const string EndpointProfileInfo = "/api/v1/user/oauth";
    private const string EndpointSubscribe = "/api/v1/centrifuge/subscribe";

    // Вы можете изменить эти значения, если необходимо
    // см. https://www.donationalerts.com/application/clients
    private readonly string ClientId;
    private readonly string ClientSecret;
    private CPHInline.PrefixedLogger Logger { get; set; }
    private Client Client { get; set; }
    private HttpListener Listener = null;

    public Service(Client Client, CPHInline.PrefixedLogger Logger, string clientId, string clientSecret)
    {
        if (string.IsNullOrWhiteSpace(clientSecret))
            throw new InvalidOperationException("Set private global daClientSecret before initializing DonationAlerts.");
        this.ClientId = string.IsNullOrWhiteSpace(clientId) ? "10462" : clientId;
        this.ClientSecret = clientSecret;
        this.Client = Client;
        this.Logger = Logger;
    }
    public bool ServeAndListenAuth(HandleCode Handler)
    {
        try
        {
            Listener = new HttpListener();
            Listener.Prefixes.Add(RedirectUrl);
            Listener.Start();
            System.Diagnostics.Process.Start(GetAuthLink());
            Func<Task> func = new Func<Task>(async () => {
                bool runServer = true;
                while (runServer)
                {
                    Logger.Debug("Server is waiting ...");
                    HttpListenerContext context = await Listener.GetContextAsync();
                    HttpListenerRequest request = context.Request;
                    HttpListenerResponse resp = context.Response;
                    var queryDictionary = HttpUtility.ParseQueryString(request.Url.Query);
                    string code = queryDictionary["code"];
                    Handler(code);

                    string pageData = "<!doctype html><html><meta charset=\"utf-8\"><title>DonationAlerts</title><body><h2>DonationAlerts подключён</h2><p>Можно закрыть вкладку и вернуться в Streamer.bot.</p></body></html>";
                    byte[] data = Encoding.UTF8.GetBytes(pageData);
                    resp.ContentType = "text/html";
                    resp.ContentEncoding = Encoding.UTF8;
                    resp.ContentLength64 = data.LongLength;
                    await context.Response.OutputStream.WriteAsync(data, 0, data.Length);
                    resp.Close();
                    runServer = false;
                    Listener.Close();
                }
            });
            Task listenTask = func.Invoke();
            var forceCloseTimer = new System.Timers.Timer(300000);
            forceCloseTimer.Elapsed += ForceCloseServer;
            forceCloseTimer.AutoReset = true;
            forceCloseTimer.Enabled = true;

            listenTask.GetAwaiter().GetResult();
            Listener.Close();
        }
        catch (WebException e)
        {
            Logger.Debug(e.Status.ToString());
            return false;
        }

        return true;
    }
    public string GetAuthLink()
    {
        string url = Client.TargetHost + EndpointAuthorize;
        return string.Format("{0}?client_id={1}&redirect_uri={2}&scope={3}&response_type=code", url, ClientId, GetEncodedRedirectUri(), DefaultScope);
    }
    public ProfileInfoData GetProfileInfo(string accessToken)
    {
        var headers = new Dictionary<string, string>
        {
            { "Authorization", "Bearer " + accessToken }
        };

        try
        {
            string json = Client.GET(EndpointProfileInfo, new Dictionary<string, string>(), headers);
            ProfileInfoResponse profile = JsonConvert.DeserializeObject<ProfileInfoResponse>(json);
            Logger.Debug("Retrieved user profile info");

            return profile.Data;
        }
        catch (WebException e)
        {
            Logger.WebError(e);
            throw;
        }
    }
    public TokenResponse ObtainToken(string Code)
    {
        var values = new Dictionary<string, string>
        {
            { "grant_type", "authorization_code" },
            { "client_id", ClientId },
            { "client_secret", ClientSecret },
            { "code", Code },
            { "redirect_uri", RedirectUrl }
        };

        try
        {
            string json = Client.POST(EndpointToken, values);
            Logger.Debug("Request to the token API has been performed");
            TokenResponse tokenData = JsonConvert.DeserializeObject<TokenResponse>(json);

            return tokenData;
        }
        catch (WebException e)
        {
            Logger.WebError(e);
            return null;
        }
    }
    public TokenResponse RefreshToken(string refreshToken)
    {
        var values = new Dictionary<string, string>
        {
            { "grant_type", "refresh_token" },
            { "client_id", ClientId },
            { "client_secret", ClientSecret },
            { "refresh_token", refreshToken },
            { "scope", DefaultScope }
        };

        try
        {
            string json = Client.POST(EndpointToken, values);
            Logger.Debug("Request to the token API has been performed");
            return JsonConvert.DeserializeObject<TokenResponse>(json);
        }
        catch (WebException e)
        {
            Logger.WebError(e);
            return null;
        }
    }
    public List<ChannelSubscribeResponse> ObtainChannelSubscribeToken(string AccessToken, int UserId, string SocketClientId)
    {
        var request = new ChannelSubscribeRequest
        {
            Client = SocketClientId,
            Channels = new List<string>() {
                { string.Format("$alerts:donation_{0}", UserId) },
                { string.Format("$goals:goal_{0}", UserId) },
            }
        };
        string payload = JsonConvert.SerializeObject(request);

        var headers = new Dictionary<string, string>
        {
            { "Authorization", "Bearer " + AccessToken }
        };

        try
        {
            var response = Client.POST(EndpointSubscribe, payload, headers);
            var channels = JsonConvert.DeserializeObject<Dictionary<string, List<ChannelSubscribeResponse>>>(response);
            if (channels["channels"].Count == 0)
                throw new Exception("Cannot fetch channels and it's tokens");

            return channels["channels"];
        }
        catch (WebException e)
        {
            Logger.WebError(e);
            throw;
        }
    }

    private string GetEncodedRedirectUri()
    {
        return HttpUtility.UrlEncode(RedirectUrl);
    }
    private void ForceCloseServer(Object source, ElapsedEventArgs e)
    {
        Logger.Debug("Timer invoked");
        if (Listener != null && Listener.IsListening)
        {
            Listener.Close();
            Logger.Debug("Server has been closed by timeout");
        }
    }

    public class TokenResponse
    {
        [JsonProperty("access_token")]
        public string AccessToken { get; set; }
        [JsonProperty("refresh_token")]
        public string RefreshToken { get; set; }
        [JsonProperty("expires_in")]
        public int ExpiresIn { get; set; }
    }
    public class ProfileInfoResponse
    {
        [JsonProperty("data")]
        public ProfileInfoData Data;
    }
    public class ProfileInfoData
    {
        [JsonProperty("id")]
        public int Id { get; set; }
        [JsonProperty("code")]
        public string Code { get; set; }
        [JsonProperty("name")]
        public string Name { get; set; }
        [JsonProperty("avatar")]
        public string Avatar { get; set; }
        [JsonProperty("email")]
        public string Email { get; set; }
        [JsonProperty("socket_connection_token")]
        public string SocketConnectionToken;
    }
    public class ChannelSubscribeResponse
    {
        [JsonProperty("channel")]
        public string Channel;
        [JsonProperty("token")]
        public string Token;
    }
    public class ChannelSubscribeRequest
    {
        [JsonProperty("client")]
        public string Client { get; set; }
        [JsonProperty("channels")]
        public List<string> Channels { get; set; }
    }
}
public class Client
{
    public const string TargetHost = "https://www.donationalerts.com";

    public string GET(string endpoint, Dictionary<string, string> parameters, Dictionary<string, string> headers)
    {
        var queryParams = new List<string>();
        foreach (var parameter in parameters)
        {
            queryParams.Add(string.Format("{0}={1}", parameter.Key, parameter.Value));
        }
        endpoint += "?" + String.Join("&", queryParams);
        return this.Perform(WebRequestMethods.Http.Get, TargetHost + endpoint, new Dictionary<string, string>(), headers);
    }
    public string GET(string endpoint, Dictionary<string, string> parameters)
    {
        return this.GET(endpoint, parameters, new Dictionary<string, string>());
    }
    public string GET(string endpoint)
    {
        return this.GET(endpoint, new Dictionary<string, string>());
    }
    public string POST(string endpoint, string payload, Dictionary<string, string> headers)
    {
        return this.Perform(WebRequestMethods.Http.Post, TargetHost + endpoint, payload, headers);
    }
    public string POST(string endpoint, Dictionary<string, string> payload, Dictionary<string, string> headers)
    {
        return this.Perform(WebRequestMethods.Http.Post, TargetHost + endpoint, payload, headers);
    }
    public string POST(string endpoint, Dictionary<string, string> payload)
    {
        return this.POST(endpoint, payload, new Dictionary<string, string>());
    }
    public string POST(string endpoint)
    {
        return this.POST(endpoint, new Dictionary<string, string>());
    }

    private string Perform(string method, string url, string jsonPayload, Dictionary<string, string> headers)
    {
        HttpWebRequest webRequest = (HttpWebRequest)WebRequest.Create(url);
        webRequest.Timeout = 10000;
        webRequest.ReadWriteTimeout = 10000;
        webRequest.Method = method;
        webRequest.ContentType = "application/json";

        foreach (var header in headers)
        {
            webRequest.Headers.Set(header.Key, header.Value);
        }

        if (jsonPayload != string.Empty)
        {
            byte[] requestBytes = Encoding.UTF8.GetBytes(jsonPayload);
            webRequest.ContentLength = requestBytes.Length;
            Stream requestStream = webRequest.GetRequestStream();
            requestStream.Write(requestBytes, 0, requestBytes.Length);
            requestStream.Close();
        }


        using (var response = (HttpWebResponse)webRequest.GetResponse()) {
        string json = "";
        using (Stream respStr = response.GetResponseStream())
        {
            using (StreamReader rdr = new StreamReader(respStr, Encoding.UTF8))
            {
                json = rdr.ReadToEnd();
                rdr.Close();
            }
        }

        return json;
        }
    }
    private string Perform(string method, string url, Dictionary<string, string> payload, Dictionary<string, string> headers)
    {
        string payloadString = "";
        if (payload.Count > 0)
            payloadString = JsonConvert.SerializeObject(payload);

        return this.Perform(method, url, payloadString, headers);
    }
}
public class EventObserver
{
    public delegate void Handler(string Event, Dictionary<string, string> Data = null);
    private Dictionary<string, List<Handler>> Handlers { get; set; }

    public EventObserver()
    {
        Handlers = new Dictionary<string, List<Handler>>();
    }
    public EventObserver Subscribe(string EventName, Handler handler)
    {
        if (!Handlers.ContainsKey(EventName))
            Handlers.Add(EventName, new List<Handler>());

        Handlers[EventName].Add(handler);
        return this;
    }
    public void Dispatch(string EventName, Dictionary<string, string> Data = null)
    {
        if (!Handlers.ContainsKey(EventName) || Handlers[EventName].Count == 0)
            return;

        foreach (var handler in Handlers[EventName])
        {
            handler(EventName, Data);
        }
    }
}

public static class Helper
{
    public static string GetMD5Hash(object obj)
    {
        using (var md5 = MD5.Create())
        {
            var json = JsonConvert.SerializeObject(obj);
            var hashBytes = md5.ComputeHash(Encoding.UTF8.GetBytes(json));
            var sb = new StringBuilder();
            foreach (var b in hashBytes)
            {
                sb.Append(b.ToString("x2"));
            }
            return sb.ToString();
        }
    }
}
