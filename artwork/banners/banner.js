function readCssNumber(name, fallback) {
  const rawValue = getComputedStyle(document.documentElement).getPropertyValue(name);
  const parsed = Number.parseFloat(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function applyBannerScale() {
  const baseWidth = readCssNumber("--banner-width", 2048);
  const baseHeight = readCssNumber("--banner-height", 1152);
  const scale = Math.min(window.innerWidth / baseWidth, window.innerHeight / baseHeight);
  document.documentElement.style.setProperty("--banner-scale", scale.toFixed(5));
}

applyBannerScale();
window.addEventListener("resize", applyBannerScale, { passive: true });
