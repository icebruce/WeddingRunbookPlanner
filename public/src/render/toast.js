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
 *
 * Six seconds is the *unattended* life of a toast, not a hard limit. Undo is
 * the only way back from a delete, so the countdown stops while the toast is
 * being read — a pointer over it, or focus inside it — and starts again on the
 * way out. A timer that expires while someone is reaching for the one control
 * that undoes a destructive change is the timer being wrong, not the person.
 */
const VISIBLE_MS = 6_000;
const EXIT_MS = 200;
/** How far a toast has to be dragged down before letting go dismisses it. */
const SWIPE_DISMISS_PX = 28;
/** Or how fast, so a short flick dismisses as readily as a long drag. */
const SWIPE_DISMISS_VELOCITY = 0.4; // px/ms
/** Under this, the gesture was a tap and belongs to whatever it landed on. */
const SWIPE_SLOP = 6;

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
  /** Milliseconds still owed to the toast on screen, once it is let go of. */
  let remaining = 0;
  /** When the running timer was started, so the remainder can be worked out. */
  let startedAt = 0;
  /** Reasons the countdown is currently held: a pointer on it, focus in it. */
  const holds = new Set();

  function stopTimer() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    remaining = Math.max(0, remaining - (Date.now() - startedAt));
  }

  function startTimer() {
    if (!current || timer !== null || holds.size) return;
    startedAt = Date.now();
    timer = setTimeout(dismiss, remaining);
  }

  /** Hold the countdown while `reason` applies; release it when it stops. */
  function hold(reason, on) {
    if (on) {
      holds.add(reason);
      stopTimer();
      return;
    }
    holds.delete(reason);
    startTimer();
  }

  function dismiss() {
    stopTimer();
    holds.clear();
    remaining = 0;
    if (!current) return;
    const node = current;
    current = null;
    node.classList.remove('is-visible');
    setTimeout(() => node.remove(), EXIT_MS);
  }

  /**
   * Swipe a toast away. It sits at the bottom of the screen, so it leaves
   * downwards — the direction it came from — and follows the finger exactly
   * while it is being dragged, the same rule every other gesture in this app
   * follows. A movement under the slop is a tap and is left alone, so Undo
   * still works.
   */
  function bindSwipe(node) {
    let drag = null;

    node.addEventListener('pointerdown', event => {
      if (event.button > 0 || drag) return;
      // Deliberately no `setPointerCapture` here. Capturing on the way down
      // retargets the whole gesture at the toast, so the `click` the browser
      // works out from the pointerdown/pointerup pair lands on the toast
      // rather than on Undo — and Undo that does not fire is the one failure
      // this toast cannot afford. The capture is taken in `pointermove`, once
      // the movement has proved this is a swipe and not a tap.
      drag = { id: event.pointerId, y: event.clientY, at: Date.now(), dy: 0, moved: false };
    });

    node.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.abs(dy) < SWIPE_SLOP) return;
      if (!drag.moved) {
        drag.moved = true;
        hold('swipe', true);
        node.classList.add('is-dragging');
        // Now that it is a swipe, follow the finger even if it leaves the
        // toast — which it will, because the toast is leaving with it.
        node.setPointerCapture(event.pointerId);
      }
      // Downward follows the finger; upward is resisted, because there is
      // nothing above the toast for it to go to.
      drag.dy = dy > 0 ? dy : dy / 4;
      node.style.setProperty('--toast-drag', `${drag.dy}px`);
    });

    const release = event => {
      if (!drag || drag.id !== event.pointerId) return;
      const { dy, moved, at } = drag;
      drag = null;
      node.classList.remove('is-dragging');
      node.style.removeProperty('--toast-drag');
      if (!moved) return;

      const velocity = dy / Math.max(1, Date.now() - at);
      if (dy > SWIPE_DISMISS_PX || velocity > SWIPE_DISMISS_VELOCITY) {
        node.classList.add('is-swiped-out');
        dismiss();
        return;
      }
      hold('swipe', false);
    };

    node.addEventListener('pointerup', release);
    node.addEventListener('pointercancel', release);
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
    remaining = duration;
    requestAnimationFrame(() => node.classList.add('is-visible'));

    // Reading it stops the clock. A pointer resting on the toast and a
    // keyboard tabbed into it are the same statement: this is still wanted.
    node.addEventListener('pointerenter', () => hold('pointer', true));
    node.addEventListener('pointerleave', () => hold('pointer', false));
    node.addEventListener('focusin', () => hold('focus', true));
    node.addEventListener('focusout', () => hold('focus', false));
    bindSwipe(node);

    startTimer();
    return node;
  }

  toast.dismiss = dismiss;
  return toast;
}
