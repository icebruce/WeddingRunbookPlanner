/**
 * Pulling a sheet down to dismiss it.
 *
 * The grabber at the top of a sheet is not decoration. On a phone it is a
 * standard affordance with a fixed meaning — Maps, Music, Photos, the share
 * sheet, the tab switcher all respond to being pulled — and this app drew one
 * for a sheet that could only be closed from the Cancel button in its top left
 * corner, which is the worst place on a large phone for a thumb to reach.
 * `app.js` even carried a comment saying that swiping a sheet down and pressing
 * Cancel were the same thing. They were not; now they are.
 *
 * Dismissing goes through the same `close` the Cancel button uses, so a sheet
 * with typing in it still asks before throwing it away. The drag does not close
 * the dialog itself: it hands over and puts the sheet back at rest, so if the
 * question is asked the sheet is sitting properly underneath it, and "Keep
 * editing" comes back to something that has not moved.
 *
 * This lives apart from `gestures.js`, which is about the timeline — its whole
 * vocabulary is cards, minutes and the clock, and none of that applies here.
 */
import { tick } from './haptics.js';

/** Below this, the finger has not said anything yet. */
const SLOP = 8;
/** How far down the sheet has to be pulled for letting go to dismiss it. */
const DISMISS_FRACTION = 0.4;
/** Or how fast, so a short flick dismisses as readily as a long pull. */
const DISMISS_VELOCITY = 0.5; // px/ms
/**
 * The sheet curve, read from the tokens so §6 is written down once.
 *
 * Longhands, not the `transition` shorthand. A shorthand carrying a `var()` is
 * held as a pending substitution — the same trap `.sheet`'s own `inset` and
 * the reduced-motion charge ring's `animation` both hit, and both on WebKit,
 * where it reads correctly everywhere this was built and does nothing on the
 * one engine that matters most here.
 */
const SPRING = {
  transitionProperty: 'transform',
  transitionDuration: 'var(--dur-sheet)',
  transitionTimingFunction: 'var(--ease-sheet)'
};

function setTransition(sheet, on) {
  for (const [property, value] of Object.entries(SPRING)) {
    sheet.style[property] = on ? value : '';
  }
}
/** Pulling up has nowhere to go, so it is resisted rather than refused. */
const RESISTANCE = 4;

/**
 * Whether a press at this point may begin a pull.
 *
 * Anywhere on the sheet's own chrome will do — the grabber and the header are
 * not scrollable and have nothing else to be doing. Inside the scrolling body
 * the pull is only available at the very top, because below that a downward
 * drag means scrolling back up, and taking that away would be worse than not
 * having the gesture at all.
 *
 * Form controls keep their own gestures. A stepper, a switch and a text field
 * all read a drag as something, and none of them mean "close this".
 */
function mayDrag(event, sheet) {
  if (event.target.closest('input, textarea, select, button, [role="button"], .flatpickr-calendar')) return false;
  const body = event.target.closest('.sheet-body');
  if (body && body.scrollTop > 0) return false;
  return sheet.contains(event.target);
}

export function bindSheetDrag(dialog, { close, isNarrow = () => window.matchMedia('(max-width: 720px)').matches }) {
  const sheet = dialog.querySelector('.sheet');
  if (!sheet) return;

  let drag = null;

  const setOffset = offset => {
    sheet.style.transform = offset ? `translateY(${offset}px)` : '';
    // The scrim lightens as the sheet leaves, so the page underneath comes
    // back as it goes rather than all at once at the end.
    const fade = Math.max(0, 1 - offset / Math.max(1, sheet.offsetHeight));
    dialog.style.setProperty('--scrim-fade', String(fade));
  };

  const rest = () => {
    sheet.classList.remove('is-dragging');
    setTransition(sheet, true);
    setOffset(0);
    sheet.addEventListener('transitionend', () => setTransition(sheet, false), { once: true });
  };

  dialog.addEventListener('pointerdown', event => {
    if (drag || event.button > 0 || !isNarrow()) return;
    if (!mayDrag(event, sheet)) return;
    drag = { id: event.pointerId, y: event.clientY, at: Date.now(), offset: 0, live: false };
  });

  dialog.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const dy = event.clientY - drag.y;

    if (!drag.live) {
      // Only a downward pull starts one. Upward is the body scrolling, even at
      // the top of it, and a sheet that jumped at an upward flick would feel
      // like it was trying to get away.
      if (dy < SLOP) return;
      drag.live = true;
      // The sheet rises into place with an animation of its own, and a running
      // animation's transform beats an inline one — so a pull that starts
      // inside those 240 ms moved nothing at all while the sheet carried on
      // arriving. The hand outranks the entrance: finish it and take over.
      for (const animation of sheet.getAnimations()) animation.finish();
      // Now that it is a pull rather than a tap, follow the finger even when
      // it leaves the sheet — which it will, because the sheet is going with
      // it.
      sheet.setPointerCapture(event.pointerId);
      // The sheet now carries a transition of its own — it arrives and leaves
      // on one (styles/sheets.css) — and a transition is exactly what a
      // direct manipulation must not have. Clearing the inline one is no
      // longer enough to be rid of it.
      sheet.classList.add('is-dragging');
      setTransition(sheet, false);
    }

    drag.offset = dy > 0 ? dy : dy / RESISTANCE;
    setOffset(drag.offset);
  });

  /**
   * A pointer event's preventDefault cannot stop a scroll; only the touchmove
   * underneath it can. The sheet body pans, so once a pull has begun the pan
   * has to be refused here or the body scrolls while the sheet moves.
   */
  dialog.addEventListener('touchmove', event => {
    if (drag?.live) event.preventDefault();
  }, { passive: false });

  const release = event => {
    if (!drag || drag.id !== event.pointerId) return;
    const { offset, live, at } = drag;
    drag = null;
    if (!live) return;

    const height = sheet.offsetHeight;
    const velocity = offset / Math.max(1, Date.now() - at);
    // A sheet with no measurable height cannot say how far is far enough, and
    // `offset > 0 * 0.4` is true of every drag there has ever been. Fail
    // closed: the sheet stays, and Cancel still works.
    const far = height > 0 && offset > height * DISMISS_FRACTION;

    // Back to rest either way. If `close` really closes, the dialog goes and
    // none of this matters; if it stops to ask whether to discard the typing,
    // the sheet is already sitting where it belongs underneath the question.
    rest();
    if (!(far || velocity > DISMISS_VELOCITY)) return;
    // The pull was enough. The sheet is on its way out under the finger that
    // sent it, which is the moment to say so rather than after it has gone.
    tick();
    close();
  };

  dialog.addEventListener('pointerup', release);
  dialog.addEventListener('pointercancel', release);
}
