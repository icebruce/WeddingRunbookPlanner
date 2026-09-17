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
