# Responsive viewing layout

At every viewport width, the profile is followed by platform/support links,
then media and contacts. From 768px, the player and chat share a row below the
links. The player column reserves at least 402px; chat uses the remaining width.
Below 768px, media stacks vertically. CSS controls placement without detecting
devices, bots or full-screen APIs.

On nonmobile viewports (768px and above), the player and chat are open by default
in loading, online, offline and error states. Offline leaves the native Twitch
player visible; the status row retains the archive shortcut without replacing
the player with a card. Status changes preserve the frame nodes and geometry.
Users can collapse chat; their choice survives status updates and resizing.

The Twitch SDK and fallback iframe both request autoplay with sound muted.
When an online player is ready, the script also sets muted before requesting
playback. If playback is blocked, the status message exposes the manual play
action; browser permission to autoplay is not guaranteed.

The status row reserves 44px so switching its message or showing the archive
shortcut does not shift media. Player initialization still requires at least
402px of container width (400px inside the two borders), and the frame has a
300px minimum height. Below that width the external Twitch action remains.
Cold mobile loads keep chat collapsed and do not load its iframe until expanded.

The layout has the same behavior for visitors and crawlers. Profile text, links,
canonical/structured metadata and the real fallback iframe remain in source HTML.
The work adds no framework, dependency, timer or user-agent detection.

## Verification

The browser suite checks online/offline/SDK error states, viewports from 320px through 1920px, contrast, overflow, keyboard controls, enlarged text, media sizing, stable iframe nodes and fixed-light rendering under both system color preferences. Twitch responses are mocked; this does not test a real broadcast or chat. Fresh migration results are recorded in migration-20261019.md.
