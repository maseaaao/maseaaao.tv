Controls one explicitly selected Windows capture endpoint through Windows Core Audio.
Uses the existing NAudio.Core.dll and NAudio.Wasapi.dll in the configured Streamer.bot folder.
The helper is started and stopped by this connection. No network listener or startup task is used.
State and input volume are read every 250 ms, including changes made outside Companion.
Unplugged devices and helper failures show unavailable; the connection never selects another device silently.
