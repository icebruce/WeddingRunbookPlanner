/*
 * Records what actually moves while the page is scrolled on a real device.
 *
 * Sampled every frame rather than on scroll events: the movement being chased
 * happens *during* the browser's own toolbar transition, which is exactly when
 * no scroll event is firing.
 */
const out = document.getElementById('out');
const bar = document.querySelector('.topbar');
const strip = document.querySelector('.strip');
const probe = document.getElementById('envprobe');
const root = document.documentElement;

const seen = new Map();

function track(name, value) {
  const n = Math.round(value * 100) / 100;
  const was = seen.get(name);
  if (!was) seen.set(name, { min: n, max: n, now: n });
  else {
    was.now = n;
    if (n < was.min) was.min = n;
    if (n > was.max) was.max = n;
  }
}

function sample() {
  const vv = window.visualViewport;
  const barRect = bar.getBoundingClientRect();
  const stripRect = strip.getBoundingClientRect();
  const css = name => getComputedStyle(root).getPropertyValue(name).trim();

  // Exactly what app.js does after every paint, so the strip here sticks the
  // way it does in the app rather than to the static token.
  root.style.setProperty('--topbar-height', `${Math.floor(barRect.height)}px`);

  track('topbar rect.top', barRect.top);
  track('topbar height', barRect.height);
  track('strip rect.top', stripRect.top);
  track('--topbar-height', parseFloat(css('--topbar-height')) || 0);
  track('--safe-top', parseFloat(css('--safe-top')) || 0);
  track('env() raw inset', parseFloat(getComputedStyle(probe).paddingTop) || 0);
  track('window.innerHeight', window.innerHeight);
  track('visualViewport.h', vv ? vv.height : -1);
  track('vv.offsetTop', vv ? vv.offsetTop : -1);
  track('vv.scale', vv ? vv.scale : -1);
  track('scrollY', window.scrollY);

  render();
  requestAnimationFrame(sample);
}

function render() {
  const rows = [];
  for (const [name, v] of seen) {
    const moved = v.max - v.min > 0.5;
    // scrollY is meant to change; it is the control.
    const cls = name === 'scrollY' ? '' : moved ? 'moved' : 'still';
    const range = moved ? `${v.min} → ${v.max}  (Δ${Math.round((v.max - v.min) * 100) / 100})` : 'held';
    rows.push(`<tr><td>${name}</td><td class="${cls}">${v.now}</td><td class="${cls}">${range}</td></tr>`);
  }
  out.innerHTML = `<table>${rows.join('')}</table>`;
}

requestAnimationFrame(sample);
