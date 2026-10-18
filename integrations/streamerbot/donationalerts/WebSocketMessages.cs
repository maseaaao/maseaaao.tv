using System;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;

public static class WebSocketMessages
{
    public const int MaximumBytes = 1024 * 1024;
    public static string Receive(WebSocket socket, CancellationToken cancellation)
    {
        var buffer = new ArraySegment<byte>(new byte[3072]);
        using (var message = new MemoryStream())
        using (var partial = CancellationTokenSource.CreateLinkedTokenSource(cancellation))
        {
            while (true)
            {
                var result = socket.ReceiveAsync(buffer, partial.Token).GetAwaiter().GetResult();
                if (result.MessageType == WebSocketMessageType.Close) return null;
                if (result.MessageType != WebSocketMessageType.Text) throw new InvalidDataException("Expected text message");
                if (message.Length + result.Count > MaximumBytes) throw new InvalidDataException("Message size limit");
                message.Write(buffer.Array, 0, result.Count);
                if (result.EndOfMessage) return new UTF8Encoding(false, true).GetString(message.ToArray());
                if (message.Length == result.Count) partial.CancelAfter(10000);
            }
        }
    }
}
