using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
public static class CompanionEndpoint { public static string Get(){return "audit://companion";} }
public class FakeCph {
 public Dictionary<string,object> Values=new Dictionary<string,object>();
 public bool Connected,Streaming;public int Alerts,RawRequests,Sounds;public string EventType="TimedAction";
 public string GetEventType(){return EventType;}
 public T GetGlobalVar<T>(string key,bool persist){object v;return Values.TryGetValue(key,out v)?(T)v:default(T);}
 public void SetGlobalVar<T>(string key,T value,bool persist){Values[key]=value;}
 public void UnsetGlobalVar(string key,bool persist){Values.Remove(key);}
 public bool ObsIsConnected(int i){return Connected;}
 public bool ObsIsStreaming(int i){return Streaming;}
 public string ObsSendRaw(string name,string data,int i){RawRequests++;return "{\"outputActive\":true,\"inputMuted\":false,\"outputReconnecting\":false,\"outputCongestion\":0,\"outputSkippedFrames\":0,\"outputTotalFrames\":1000,\"renderSkippedFrames\":0,\"renderTotalFrames\":1000,\"videoActive\":false}";}
 public void SetArgument(string n,object v){}
 public bool RunAction(string n,bool inline){Alerts++;return true;}
 public void PlaySound(string p,float v,bool wait,string device,bool stop){Sounds++;}
 public void ShowToastNotification(string t,string m){}
 public void LogWarn(string s){Console.WriteLine(s);}
 public void LogError(string s){throw new Exception(s);}
}
class AuditResponse:WebResponse{public override WebHeaderCollection Headers{get{return new WebHeaderCollection();}}public override Uri ResponseUri{get{return new Uri("audit://companion");}}public override string ContentType{get{return "text/plain";}set{}}public override Stream GetResponseStream(){return new MemoryStream();}public override long ContentLength{get{return 0;}set{}}}
class AuditRequest:WebRequest{
 public static Dictionary<string,string> Values=new Dictionary<string,string>();public static int Calls;
 readonly string key;readonly MemoryStream body=new MemoryStream();WebHeaderCollection headers=new WebHeaderCollection();
 public AuditRequest(Uri u){key=u.AbsolutePath;}
 public override ICredentials Credentials{get;set;}public override IWebProxy Proxy{get;set;}public override Uri RequestUri{get{return new Uri("audit://companion"+key);}}public override string Method{get;set;}public override string ContentType{get;set;}public override long ContentLength{get;set;}public override int Timeout{get;set;}
 public override WebHeaderCollection Headers{get{return headers;}set{headers=value;}}
 public override Stream GetRequestStream(){return body;}
 public override WebResponse GetResponse(){Calls++;Values[key]=Encoding.UTF8.GetString(body.ToArray());return new AuditResponse();}
}
class AuditCreator:IWebRequestCreate{public WebRequest Create(Uri u){return new AuditRequest(u);}}
public class TestHealth {
 static void Assert(bool value,string name){if(!value)throw new Exception(name);}
 static ObsHealthAudio.AudioMeterResult Meter(double peakDb){return new ObsHealthAudio.AudioMeterResult{Success=true,PeakDb=peakDb};}
 static ObsHealthAudio.AudioMeterResult ProbeFailure(){return new ObsHealthAudio.AudioMeterResult{Success=false,Error="test"};}
 public static void Main(){
  // Подставной звук и замер задаются до первого обращения к CPHInline:
  // статическое поле разрешает путь к mp3 один раз.
  string alert=Path.Combine(Path.GetTempPath(),"obs-health-test.mp3");
  File.WriteAllText(alert,"");
  CPHInline.AlertSoundOverride=alert;
  CPHInline.AudioMeterOverride=delegate(int ms){return Meter(-80);};
  WebRequest.RegisterPrefix("audit",new AuditCreator());
  var c=new FakeCph();var code=new CPHInline();code.CPH=c;
  code.Execute();Assert(AuditRequest.Values["/api/custom-variable/obs_health_state/value"]=="OFFLINE","offline distinct");Assert(c.Alerts==0&&c.RawRequests==0,"no idle alarm or OBS request");
  c.Connected=true;code.Execute();Assert(AuditRequest.Values["/api/custom-variable/obs_health_state/value"]=="IDLE","idle distinct");
  c.Streaming=true;code.Execute();Assert(c.GetGlobalVar<bool>("obs.health.lastStreaming",false),"remember stream");
  int sent=AuditRequest.Calls;code.Execute();Assert(AuditRequest.Calls==sent,"unchanged values suppressed");
  c.Values["obs.health.companion.obs_health_state.sentAt"]=0L;code.Execute();Assert(AuditRequest.Calls>sent,"expired cache reconciled");
  c.Connected=false;code.Execute();Assert(c.Alerts==0,"first disconnect debounced");code.Execute();Assert(c.Alerts==1,"sustained disconnect alarm");code.Execute();Assert(c.Alerts==1,"no repeated notification");
  c.Connected=true;c.Streaming=false;code.Execute();Assert(AuditRequest.Values["/api/custom-variable/obs_health_state/value"]=="IDLE","known stopped after recovery");
  // Stop and close OBS before the next ten-second timer tick.
  c.Streaming=true;code.Execute();int alerts=c.Alerts;int requests=c.RawRequests;
  c.Connected=false;c.EventType="ObsStreamingStopped";code.Execute();
  Assert(!c.GetGlobalVar<bool>("obs.health.lastStreaming",false),"stop event clears remembered stream even after OBS closes");
  Assert(AuditRequest.Values["/api/custom-variable/obs_health_state/value"]=="IDLE","stop event publishes idle");
  Assert(c.RawRequests==requests,"stop event does not query closed OBS");
  c.EventType="TimedAction";for(int i=0;i<8;i++)code.Execute();
  Assert(c.Alerts==alerts,"no connection alarm after normal stop and close");
  Assert(c.GetGlobalVar<string>("obs.health.signature",false)==string.Empty,"no stale warning after stop");
  Assert(c.GetGlobalVar<long>("obs.health.lastSoundAt",false)==0,"sound cooldown reset after stop");
  c.Connected=true;c.Streaming=true;code.Execute();c.Connected=false;
  code.Execute();Assert(c.Alerts==alerts,"next stream disconnect remains debounced");
  code.Execute();Assert(c.Alerts==alerts+1,"real connection failure still alerts on next stream");

  // Тишина в эфире: тревога через 3,5 минуты, напоминание, восстановление.
  var a=new FakeCph();a.Connected=true;a.Streaming=true;var audio=new CPHInline();audio.CPH=a;
  CPHInline.AudioMeterOverride=delegate(int ms){return Meter(-80);};
  audio.Execute();
  long clock=a.GetGlobalVar<long>("obs.health.audio.lastAudibleAt",false);
  Assert(clock>0,"audio clock starts with the first check");
  Assert(a.Alerts==0,"no alarm while the stream just started");
  a.Values["obs.health.audio.lastAudibleAt"]=clock-211;
  audio.Execute();
  Assert(a.GetGlobalVar<bool>("obs.health.audio.problemActive",false),"silence alarm becomes active");
  Assert(a.Alerts==1,"silence alarm sends Telegram");
  Assert(a.Sounds==1,"silence alarm plays the warning sound");
  audio.Execute();
  Assert(a.Alerts==1&&a.Sounds==1,"silence alert is throttled to 3.5 minutes");
  a.Values["obs.health.audio.lastAudibleAt"]=clock-421;
  a.Values["obs.health.lastTelegramAt"]=clock-211;
  a.Values["obs.health.lastSoundAt"]=clock-211;
  audio.Execute();
  Assert(a.Alerts==2,"silence Telegram repeats after 3.5 minutes");
  Assert(a.Sounds==2,"silence sound repeats after 3.5 minutes");
  // Три слышимых замера подряд снимают тревогу, один щелчок — нет.
  CPHInline.AudioMeterOverride=delegate(int ms){return Meter(-12);};
  for(int i=0;i<3;i++){a.Values["obs.health.audio.ignoreUntil"]=0L;audio.Execute();if(i<2)Assert(a.GetGlobalVar<bool>("obs.health.audio.problemActive",false),"recovery needs three audible checks");}
  Assert(!a.GetGlobalVar<bool>("obs.health.audio.problemActive",false),"recovery clears after three audible checks");

  // Недоступный замер: два сбоя молчим, третий сообщаем как проблему мониторинга.
  CPHInline.AudioMeterOverride=delegate(int ms){return ProbeFailure();};
  audio.Execute();audio.Execute();
  Assert(a.GetGlobalVar<string>("obs.health.signature",false)==string.Empty,"probe failures are debounced");
  audio.Execute();
  Assert(a.GetGlobalVar<string>("obs.health.signature",false)=="AUDIOPROBE","probe failure reported on the third check");
  Console.WriteLine("PASS: OBS offline/idle/stream, debounce, alarms, cache refresh, recovery; audio silence alarm, 3.5-minute reminder, audible recovery, probe failure; all OBS/HTTP/notifications mocked.");
 }
}
