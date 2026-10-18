(() => {
  const key = "maseaaao.theme.v1";
  const root = document.documentElement;
  const normalize = value => value === "light" || value === "dark" ? value : "auto";
  function apply(value) {
    const theme = normalize(value);
    if (theme === "auto") delete root.dataset.theme;
    else root.dataset.theme = theme;
    document.querySelectorAll("[data-theme-value]").forEach(button => { button.setAttribute("aria-pressed", String(button.dataset.themeValue === theme)); });
    document.querySelectorAll("[data-theme-icon]").forEach(icon => { icon.toggleAttribute("hidden", icon.dataset.themeIcon !== theme); });
    const selected = document.querySelector(`[data-theme-value="${theme}"]`);
    const trigger = document.querySelector(".theme-trigger");
    if (selected && trigger) trigger.setAttribute("aria-label", `Цветовая тема: ${selected.getAttribute("aria-label")}`);
  }
  try { apply(localStorage.getItem(key)); } catch { /* CSS still follows the system. */ }
  document.addEventListener("DOMContentLoaded", () => {
    function notify() {
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.content = getComputedStyle(document.body).backgroundColor;
      document.dispatchEvent(new Event("themechange"));
    }
    document.querySelectorAll("[data-theme-control]").forEach(control => { control.hidden = false; });
    apply(root.dataset.theme);
    document.addEventListener("click", event => {
      document.querySelectorAll(".theme-control[open]").forEach(control => {
        if (control instanceof HTMLDetailsElement && event.target instanceof Node && !control.contains(event.target)) control.open = false;
      });
      const button = event.target instanceof Element ? event.target.closest("button[data-theme-value]") : null;
      if (!(button instanceof HTMLButtonElement)) return;
      const theme = normalize(button.dataset.themeValue);
      apply(theme);
      try {
        if (theme === "auto") localStorage.removeItem(key);
        else localStorage.setItem(key, theme);
      } catch { /* The choice remains active when storage is unavailable. */ }
      const control = button.closest(".theme-control");
      if (control instanceof HTMLDetailsElement) {
        control.open = false;
        control.querySelector("summary")?.focus();
      }
      notify();
    });
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      const control = document.querySelector(".theme-control[open]");
      if (!(control instanceof HTMLDetailsElement)) return;
      control.open = false;
      control.querySelector("summary")?.focus();
      event.preventDefault();
    });
    document.addEventListener("focusin", event => {
      const control = document.querySelector(".theme-control[open]");
      if (control instanceof HTMLDetailsElement && event.target instanceof Node && !control.contains(event.target)) control.open = false;
    });
    window.addEventListener("storage", event => {
      if (event.key !== key && event.key !== null) return;
      apply(event.newValue);
      notify();
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", notify);
    notify();
  });
})();
