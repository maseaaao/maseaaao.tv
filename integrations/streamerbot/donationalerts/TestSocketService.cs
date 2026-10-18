using System;
using System.Collections.Generic;
using System.Net;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
public class CPHInline {public class PrefixedLogger {public void Debug(string s,params object[] args){}}}
public class Service {
 public int Calls;
 public class ProfileInfoData {public int Id;public string SocketConnectionToken;}
 public class ChannelSubscribeResponse {public string Channel,Token;}
 public ProfileInfoData GetProfileInfo(string token){Interlocked.Increment(ref Calls);throw new WebException("mock offline without response");}
 public List<ChannelSubscribeResponse> ObtainChannelSubscribeToken(string a,int b,string c){throw new Exception("Unexpected service request");}
}
public static class TestSocketService {
 static void Assert(bool value,string name){if(!value)throw new Exception(name);}
 public static void Main(){
  var service=new Service();var socket=new SocketService(service,new CPHInline.PrefixedLogger());int donations=0;string text=null;
  socket.On(SocketService.EventRecievedDonation,(name,data)=>{donations++;text=data["content"];});
  var process=typeof(SocketService).GetMethod("ProcessMessage",BindingFlags.NonPublic|BindingFlags.Instance);
  Func<int,string> message=id=>JsonConvert.SerializeObject(new {result=new {channel="$alerts:donation_test",data=new {data=new {id=id,amount=1,message="Привет 🎉",username="test",currency="USD"}}}});
  process.Invoke(socket,new object[]{message(1)});process.Invoke(socket,new object[]{message(1)});
  Assert(donations==1&&text=="Привет 🎉","one delivery and UTF8 preserved");
  process.Invoke(socket,new object[]{"not JSON"});Assert(donations==1,"malformed ignored");
  for(int i=2;i<=1030;i++)process.Invoke(socket,new object[]{message(i)});
  var ids=(System.Collections.ICollection)typeof(SocketService).GetField("receivedOrder",BindingFlags.NonPublic|BindingFlags.Instance).GetValue(socket);
  Assert(ids.Count==1024,"dedup bounded");
  var thread=new Thread(()=>socket.Start("mock"));thread.Start();Thread.Sleep(100);
  socket.Start("mock");Assert(service.Calls==1,"duplicate start ignored");
  Thread.Sleep(1100);Assert(service.Calls==2,"network error retried with delay");
  socket.Close();Assert(thread.Join(1000),"cancel ends retry promptly");
  var next=new Thread(()=>socket.Start("mock"));next.Start();Thread.Sleep(100);socket.Close();Assert(next.Join(1000)&&service.Calls==3,"restart after close");
  Console.WriteLine("PASS: donation parsing/dedup/limits, malformed data, no-response network error, backoff, duplicate start, cancellation and restart; no network or chat.");
 }
}
