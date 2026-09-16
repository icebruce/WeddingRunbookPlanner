/**
 * Toasts.
 *
 * They live in their own `role="status"` region, and they appear for three
 * things only: a change that can be undone, a change that moved the rest of
 * the day, and an error (D7). There is no "Saved" toast and no "Stage
 * updated" toast — the header already says whether the plan is saved, and the
 * card already shows its new stage. A toast that only confirms what is
 * visible teaches people to ignore toasts.
 *
 * One at a time: a new toast replaces the one on screen.
 */
const VISIBLE_MS = 6_000;

export function createToaster(region) {
  let current = null;
  let timer = null;

  function dismiss() {
    clearTimeout(timer);
    timer = null;
    if (!current) return;
    const node = current;
    current = null;
    node.classList.remove('is-visible');
    setTimeout(() => node.remove(), 200);
  }

  /**
   * `action` turns the toast into an offer: `{ label, run }`. That is how undo
   * is offered, and why deleting does not ask first (D7) — the answer to "are
   * you sure?" is six seconds of being able to say no.
   */
  function toast(message, { tone = 'neutral', action = null, duration = VISIBLE_MS } = {}) {
    dismiss();

    const node = document.createElement('div');
    node.className = `toast toast--${tone}`;

    const text = document.createElement('span');
    text.textContent = message;
    node.append(text);

    if (action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'toast-action';
      button.textContent = action.label;
      button.addEventListener('click', () => {
        dismiss();
        action.run();
      });
      node.append(button);
    }

    region.append(node);
    current = node;
    requestAnimationFrame(() => node.classList.add('is-visible'));
    timer = setTimeout(dismiss, duration);
    return node;
  }

  toast.dismiss = dismiss;
  return toast;
}

/** "2 activities shifted · +15 min", or nothing at all when nothing moved. */
export function shiftMessage(shifted) {
  if (!shifted || !shifted.count) return null;
  const count = `${shifted.count} ${shifted.count === 1 ? 'activity' : 'activities'} shifted`;
  if (!shifted.deltaMinutes) return count;
  const sign = shifted.deltaMinutes > 0 ? '+' : '−';
  return `${count} · ${sign}${Math.abs(shifted.deltaMinutes)} min`;
}
