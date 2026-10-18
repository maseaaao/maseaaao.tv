(() => {
  const key = "maseaaao.theme.v1";
  const root = document.documentElement;
  const normalize = value => value === "light" || value === "dark" ? value : "auto";
  function apply(value) {
    const theme = normalize(value);
    if (theme === "auto") delete root.dataset.theme;
    else root.dataset.theme = theme;
    document.querySelectorAll("[data-theme-select]").forEach(select => { select.value = theme; });
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
    document.addEventListener("change", event => {
      if (!(event.target instanceof HTMLSelectElement) || !event.target.matches("[data-theme-select]")) return;
      const theme = normalize(event.target.value);
      apply(theme);
      try {
        if (theme === "auto") localStorage.removeItem(key);
        else localStorage.setItem(key, theme);
      } catch { /* The choice remains active when storage is unavailable. */ }
      notify();
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
