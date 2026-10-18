using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
public static class CompanionEndpoint { public static string Get(){return "audit://companion";} }
public class FakeCph {
 public Dictionary<string,object> Values=new Dictionary<string,object>();
 public bool Connected,Streaming;public int Alerts,RawRequests;
 public T GetGlobalVar<T>(string key,bool persist){object v;return Values.TryGetValue(key,out v)?(T)v:default(T);}
 public void SetGlobalVar<T>(string key,T value,bool persist){Values[key]=value;}
 public void UnsetGlobalVar(string key,bool persist){Values.Remove(key);}
 public bool ObsIsConnected(int i){return Connected;}
 public bool ObsIsStreaming(int i){return Streaming;}
 public string ObsSendRaw(string name,string data,int i){RawRequests++;return "{\"outputActive\":true,\"inputMuted\":false,\"outputReconnecting\":false,\"outputCongestion\":0,\"outputSkippedFrames\":0,\"outputTotalFrames\":1000,\"renderSkippedFrames\":0,\"renderTotalFrames\":1000,\"videoActive\":false}";}
 public void SetArgument(string n,object v){}
 public bool RunAction(string n,bool inline){Alerts++;return true;}
 public void PlaySound(string p,float v,bool wait,string device,bool stop){}
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
 public static void Main(){
  WebRequest.RegisterPrefix("audit",new AuditCreator());
  var c=new FakeCph();var code=new CPHInline();code.CPH=c;
  code.Execute();Assert(AuditRequest.Values["/api/custom-variable/obs_health_state/value"]=="OFFLINE","offline distinct");Assert(c.Alerts==0&&c.RawRequests==0,"no idle alarm or OBS request");
  c.Connected=true;code.Execute();Assert(AuditRequest.Values["/api/custom-variable/obs_health_state/value"]=="IDLE","idle distinct");
  c.Streaming=true;code.Execute();Assert(c.GetGlobalVar<bool>("obs.health.lastStreaming",false),"remember stream");
  int sent=AuditRequest.Calls;code.Execute();Assert(AuditRequest.Calls==sent,"unchanged values suppressed");
  c.Values["obs.health.companion.obs_health_state.sentAt"]=0L;code.Execute();Assert(AuditRequest.Calls>sent,"expired cache reconciled");
  c.Connected=false;code.Execute();Assert(c.Alerts==0,"first disconnect debounced");code.Execute();Assert(c.Alerts==1,"sustained disconnect alarm");code.Execute();Assert(c.Alerts==1,"no repeated notification");
  c.Connected=true;c.Streaming=false;code.Execute();Assert(AuditRequest.Values["/api/custom-variable/obs_health_state/value"]=="IDLE","known stopped after recovery");
  Console.WriteLine("PASS: OBS offline/idle/stream, debounce, one alarm, cache refresh, recovery; all OBS/HTTP/notifications mocked.");
 }
}
