(() => {
  const layout = document.querySelector("[data-stream-layout]");
  const content = document.querySelector(".stream-content");
  const badge = document.querySelector("[data-live-badge]");
  const offline = document.querySelector("[data-stream-offline]");
  const statusText = document.querySelector("[data-stream-status]");
  const playerDetails = document.querySelector("[data-stream-player]");
  const playerSummary = document.querySelector("[data-player-summary]");
  const fallback = document.querySelector("[data-player-fallback]");
  const chat = document.querySelector("[data-stream-chat]");
  const chatFrame = document.querySelector("[data-chat-frame]");
  const chatSummary = chat?.querySelector("summary");
  const mount = document.getElementById("twitch-player");
  const originalFrame = mount?.querySelector("iframe");

  if (
    !(layout instanceof HTMLElement) ||
    !(content instanceof HTMLElement) ||
    !(badge instanceof HTMLElement) ||
    !(offline instanceof HTMLElement) ||
    !(statusText instanceof HTMLElement) ||
    !(playerDetails instanceof HTMLDetailsElement) ||
    !(playerSummary instanceof HTMLElement) ||
    !(fallback instanceof HTMLElement) ||
    !(chat instanceof HTMLDetailsElement) ||
    !(chatFrame instanceof HTMLIFrameElement) ||
    !(chatSummary instanceof HTMLElement) ||
    !(mount instanceof HTMLElement) ||
    !(originalFrame instanceof HTMLIFrameElement)
  ) return;

  // Keep a real iframe as the fallback, including when this script never loads.
  const fallbackUrl = new URL(originalFrame.src);
  fallbackUrl.searchParams.delete("parent");
  fallbackUrl.searchParams.append("parent", window.location.hostname);
  originalFrame.remove();

  const desktop = window.matchMedia("(min-width:1000px)");
  let status = "loading";
  let chatPreference = null;
  let playerPreference = false;
  let player;
  let started = false;
  let ready = false;
  let failed = false;
  let playbackRequested = false;
  let blocked = false;
  let timeout;
  // The wrapper has two 1 px borders; Twitch needs 400 px inside the iframe.
  const canEmbed = () => content.getBoundingClientRect().width >= 402;

  function loadChat() {
    if (!chat.open || chatFrame.hasAttribute("src")) return;
    const source = chatFrame.dataset.src;
    if (!source) return;
    const url = new URL(source);
    url.searchParams.delete("parent");
    url.searchParams.append("parent", window.location.hostname);
    chatFrame.src = url.href;
  }

  function updateChat() {
    chat.open = chatPreference ?? (status === "online" && desktop.matches);
    loadChat();
  }

  // Summary click also covers keyboard activation; programmatic toggles do not.
  chatSummary.addEventListener("click", () => {
    chatPreference = !chat.open;
  });
  chat.addEventListener("toggle", loadChat);
  playerSummary.addEventListener("click", () => {
    playerPreference = !playerDetails.open;
  });
  desktop.addEventListener("change", updateChat);

  function attemptPlayback() {
    if (!ready || failed || status !== "online" || !canEmbed() || playbackRequested) return;
    playbackRequested = true;
    requestAnimationFrame(() => {
      if (failed || status !== "online" || !canEmbed()) {
        playbackRequested = false;
        return;
      }
      try {
        player.setMuted(true);
        player.play();
      } catch {
        blocked = true;
        render();
      }
    });
  }

  function render() {
    const wide = canEmbed();
    layout.dataset.state = status;
    badge.hidden = status !== "online";
    offline.hidden = status !== "offline";
    statusText.hidden = status === "offline" || (status === "loading" && !wide);
    statusText.textContent = status === "online"
      ? (blocked ? "Эфир идёт. Нажми ▶ в плеере, чтобы начать просмотр." : "Сейчас в эфире")
      : (status === "error" ? "Не удалось определить статус эфира. Можно открыть плеер или перейти на Twitch." : "Проверяем эфир…");
    playerSummary.hidden = status !== "offline";
    playerDetails.open = wide && (status === "online" || status === "error" || (status === "offline" && playerPreference));
    fallback.hidden = status !== "error";
    updateChat();
    attemptPlayback();
  }

  function fail() {
    if (failed) return;
    failed = true;
    clearTimeout(timeout);
    status = "error";
    originalFrame.src = fallbackUrl.href;
    mount.replaceChildren(originalFrame);
    render();
  }

  function setStatus(nextStatus) {
    if (failed || status === nextStatus) return;
    clearTimeout(timeout);
    status = nextStatus;
    playbackRequested = false;
    blocked = false;
    playerPreference = false;
    render();
  }

  function startPlayer() {
    if (started || !canEmbed()) return;
    started = true;
    const sdk = document.createElement("script");
    sdk.src = "https://player.twitch.tv/js/embed/v1.js";
    sdk.async = true;
    // READY alone does not establish whether the channel is online.
    timeout = setTimeout(fail, 12000);
    sdk.addEventListener("error", fail);
    sdk.addEventListener("load", () => {
      if (failed) return;
      if (!window.Twitch?.Player) {
        fail();
        return;
      }
      try {
        player = new window.Twitch.Player("twitch-player", {
          channel: "maseaaao",
          parent: [window.location.hostname],
          width: "100%",
          height: "100%",
          autoplay: true,
          muted: true,
        });
        player.addEventListener(window.Twitch.Player.READY, () => {
          if (failed) return;
          ready = true;
          const frame = mount.querySelector("iframe");
          if (frame) {
            frame.title = "Twitch-плеер MASEAAAO";
            frame.setAttribute("allow", "autoplay; fullscreen");
          }
          attemptPlayback();
        });
        player.addEventListener(window.Twitch.Player.ONLINE, () => setStatus("online"));
        player.addEventListener(window.Twitch.Player.OFFLINE, () => setStatus("offline"));
        player.addEventListener(window.Twitch.Player.PLAYBACK_BLOCKED, () => {
          if (failed) return;
          blocked = true;
          render();
        });
        player.addEventListener(window.Twitch.Player.PLAYING, () => {
          if (failed || !blocked) return;
          blocked = false;
          render();
        });
      } catch {
        fail();
      }
    });
    document.head.append(sdk);
  }

  const observer = new ResizeObserver(() => {
    if (!canEmbed()) playbackRequested = false;
    render();
    startPlayer();
  });
  observer.observe(content);
  render();
  startPlayer();
})();
