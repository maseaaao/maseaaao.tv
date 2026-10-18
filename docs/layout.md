# Desktop viewing layout

Wide viewports (1101px and above) use two stable columns: profile, player and
chat on the left; a 300px column of platform/support links on the right. Contacts
span the bottom. Compact layouts retain the sequential profile → links → media
order. CSS controls this layout without detecting bots or full-screen APIs.

On nonmobile viewports (651px and above), the player and chat are open by default
in loading, online, offline and error states. Offline leaves the native Twitch
player visible; the status row retains the archive shortcut without replacing
the player with a card. Status changes preserve the frame nodes and geometry.
Users can collapse chat; their choice survives status updates and resizing.

The status row reserves 44px so switching its message or showing the archive
shortcut does not shift media. Player initialization still requires at least
402px of container width (400px inside the two borders), and the frame has a
300px minimum height. Below that width the external Twitch action remains.
Cold mobile loads keep chat collapsed and do not load its iframe until expanded.

The layout has the same behavior for visitors and crawlers. Profile text, links,
canonical/structured metadata and the real fallback iframe remain in source HTML.
The work adds no framework, dependency, timer or user-agent detection.

## Verification

Chromium 153: both themes, online/offline/SDK error, 12 viewport widths from
320px through 1920px, including both sides of the 1100/1101px layout breakpoint.
Checked visible text contrast, horizontal overflow, default media visibility,
Twitch minimum dimensions and the theme dropdown bounds (72 combinations).
The suite also checks stable link/video positions, retained iframe nodes,
keyboard controls, manual chat choices, 200% text and viewport defaults when the
player column itself does not resize.

Twitch SDK and iframe requests were isolated with test responses. The previews
show that isolated content, not an actual broadcast or real chat session.
