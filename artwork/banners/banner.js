function readCssNumber(element, name, fallback) {
  const rawValue = getComputedStyle(element).getPropertyValue(name);
  const parsed = Number.parseFloat(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function applyBannerScale() {
  const viewport = document.querySelector('.banner-viewport');
  if (!(viewport instanceof HTMLElement)) return;
  const baseWidth = readCssNumber(viewport, '--banner-width', 2560);
  const baseHeight = readCssNumber(viewport, '--banner-height', 1440);
  const scale = Math.min(window.innerWidth / baseWidth, window.innerHeight / baseHeight);
  viewport.style.setProperty('--banner-scale', scale.toFixed(5));
}

applyBannerScale();
window.addEventListener('resize', applyBannerScale, { passive: true });
