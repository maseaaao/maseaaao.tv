Required configuration: two distinct Streamer.bot Action UUIDs (compared case-insensitively) (`startActionId`, `stopActionId`). Both must refer to enabled start/stop Actions. Dispatch uses IDs only; legacy Action-name fallback has been removed. Missing or malformed IDs stop the runtime and report invalid configuration; Heal cannot bypass this. Correcting the fields recovers the same connection. NAudio libraries are bundled; no Streamer.bot library directory is required.

Stream button: hold 3s to start, 2s to stop (short press cancels; blocked while OBS is offline or a command is pending). OBS status is authoritative. Idle: blue "rocket" label. Start hold: blue-to-red sweep with live second timer. Live: red film label. Stop hold: red-to-blue sweep with timer. Pending commands show an hourglass. Stream runs existing Streamer.bot STATE actions.

Discord buttons (purple base): microphone (hotkey, default F13) and teammates mute (hotkey, default F14). Real mic/deaf state (green/red-cross icons, yellow when off) comes from Discord local RPC over discord-ipc pipes - enable the local API in Discord settings; the module reconnects automatically (tries pipes 0-9). Without RPC, buttons stay static purple.

Output session toggles (per-app render audio, speaker/muted icons) remain available as actions. Capture endpoints are never touched: verified that session mutes on this USB device mirror to the whole input, so per-app mic muting is intentionally not implemented.

СБРОС button (2/2): restarts the module sockets, audio helper and Discord pipe scan without touching Companion. Use it if buttons show warning triangles or stop responding after a reboot.
