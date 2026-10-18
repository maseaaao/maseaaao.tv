using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using NAudio.CoreAudioApi;

public static class AudioHelper {
 [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint nInputs,INPUT[] pInputs,int cbSize);
 [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
 [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
 [StructLayout(LayoutKind.Explicit)] struct INPUTUNION { [FieldOffset(0)] public KEYBDINPUT ki; [FieldOffset(0)] public MOUSEINPUT mi; }
 [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION u; }
  struct KeySpec { public ushort vk; }
  static readonly Dictionary<string,KeySpec> KeyNames=new Dictionary<string,KeySpec>(StringComparer.OrdinalIgnoreCase){
   {"end",new KeySpec{vk=0x23}},{"home",new KeySpec{vk=0x24}},{"pgup",new KeySpec{vk=0x21}},{"pgdn",new KeySpec{vk=0x22}},
   {"ins",new KeySpec{vk=0x2D}},{"del",new KeySpec{vk=0x2E}},{"scrolllock",new KeySpec{vk=0x91}},{"pause",new KeySpec{vk=0x13}}
  };
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint uCode,uint uMapType);
  static bool SendKey(string name){
   ushort vk;
   int n;
   if(name==null)return false;
   if(name.Length>=2&&name[0]=='F'&&int.TryParse(name.Substring(1),out n)&&n>=1&&n<=24)vk=(ushort)(0x70+n-1);
   else{
    KeySpec spec;
    if(!KeyNames.TryGetValue(name,out spec))return false;
    vk=spec.vk;
   }
   // Send as scan codes so apps listening via raw input / DirectInput (like Steam) see it as a physical press.
   uint vsc=MapVirtualKey(vk,4); // MAPVK_VK_TO_VSC_EX (layout-accurate, e.g. End->0x4F here)
   bool extended=(vsc>>8)==0xE0;uint scan=vsc&0xFF;
   var i=new INPUT[2];
   i[0].type=1;i[1].type=1;
   if(scan==0){ // no scancode in the layout: fall back to virtual-key events
    i[0].u.ki.wVk=vk;
    i[1].u.ki.wVk=vk;i[1].u.ki.dwFlags=2;
   }else{
    uint flags=0x8|(extended?0x1u:0); // KEYEVENTF_SCANCODE | KEYEVENTF_EXTENDEDKEY
    i[0].u.ki.wScan=(ushort)scan;i[0].u.ki.dwFlags=flags;
    i[1].u.ki.wScan=(ushort)scan;i[1].u.ki.dwFlags=flags|0x2;
   }
   return SendInput(2,i,Marshal.SizeOf(typeof(INPUT)))==2;
  }
 static readonly ConcurrentQueue<string> Commands=new ConcurrentQueue<string>();
 static readonly AutoResetEvent Wake=new AutoResetEvent(false);
 static volatile bool ended;
  static readonly Dictionary<string,List<AudioSessionControl>> Groups=new Dictionary<string,List<AudioSessionControl>> {
   {"discord",new List<AudioSessionControl>()},{"steam",new List<AudioSessionControl>()}
  };
  static readonly List<MMDevice> Devices=new List<MMDevice>();
  static readonly List<AudioSessionControl> Sessions=new List<AudioSessionControl>();
  static void Clear(){foreach(var s in Sessions)s.Dispose();Sessions.Clear();foreach(var d in Devices)d.Dispose();Devices.Clear();foreach(var g in Groups.Values)g.Clear();}
  static void AddSessions(MMDeviceEnumerator enumerator,DataFlow flow,string discordKey,string steamKey){
   foreach(var d in enumerator.EnumerateAudioEndPoints(flow,DeviceState.Active)){
    Devices.Add(d);var sessions=d.AudioSessionManager.Sessions;
    for(int i=0;i<sessions.Count;i++){
     var s=sessions[i];Sessions.Add(s);
     if(s.GetProcessID==0||s.State.ToString()=="AudioSessionStateExpired")continue;
     string name;
     try{using(var p=Process.GetProcessById((int)s.GetProcessID))name=p.ProcessName.ToLowerInvariant();}catch{continue;}
     if(name=="discord"||name=="discordptb"||name=="discordcanary")Groups[discordKey].Add(s);
     else if(name=="steam"||name=="steamwebhelper")Groups[steamKey].Add(s);
    }
   }
  }
  static void Scan(MMDeviceEnumerator enumerator){
   Clear();
   // Capture sessions are deliberately excluded: on this device their controls mirror to the whole input, affecting other apps.
   AddSessions(enumerator,DataFlow.Render,"discord","steam");
  }
 static string Bool(bool value){return value?"true":"false";}
 static string Status(string key){
  int count=0,muted=0;
  foreach(var s in Groups[key]){if(s.State.ToString()=="AudioSessionStateExpired")continue;count++;if(s.SimpleAudioVolume.Mute)muted++;}
  return "\""+key+"\":{\"available\":"+Bool(count>0)+",\"muted\":"+Bool(count>0&&muted==count)+",\"mixed\":"+Bool(muted>0&&muted<count)+",\"sessions\":"+count+"}";
 }
 public static void Main(){
  Console.OutputEncoding=new System.Text.UTF8Encoding(false);
  var reader=new Thread(()=>{try{string line;while((line=Console.ReadLine())!=null){if(line.Length<=128 && Commands.Count<32)Commands.Enqueue(line);Wake.Set();}}finally{ended=true;Wake.Set();}});
  reader.IsBackground=true;reader.Start();
  string last="";var lastSent=DateTime.MinValue;var scan=DateTime.MinValue;
  using(var enumerator=new MMDeviceEnumerator())try{
   while(!ended){
    string command;Commands.TryDequeue(out command);string result;
     // Hotkeys are independent of audio session enumeration.
     bool keyCommand=command!=null&&command.StartsWith("key:");
     bool keyFailed=keyCommand&&!SendKey(command.Substring(4));
     try{
      if((command!=null&&!keyCommand)||(DateTime.UtcNow-scan).TotalSeconds>=6){Scan(enumerator);scan=DateTime.UtcNow;}
      if(command!=null&&command.StartsWith("toggle:")){
       var gname=command.Substring(7);
       if(Groups.ContainsKey(gname)){
        var group=Groups[gname];bool allMuted=group.Count>0;
        foreach(var s in group)if(!s.SimpleAudioVolume.Mute)allMuted=false;
        foreach(var s in group)s.SimpleAudioVolume.Mute=!allMuted;
       }
      }
      result="{"+Status("discord")+","+Status("steam")+(keyFailed?",\"commandError\":true":"")+"}";
     }catch{result="{\"error\":\"Audio session unavailable\"}";scan=DateTime.MinValue;}
    if(result!=last||command!=null||(DateTime.UtcNow-lastSent).TotalSeconds>=5){Console.WriteLine(result);Console.Out.Flush();last=result;lastSent=DateTime.UtcNow;}
    if(Commands.IsEmpty)Wake.WaitOne(2000);
   }
  }finally{Clear();}
 }
}
