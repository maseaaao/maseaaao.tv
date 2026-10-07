(() => {
  const badge = document.querySelector("[data-live-badge]");
  const offline = document.querySelector("[data-stream-offline]");
  const playerDetails = document.querySelector("[data-stream-player]");
  const playerSummary = document.querySelector("[data-player-summary]");
  const fallback = document.querySelector("[data-player-fallback]");
  const chat = document.querySelector("[data-stream-chat]");
  const chatFrame = document.querySelector("[data-chat-frame]");
  const mount = document.getElementById("twitch-player");

  if (
    !(badge instanceof HTMLElement) ||
    !(offline instanceof HTMLElement) ||
    !(playerDetails instanceof HTMLDetailsElement) ||
    !(playerSummary instanceof HTMLElement) ||
    !(fallback instanceof HTMLElement) ||
    !(chat instanceof HTMLDetailsElement) ||
    !(chatFrame instanceof HTMLIFrameElement) ||
    !(mount instanceof HTMLElement)
  ) {
    return;
  }

  function loadChat() {
    if (!chat.open || chatFrame.hasAttribute("src")) return;
    const source = chatFrame.dataset.src;
    if (!source) return;
    const url = new URL(source);
    url.searchParams.delete("parent");
    url.searchParams.append("parent", window.location.hostname);
    chatFrame.src = url.href;
  }

  chat.addEventListener("toggle", loadChat);
  chat.open = window.matchMedia("(min-width:1000px)").matches;
  loadChat();

  // Unknown or blocked status must never be presented as LIVE or offline.
  let status = "unknown";
  function setStatus(nextStatus) {
    if (status === nextStatus) return;
    status = nextStatus;
    const isOnline = status === "online";
    badge.hidden = !isOnline;
    offline.hidden = isOnline;
    playerSummary.hidden = isOnline;
    playerDetails.open = isOnline;
    chat.open = isOnline && window.matchMedia("(min-width:1000px)").matches;
    loadChat();
  }

  const sdk = document.createElement("script");
  sdk.src = "https://player.twitch.tv/js/embed/v1.js";
  sdk.async = true;
  sdk.addEventListener("load", () => {
    if (!window.Twitch?.Player) {
      mount.hidden = true;
      return;
    }
    try {
      const player = new window.Twitch.Player("twitch-player", {
        channel: "maseaaao",
        parent: [window.location.hostname],
        width: "100%",
        height: "100%",
        autoplay: true,
        muted: true,
      });
      player.addEventListener(window.Twitch.Player.READY, () => {
        const frame = mount.querySelector("iframe");
        if (frame) {
          frame.title = "Twitch-плеер MASEAAAO";
          frame.setAttribute("allow", "autoplay; fullscreen");
        }
        fallback.hidden = true;
      });
      player.addEventListener(window.Twitch.Player.ONLINE, () => setStatus("online"));
      player.addEventListener(window.Twitch.Player.OFFLINE, () => setStatus("offline"));
    } catch {
      // Keep the direct Twitch link available if SDK initialization fails.
      mount.hidden = true;
    }
  });
  sdk.addEventListener("error", () => {
    mount.hidden = true;
  });
  document.head.append(sdk);
})();
