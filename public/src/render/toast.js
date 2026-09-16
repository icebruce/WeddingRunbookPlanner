/**
 * Toasts.
 *
 * They live in their own `role="status"` region, and they appear for two
 * things only: a change that can be undone, and an error (D7). There is no
 * "Saved" toast and no "Stage updated" toast — the header already says
 * whether the plan is saved, and the card already shows its new stage. A
 * toast that only confirms what is visible teaches people to ignore toasts.
 *
 * One at a time: a new toast replaces the one on screen.
 */
const VISIBLE_MS = 6_000;

/**
 * `host()` says where the toast should go. A modal <dialog> renders in the
 * browser's top layer, above everything else on the page — so a toast left in
 * its usual place while a sheet is open is visible but not pressable, and
 * "Undo" that cannot be pressed is not an offer. When a sheet is open the
 * toast goes inside it.
 */
export function createToaster(region, host = () => region) {
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

    const parent = host() || region;
    if (parent !== region) node.classList.add('toast--layered');
    parent.append(node);
    current = node;
    requestAnimationFrame(() => node.classList.add('is-visible'));
    timer = setTimeout(dismiss, duration);
    return node;
  }

  toast.dismiss = dismiss;
  return toast;
}
