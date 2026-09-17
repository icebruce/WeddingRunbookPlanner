/**
 * Settling: making a committed change move rather than teleport.
 *
 * Regions are repainted by replacing their HTML, which destroys and rebuilds
 * every card. That is what keeps the renderers pure, and it is also why every
 * change used to land instantly: undo, a keyboard nudge, a duration typed into
 * the editor, a cancelled drag returning — all of them cut from one picture to
 * another with nothing in between. `DESIGN_GUIDE.md` §6 has always specified
 * 180 ms `ease-out` for "cards after a committed change", and for the
 * cancelled drag that "stays on the calm curve".
 *
 * The technique is FLIP: measure where everything is (First), let the paint
 * happen (Last), put everything back where it was with a transform (Invert),
 * then release it (Play). Because the measurement is taken from the screen as
 * it actually stands, this needs no knowledge of what changed — a card that
 * ends up where it already was simply does not move, which is exactly what
 * should happen when a drag commits to the position the finger already put it
 * in.
 *
 * Animations are driven through the Web Animations API rather than CSS
 * transitions. A transition needs the inverted state to be flushed to the
 * browser before the release, which means either a forced layout or a frame of
 * delay; an animation is handed both ends at once and needs neither, and it
 * tidies itself up instead of leaving inline styles to be cleared on a timer.
 *
 * Sharp for what you did; smooth for what the system did. This is the second
 * kind, so it never overshoots.
 */

/** `--dur-base` and the plain ease-out, in the one place a script can't read them. */
const DURATION_MS = 180;
const EASING = 'ease-out';
/**
 * Named, because a card carries CSS transitions of its own — the hover lift and
 * the selection ring are both `box-shadow`, and both last exactly as long as
 * this does. Without a name there is no way to ask whether a card is settling
 * or merely changing colour.
 */
export const SETTLE_ID = 'settle';
/** Under a pixel of movement is not movement. */
const MIN_SHIFT = 1;

/**
 * What settles, and what identifies it across a repaint.
 *
 * Open time is in here with the cards: a gap that snapped while the cards
 * either side of it glided would read as a hole in the day rather than as part
 * of it. The end marker moves whenever the last activity does.
 */
const TARGETS = [
  ['.card', node => `card:${node.dataset.activityId}`],
  ['.open-time', node => `gap:${node.dataset.before}`],
  ['.timeline-end', () => 'end']
];

/**
 * Positions are measured against the timeline's own coordinate space, and then
 * anchored to the clock.
 *
 * Measuring in page pixels looks right until the visible range moves. The
 * range starts at the earliest activity, so dragging that one activity later
 * re-bases the whole day: every other card's pixel position changes by the
 * same amount, and a pixel-space comparison reads that as every card in the
 * plan having moved. The first version of this animated a five-hour-away
 * ceremony sliding fifty-five minutes because something else had been nudged.
 *
 * Adding `from` back on cancels the re-basing exactly. What is left is each
 * element's position in minutes-since-midnight, which is the only coordinate a
 * card on this timeline really has — so a card only appears to move when its
 * own time has changed.
 */
const PX_PER_MIN = 4;

function positions(root) {
  const map = new Map();
  const grid = root.querySelector('.timeline-grid');
  if (!grid) return map;

  const origin = grid.getBoundingClientRect();
  const from = Number(grid.dataset.from);
  const anchor = Number.isFinite(from) ? from * PX_PER_MIN : 0;

  for (const [selector, key] of TARGETS) {
    for (const node of root.querySelectorAll(selector)) {
      const rect = node.getBoundingClientRect();
      map.set(key(node), {
        node,
        top: rect.top - origin.top + anchor,
        left: rect.left - origin.left,
        width: rect.width,
        height: rect.height
      });
    }
  }
  return map;
}

export function createSettle(root, { enabled = () => true } = {}) {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

  /**
   * Take the "before" picture and hand back the function that plays the
   * difference. Calling it is the caller's way of saying the paint is done.
   */
  return function capture() {
    if (!enabled() || reducedMotion?.matches) return () => {};

    const before = positions(root);
    if (!before.size) return () => {};

    return function play() {
      const after = positions(root);

      for (const [key, from] of before) {
        const to = after.get(key);
        // Gone. There is nothing left to animate — the node the change
        // removed went with the paint that removed it.
        if (!to) continue;

        const dy = from.top - to.top;
        const dx = from.left - to.left;
        const sameSize = Math.abs(from.height - to.height) < MIN_SHIFT
          && Math.abs(from.width - to.width) < MIN_SHIFT;
        if (Math.abs(dy) < MIN_SHIFT && Math.abs(dx) < MIN_SHIFT && sameSize) continue;

        to.node.animate(
          [
            {
              transform: `translate(${dx}px, ${dy}px)`,
              width: `${from.width}px`,
              height: `${from.height}px`
            },
            {
              transform: 'translate(0px, 0px)',
              width: `${to.width}px`,
              height: `${to.height}px`
            }
          ],
          { duration: DURATION_MS, easing: EASING, id: SETTLE_ID }
        );
      }
    };
  };
}
