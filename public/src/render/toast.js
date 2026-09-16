/**
 * Toasts live in their own `role="status"` region. #app used to carry
 * aria-live="polite", which meant every repaint re-announced the entire
 * screen (F14); the only thing that should speak is the thing that just
 * happened.
 */
const VISIBLE_MS = 6_000;

export function createToaster(region) {
  return function toast(message, tone = 'neutral') {
    const node = document.createElement('div');
    node.className = `toast toast--${tone}`;
    node.textContent = message;
    region.append(node);
    requestAnimationFrame(() => node.classList.add('is-visible'));
    setTimeout(() => {
      node.classList.remove('is-visible');
      setTimeout(() => node.remove(), 200);
    }, VISIBLE_MS);
    return node;
  };
}
