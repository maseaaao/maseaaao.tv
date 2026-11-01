using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Threading;
using NAudio.CoreAudioApi;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

public static class SystemAudioHelper
{
    static readonly ConcurrentQueue<string> Commands = new ConcurrentQueue<string>();
    static readonly AutoResetEvent Wake = new AutoResetEvent(false);
    static volatile bool ended;

    /// <summary>
    /// A pinned endpoint disappears after a driver reinstall, a Windows update or a USB
    /// port change; keep working with the system default until the pinned device returns.
    /// </summary>
    static MMDevice Resolve(MMDeviceEnumerator enumerator, string pinned, DataFlow flow, Role role) {
        if (!string.IsNullOrWhiteSpace(pinned)) {
            try {
                MMDevice pinnedDevice = enumerator.GetDevice(pinned);
                if (pinnedDevice.State == DeviceState.Active && pinnedDevice.DataFlow == flow) return pinnedDevice;
                pinnedDevice.Dispose();
            } catch {
                // Stale identifier: the endpoint no longer exists, use the system default.
            }
        }
        return enumerator.GetDefaultAudioEndpoint(flow, role);
    }

    public static void Main(string[] args)
    {
        Console.OutputEncoding = new System.Text.UTF8Encoding(false);
        string pinned = args.Length > 0 ? args[0] : "";
        bool output = args.Length > 1 && args[1] == "render";
        DataFlow flow = output ? DataFlow.Render : DataFlow.Capture;
        Role role = output ? Role.Multimedia : Role.Communications;
        var reader = new Thread(() => {
            try {
                string line;
                while ((line = Console.ReadLine()) != null) {
                    // No deferred burst of toggles after a stalled client.
                    if (line.Length <= 1024 && Commands.Count < 32) Commands.Enqueue(line);
                    Wake.Set();
                }
            } finally { ended = true; Wake.Set(); }
        });
        reader.IsBackground = true; reader.Start();
        var clock = Stopwatch.StartNew();
        long checkedAt = -1000, sentAt = -2000;
        string last = null;
        MMDevice device = null;
        using (var enumerator = new MMDeviceEnumerator()) try {
            while (!ended) {
                string command; Commands.TryDequeue(out command);
                string state;
                try {
                    // Cached endpoint; reconcile default output / reconnect once a second.
                    if (device == null || command != null || clock.ElapsedMilliseconds - checkedAt >= 1000) {
                        checkedAt = clock.ElapsedMilliseconds;
                        MMDevice current = Resolve(enumerator, pinned, flow, role);
                        if (current.State != DeviceState.Active || current.DataFlow != flow) {
                            current.Dispose(); throw new InvalidOperationException();
                        }
                        if (device == null || device.ID != current.ID) {
                            if (device != null) device.Dispose();
                            device = current;
                        } else current.Dispose();
                    }
                    var volume = device.AudioEndpointVolume;
                    if (command != null) {
                        string op = JObject.Parse(command).Value<string>("command");
                        switch (op) {
                            case "toggle": volume.Mute = !volume.Mute; break;
                            case "mute": volume.Mute = true; break;
                            case "unmute": volume.Mute = false; break;
                            default: throw new InvalidOperationException();
                        }
                    }
                    state = JsonConvert.SerializeObject(new {
                        available = true, muted = volume.Mute,
                        volume = (int)Math.Round(volume.MasterVolumeLevelScalar * 100), name = device.FriendlyName
                    });
                } catch {
                    if (device != null) { device.Dispose(); device = null; }
                    state = "{\"available\":false,\"error\":\"Selected audio device unavailable\"}";
                }
                if (state != last || command != null || clock.ElapsedMilliseconds - sentAt >= 2000) {
                    Console.WriteLine(state); Console.Out.Flush(); last = state; sentAt = clock.ElapsedMilliseconds;
                }
                if (Commands.IsEmpty) Wake.WaitOne(250);
            }
        } finally { if (device != null) device.Dispose(); }
    }
}
