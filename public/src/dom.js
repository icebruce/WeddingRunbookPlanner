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
 * The top bar's real height, for everything that sticks to its underside.
 *
 * The token is a design floor (52 px, 62 px on a desktop) and the bar is often
 * taller than it — a notch's safe-area inset is part of its padding — which
 * left the live strip and the pinned bars sticking somewhere inside it. They
 * can only be right if the number they use is measured.
 *
 * Written exactly as measured, fractions and all. Rounding it down reads as
 * the safe direction — it tucks the strip that fraction *under* the bar rather
 * than leaving a seam the plan scrolls through — but a sticky element rests at
 * its natural position until it sticks, and its natural position is the bar's
 * true height. A bar measuring 53.4 px left the strip resting at 53.4 and
 * snapping to 53 the instant the page moved: a jump on the first scroll and
 * only the first, which is what it was reported as. The exact height is flush,
 * so there is nothing to snap to.
 */
export function measureTopbarHeight(root) {
  const topbar = root.querySelector('.topbar');
  if (!topbar) return;
  document.documentElement.style.setProperty(
    '--topbar-height', `${topbar.getBoundingClientRect().height}px`);
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

    const topbar = root.querySelector('.topbar');
    if (!topbar) return;

    const heading = root.querySelector('.planner-heading h1');
    // On the day there is no large title to hand over from: the bar carries the
    // title outright (D34). Nothing collapses, so the state is cleared rather
    // than left wherever the last scroll in planning mode put it.
    if (!heading) {
      topbar.classList.remove('is-collapsed');
      return;
    }

    // The line is the bottom of everything already stuck to the top of the
    // screen, not the bar alone. Measured from the bar it was right only while
    // the bar was the only thing up there: on the day the live strip sits under
    // it, so the title slid behind the strip and stayed hidden for the strip's
    // whole height before the bar took it over — a stretch of scrolling with
    // the title nowhere at all. Summed here rather than read from a custom
    // property so that a share link, which has a strip of its own, gets the
    // same answer without app.js having measured first.
    let furniture = 0;
    for (const node of root.querySelectorAll('.topbar, .live-strip, .pinned-bar')) {
      furniture += node.getBoundingClientRect().height;
    }
    const barHeight = Math.round(furniture) || Math.round(topbar.getBoundingClientRect().height);
    const watch = (inset, collapsedWhenHidden) => {
      const observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting === collapsedWhenHidden) return;
        topbar.classList.toggle('is-collapsed', !entry.isIntersecting);
      }, { rootMargin: `-${inset}px 0px 0px 0px`, threshold: 0 });
      observer.observe(heading);
      observers.push(observer);
    };
    // Going under the furniture collapses it; coming back out ten pixels below
    // restores it. Each observer only ever acts in its own direction.
    watch(barHeight, false);
    watch(Math.max(0, barHeight - HANDOVER_BAND), true);
  };
}
