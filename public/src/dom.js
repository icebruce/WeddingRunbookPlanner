/**
 * Small DOM helpers shared by the region renderers.
 *
 * The important one is `paint`. Regions are repainted independently, and a
 * repaint must not steal focus from whatever the user is using — toggling a
 * lock used to rebuild the whole app and drop focus on <body>, so the next Tab
 * started from the top of the page (F14). Every focusable control carries a
 * `data-focus-key`; the key is read before the repaint and focus is put back
 * on the element carrying it afterwards.
 */

export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function uid(prefix = 'activity') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function focusKeyOf(element) {
  return element?.closest?.('[data-focus-key]')?.getAttribute('data-focus-key') ?? null;
}

/** Replace a region's contents, keeping focus and scroll position. */
export function paint(container, html) {
  if (!container) return;
  const key = container.contains(document.activeElement) ? focusKeyOf(document.activeElement) : null;
  const selection = key ? captureSelection(document.activeElement) : null;

  container.innerHTML = html;

  if (!key) return;
  const restored = container.querySelector(`[data-focus-key="${cssEscape(key)}"]`);
  if (!restored) return;
  restored.focus({ preventScroll: true });
  if (selection && typeof restored.setSelectionRange === 'function') {
    try {
      restored.setSelectionRange(selection.start, selection.end);
    } catch {
      // Not every input type supports a selection range; losing the caret
      // position is acceptable, losing focus is not.
    }
  }
}

function captureSelection(element) {
  if (typeof element.selectionStart !== 'number') return null;
  return { start: element.selectionStart, end: element.selectionEnd };
}

export function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

/** Focus the element carrying a focus key, wherever it currently lives. */
export function focusByKey(root, key) {
  if (!key) return false;
  const target = root.querySelector(`[data-focus-key="${cssEscape(key)}"]`);
  if (!target) return false;
  target.focus({ preventScroll: true });
  return true;
}

/**
 * Once the large title has scrolled past, the top bar takes it over.
 *
 * Watched rather than measured on every scroll event, so it costs nothing
 * while scrolling a long day — and watched *twice*, at two lines ten pixels
 * apart. One boundary means that resting the scroll on the handover, where
 * momentum and sub-pixel rounding leave it wandering back and forth across a
 * single line, flips the title with it. Collapsing at the lower line and
 * coming back only at the higher one gives the decision somewhere to sit.
 *
 * Returns a function that re-reads the page; call it after the regions that
 * hold the heading and the bar have been repainted.
 */
const HANDOVER_BAND = 10;

export function watchCollapsedTitle(root) {
  const observers = [];
  return () => {
    for (const observer of observers) observer.disconnect();
    observers.length = 0;

    const heading = root.querySelector('.planner-heading h1');
    const topbar = root.querySelector('.topbar');
    if (!heading || !topbar) return;

    // The margin is the bar's own height, so the title hands over exactly as it
    // goes under it — 52 px on a phone, 62 px on a desktop.
    const barHeight = Math.round(topbar.getBoundingClientRect().height);
    const watch = (inset, collapsedWhenHidden) => {
      const observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting === collapsedWhenHidden) return;
        topbar.classList.toggle('is-collapsed', !entry.isIntersecting);
      }, { rootMargin: `-${inset}px 0px 0px 0px`, threshold: 0 });
      observer.observe(heading);
      observers.push(observer);
    };
    // Going under the bar collapses it; coming back out ten pixels below
    // restores it. Each observer only ever acts in its own direction.
    watch(barHeight, false);
    watch(Math.max(0, barHeight - HANDOVER_BAND), true);
  };
}
