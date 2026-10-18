using System;
using System.Collections.Generic;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

class FakeSocket : WebSocket
{
    public byte[] Bytes; public int Chunk=13, Offset; public bool CloseFrame, Binary;
    public override WebSocketCloseStatus? CloseStatus {get{return null;}}
    public override string CloseStatusDescription {get{return null;}}
    public override WebSocketState State {get{return WebSocketState.Open;}}
    public override string SubProtocol {get{return null;}}
    public override void Abort(){}
    public override void Dispose(){}
    public override Task CloseAsync(WebSocketCloseStatus s,string d,CancellationToken c){return Task.FromResult(0);}
    public override Task CloseOutputAsync(WebSocketCloseStatus s,string d,CancellationToken c){return Task.FromResult(0);}
    public override Task SendAsync(ArraySegment<byte>b,WebSocketMessageType t,bool e,CancellationToken c){throw new Exception("No sends allowed");}
    public override Task<WebSocketReceiveResult> ReceiveAsync(ArraySegment<byte> buffer,CancellationToken cancel){
        cancel.ThrowIfCancellationRequested();
        if(CloseFrame)return Task.FromResult(new WebSocketReceiveResult(0,WebSocketMessageType.Close,true));
        int count=Math.Min(Math.Min(Chunk,buffer.Count),Bytes.Length-Offset);
        Array.Copy(Bytes,Offset,buffer.Array,buffer.Offset,count);Offset+=count;
        return Task.FromResult(new WebSocketReceiveResult(count,Binary?WebSocketMessageType.Binary:WebSocketMessageType.Text,Offset==Bytes.Length));
    }
}
public class TestMessages
{
    static void Assert(bool value,string name){if(!value)throw new Exception(name);}
    public static void Main(){
        string text="{\"message\":\"Привет 🎉 "+new string('я',6000)+"\"}";
        var socket=new FakeSocket{Bytes=Encoding.UTF8.GetBytes(text),Chunk=1};
        Assert(WebSocketMessages.Receive(socket,CancellationToken.None)==text,"UTF8 split inside characters");
        Assert(WebSocketMessages.Receive(new FakeSocket{CloseFrame=true},CancellationToken.None)==null,"close");
        bool rejected=false;try{WebSocketMessages.Receive(new FakeSocket{Bytes=new byte[WebSocketMessages.MaximumBytes+1],Chunk=3072},CancellationToken.None);}catch(InvalidDataException){rejected=true;}Assert(rejected,"limit");
        rejected=false;try{WebSocketMessages.Receive(new FakeSocket{Bytes=new byte[]{255}},CancellationToken.None);}catch(DecoderFallbackException){rejected=true;}Assert(rejected,"invalid UTF8");
        rejected=false;try{WebSocketMessages.Receive(new FakeSocket{Bytes=new byte[]{1},Binary=true},CancellationToken.None);}catch(InvalidDataException){rejected=true;}Assert(rejected,"binary");
        var cancel=new CancellationTokenSource();cancel.Cancel();rejected=false;try{WebSocketMessages.Receive(socket,cancel.Token);}catch(OperationCanceledException){rejected=true;}Assert(rejected,"cancel");
        Console.WriteLine("PASS: six WebSocket transport scenarios; no network or chat messages.");
    }
}
