/**
 * Direct manipulation: select, hold to lift, resize and drag.
 *
 * The rule that shapes all of it: a swipe that starts anywhere on a card
 * scrolls the day. Cards carry `touch-action: pan-y` and nothing here calls
 * preventDefault before a gesture has actually begun, so the browser is free to
 * take the touch as a scroll.
 *
 * There is no drag handle. The card body is the drag surface, which is what
 * every calendar already teaches, and what distinguishes a move from a scroll
 * is *stillness*, not which pixels were touched: hold a card without moving and
 * it lifts. A mouse has no such ambiguity — nothing scrolls by dragging — so it
 * lifts on movement alone, at AppKit's own 3 px threshold.
 *
 * A drag moves an activity to wherever it is dropped: there is no list to
 * reorder into, because clock time *is* position. Ctrl/Cmd-click adds a card
 * to a group selection; dragging any member of that group carries the whole
 * group by the same number of minutes, and a locked card in the group simply
 * does not move.
 *
 * One gesture at a time. Pointer positions are read in `pointermove` and every
 * write to the DOM happens in one `requestAnimationFrame`, so an edge follows
 * the finger without the layout being rebuilt per event (F7).
 */
import { PX_PER_MIN, applyLaneStyle, buildLayout, overlapBox } from './layout.js';
import { buildSchedule, formatDuration, formatTime } from './schedule.js';
import { moveGroup, moveTo, resizeBottom, resizeTop } from './operations.js';
import { cssEscape } from './dom.js';
import { refit } from './render/fit.js';

/** Movement thresholds, in CSS pixels. */
const TAP_SLOP = 6;
/**
 * A mouse lifts on movement alone. 3 px is AppKit's own drag threshold — and it
 * is safe to be this eager because a move under 10 px rounds to zero minutes,
 * so the eager lift is a state you can see and back out of, not a change.
 */
const POINTER_SLOP = 3;
/**
 * Cancelling the hold is judged per axis, not by distance. The gesture this
 * competes with is a vertical scroll, so vertical movement is the signal;
 * sideways drift is a thumb pivoting around its knuckle and means nothing.
 */
const HOLD_CANCEL_Y = 10;
const HOLD_CANCEL_X = 20;
/**
 * Long enough to rule out the stationary beat before a swipe, short enough not
 * to feel like a wait. Apple reserves 500 ms for presses that are *contended*
 * (the Home screen owes one press to both rearrange and a context menu); here
 * the only rival is scrolling, and movement already settles that.
 */
const HOLD_MS = 300;
/**
 * The open-time block's own long press, which opens its actions sheet. It keeps
 * the slower, contended figure: a sheet is a heavier outcome than a lift, and
 * unlike a card there is no charge animation telegraphing that it is coming.
 */
const LONG_PRESS_MS = 500;
const LONG_PRESS_CANCEL = 10;
/**
 * Autoscroll: proportional to depth into the edge, and eased in over time.
 *
 * A finger needs a generous edge, because it cannot be placed precisely and it
 * covers what it is aiming at. A mouse needs a mean one: a deep zone at the
 * bottom of a window is triggered just by reaching for something low down.
 */
const AUTOSCROLL_ZONE_RATIO = 0.15;
const AUTOSCROLL_ZONE_MIN = 64;
const AUTOSCROLL_ZONE_MAX = 120;
const AUTOSCROLL_ZONE_FINE = 72;
/** A thumb rests low while dragging, so the bottom zone is the tighter one. */
const AUTOSCROLL_ZONE_BOTTOM_TOUCH = 64;
const AUTOSCROLL_MIN = 60;   // px/s — 15 min/s, slow enough to hold steady on
const AUTOSCROLL_MAX = 720;  // px/s — 3 hours/s, a whole day in about five
const AUTOSCROLL_RAMP_MS = 120;
/** How close together two taps on the same card have to land to count as a double-click. */
const DOUBLE_TAP_MS = 400;

export function createGestures({ root, store, commit, repaint, onDoubleClick, onOpenTimeActivate }) {
  /** The one gesture in progress, if any. */
  let active = null;
  /** A press that has not yet become a tap, a lift or a scroll. */
  let candidate = null;
  /** Same, for a press on an open-time block rather than a card. */
  let openTimeCandidate = null;
  let frame = null;
  let suppressClickUntil = 0;
  /**
   * Selecting a card repaints the timeline synchronously, on the same tick as
   * this tap's own pointerup — which can replace the card element out from
   * under the second click of a real double-click before the browser gets to
   * hit-test it, so the native `dblclick` event silently never fires (it
   * ends up targeting whatever is left where the card used to be). Two taps
   * on the same activity, close together, are tracked here instead, so
   * opening the editor never depends on the browser's own double-click
   * timing racing our re-render.
   */
  let lastTap = null;
  /** Same, for a double-click on the same open-time block. */
  let lastOpenTimeTap = null;

  const cardFor = id => root.querySelector(`.card[data-activity-id="${cssEscape(id)}"]`);
  const scheduleOf = plan => buildSchedule(plan);

  function schedulePaint(write) {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = null;
      write();
    });
  }

  function cancelPaint() {
    if (frame === null) return;
    cancelAnimationFrame(frame);
    frame = null;
  }

  // ------------------------------------------------------------- selection

  function onCardPointerDown(event) {
    // One finger at a time. A second press used to overwrite the first
    // candidate while its hold timer was still armed, and the timer read
    // whatever `candidate` had become — so two fingers lifted the wrong card
    // and left the first one looking pressed for good.
    if (active || candidate || openTimeCandidate || event.button > 0) return;
    const card = event.target.closest('.card');
    if (!card) return;
    // Handles run their own gesture, and an open menu is not part of the card.
    if (event.target.closest('.handle, .stage-menu')) return;

    const draggable = card.classList.contains('is-draggable');
    /**
     * A tap on one of the card's own buttons belongs to that button. A *hold*
     * does not: the stage pill and the people tags cover much of a phone card,
     * and excluding them outright would punch holes in the drag surface exactly
     * where a thumb lands. So the hold arms over them too, and the click it
     * leaves behind is suppressed (`suppressingClick`) so the button never also
     * fires. A pointer keeps the plain exclusion — a mouse on a button that
     * drifts three pixels meant to press the button.
     */
    const onButton = Boolean(event.target.closest('button'));
    if (onButton && !draggable) return;

    const id = card.dataset.activityId;
    card.classList.add('is-pressed');

    candidate = {
      id,
      card,
      onButton,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      touch: event.pointerType !== 'mouse',
      groupPick: event.ctrlKey || event.metaKey,
      hold: null
    };

    // Holding a card still is what lifts it. The pressed state appears at once
    // and deepens across the hold (`is-charging`), so with no grip to advertise
    // the gesture the card itself does: you can feel the lift coming and let go
    // before it fires. Any movement that looks like a scroll abandons it.
    if (candidate.touch && draggable) {
      const pressed = candidate;
      card.style.setProperty('--hold-ms', `${HOLD_MS}ms`);
      requestAnimationFrame(() => {
        if (candidate === pressed) card.classList.add('is-charging');
      });
      // The press this timer belongs to, captured rather than read back: by
      // the time it fires, `candidate` may be somebody else's.
      pressed.hold = setTimeout(() => {
        if (candidate !== pressed) return;
        beginMove(pressed, pressed.y);
      }, HOLD_MS);
    }
  }

  function onCardPointerMove(event) {
    if (!candidate || candidate.pointerId !== event.pointerId) return;
    const dx = Math.abs(event.clientX - candidate.x);
    const dy = Math.abs(event.clientY - candidate.y);

    if (candidate.touch) {
      if (dy > HOLD_CANCEL_Y || dx > HOLD_CANCEL_X) clearCandidate();
      return;
    }
    // A mouse cannot scroll by dragging, so there is nothing to disambiguate:
    // movement is the whole signal, and the card lifts at once.
    if (Math.hypot(dx, dy) > POINTER_SLOP) {
      if (candidate.onButton || !candidate.card.classList.contains('is-draggable')) clearCandidate();
      else beginMove(candidate, event.clientY);
    }
  }

  function onCardPointerUp(event) {
    if (!candidate || candidate.pointerId !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y);
    const { id, groupPick, onButton } = candidate;
    clearCandidate();
    if (moved > TAP_SLOP) return;
    // The hold did not fire, so this really was a tap on the button: leave it
    // to its own click handler rather than also selecting the card.
    if (onButton) return;

    if (groupPick) {
      lastTap = null;
      const current = new Set(store.ui.groupSelection.length ? store.ui.groupSelection : (store.ui.selectedId ? [store.ui.selectedId] : []));
      if (current.has(id)) current.delete(id); else current.add(id);
      const next = [...current];
      store.setUi({
        groupSelection: next.length > 1 ? next : [],
        selectedId: next.length ? next[next.length - 1] : null,
        openMenu: null
      }, { regions: ['timeline', 'toolbar'] });
      return;
    }

    // Both pointers: the long press belongs to the move now, so a double tap is
    // what opens the editor on touch, exactly as a double click does elsewhere.
    if (onDoubleClick && lastTap && lastTap.id === id && Date.now() - lastTap.time <= DOUBLE_TAP_MS) {
      lastTap = null;
      onDoubleClick(id);
      return;
    }
    lastTap = { id, time: Date.now() };

    store.setUi({ selectedId: id, groupSelection: [], openMenu: null }, { regions: ['timeline', 'toolbar'] });
  }

  /**
   * A scroll used to cancel any press outright, on the grounds that it was
   * never a press. That is too blunt now that the press is what lifts a card:
   * momentum carries a flick on for a moment, and a finger landing while the
   * day is still gliding to a stop would have its hold quietly refused.
   *
   * What actually invalidates the press is the card being carried out from
   * under the finger. While it is still underneath, the press means what it
   * meant, and the lift reads its origin at lift time, so the scroll in
   * between costs nothing.
   */
  function onScrollDuringPress() {
    if (!candidate) return;
    const box = candidate.card.getBoundingClientRect();
    if (candidate.y < box.top || candidate.y > box.bottom) clearCandidate();
  }

  function clearCandidate() {
    if (!candidate) return;
    clearTimeout(candidate.hold);
    candidate.card.classList.remove('is-pressed', 'is-charging');
    candidate.card.style.removeProperty('--hold-ms');
    candidate = null;
  }

  // ------------------------------------------------------ open-time select
  //
  // A block's own tap selects it — the resize handles are the whole reason,
  // same as a card. A tall block's + button is a second, always-visible way
  // to the actions sheet (buffer/extend/add); a long press (touch) or
  // double-click (mouse) on the block is a third, mirroring how a card
  // offers its pencil icon *and* long-press/double-click into the same
  // editor. A thin block has no + — and no third way in either: it has only
  // the handles, on purpose, so there's nothing pulling a short gap's own
  // small tap target between "select it" and "open a menu on it".

  function onOpenTimePointerDown(event) {
    if (active || candidate || openTimeCandidate || event.button > 0) return;
    const block = event.target.closest('.open-time');
    if (!block) return;
    // Its own handles and + button run their own gestures.
    if (event.target.closest('button, .handle')) return;

    openTimeCandidate = {
      before: block.dataset.before,
      start: Number(block.dataset.start),
      end: Number(block.dataset.end),
      // A thin block has no + button, and no long-press/double-click
      // either — just the handles, its own tap only ever selects.
      thin: block.classList.contains('open-time--thin'),
      block,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      touch: event.pointerType !== 'mouse',
      longPress: null
    };

    if (openTimeCandidate.touch && !openTimeCandidate.thin) {
      const pressed = openTimeCandidate;
      pressed.longPress = setTimeout(() => {
        if (openTimeCandidate !== pressed) return;
        clearOpenTimeCandidate();
        suppressClickUntil = Date.now() + 700;
        onOpenTimeActivate?.(pressed.before, pressed.start, pressed.end);
      }, LONG_PRESS_MS);
    }
  }

  function onOpenTimePointerMove(event) {
    if (!openTimeCandidate || openTimeCandidate.pointerId !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - openTimeCandidate.x, event.clientY - openTimeCandidate.y);
    if (moved > LONG_PRESS_CANCEL || (!openTimeCandidate.touch && moved > TAP_SLOP)) clearOpenTimeCandidate();
  }

  function onOpenTimePointerUp(event) {
    if (!openTimeCandidate || openTimeCandidate.pointerId !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - openTimeCandidate.x, event.clientY - openTimeCandidate.y);
    const { before, start, end, touch, thin } = openTimeCandidate;
    clearOpenTimeCandidate();
    if (moved > TAP_SLOP) return;

    // A mouse only: touch's equivalent gesture is the long press above.
    if (!thin && !touch && onOpenTimeActivate && lastOpenTimeTap && lastOpenTimeTap.before === before && Date.now() - lastOpenTimeTap.time <= DOUBLE_TAP_MS) {
      lastOpenTimeTap = null;
      onOpenTimeActivate(before, start, end);
      return;
    }
    lastOpenTimeTap = (touch || thin) ? null : { before, time: Date.now() };

    // The select toggle itself is the delegated click that follows this
    // pointerup (data-action="select-open-time", app.js) — nothing more to
    // do here.
  }

  function clearOpenTimeCandidate() {
    if (!openTimeCandidate) return;
    clearTimeout(openTimeCandidate.longPress);
    openTimeCandidate = null;
  }

  // ---------------------------------------------------------------- resize

  function startResize(event, id, edge) {
    if (active || event.button > 0) return;
    const card = cardFor(id);
    if (!card) return;

    const item = scheduleOf(store.plan).items.find(entry => entry.id === id);
    if (!item) return;
    if (item.locked) return;

    event.preventDefault();
    event.stopPropagation();
    clearCandidate();

    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);

    active = {
      kind: 'resize',
      edge,
      id,
      card,
      handle,
      pointerId: event.pointerId,
      originY: event.clientY,
      item,
      // The value currently previewed, in minutes.
      value: edge === 'bottom' ? item.end : item.start,
      plan: store.plan,
      bubble: createBubble()
    };

    document.body.classList.add('is-resizing');
    card.classList.add('is-resizing');
    drawResize();

    handle.addEventListener('pointermove', onResizeMove);
    handle.addEventListener('pointerup', onResizeEnd, { once: true });
    handle.addEventListener('pointercancel', cancelGesture, { once: true });
  }

  function onResizeMove(event) {
    if (active?.kind !== 'resize' || active.pointerId !== event.pointerId) return;

    // One pixel of finger is one pixel of card, because the preview is drawn at
    // the same scale as the timeline.
    const deltaMinutes = Math.round((event.clientY - active.originY) / PX_PER_MIN / 5) * 5;
    const next = active.edge === 'bottom'
      ? clampEnd(active.item, deltaMinutes)
      : clampStart(active.item, deltaMinutes);

    if (next === active.value) return;
    active.value = next;
    schedulePaint(drawResize);
  }

  function clampEnd(item, deltaMinutes) {
    return Math.max(item.start + 5, Math.min(item.start + 720, item.end + deltaMinutes));
  }

  function clampStart(item, deltaMinutes) {
    return Math.max(0, Math.min(item.end - 5, item.start + deltaMinutes));
  }

  function previewPlanForResize() {
    const result = active.edge === 'bottom'
      ? resizeBottom(active.plan, active.id, active.value)
      : resizeTop(active.plan, active.id, active.value);
    return result ? result.plan : active.plan;
  }

  function drawResize() {
    if (active?.kind !== 'resize') return;
    const plan = previewPlanForResize();
    const layout = applyPreview(plan);

    const minutes = active.edge === 'bottom'
      ? active.value - active.item.start
      : active.item.end - active.value;
    active.bubble.textContent = active.edge === 'bottom'
      ? `Ends ${formatTime(active.value)} · ${formatDuration(minutes)}`
      : `Starts ${formatTime(active.value)} · ${formatDuration(minutes)}`;
    positionBubble(active.bubble, active.card, active.edge);
    markSnapLine(active.value, layout.from);
  }

  function onResizeEnd() {
    if (active?.kind !== 'resize') return;
    const { edge, id, value, item } = active;
    const unchanged = edge === 'bottom' ? value === item.end : value === item.start;
    finishGesture();

    // An open-time block's own handle leaves its selection exactly as a
    // card's own handle leaves selectedId: untouched. Dragged from either,
    // the thing it was dragged from stays selected once the drag ends.
    if (unchanged) return repaint(['timeline']);
    commit(edge === 'bottom' ? 'activity.resizeBottom' : 'activity.resizeTop',
      edge === 'bottom' ? { id, newEnd: value } : { id, newStart: value });
  }

  // ------------------------------------------------------------------ move

  /** Every id that should travel with this one: the group it belongs to, or just itself. */
  function groupFor(id) {
    const selection = store.ui.groupSelection;
    return selection.length > 1 && selection.includes(id) ? selection : [id];
  }

  /**
   * Lifts the card a press was already on. The press is the gesture's own
   * beginning, so the origin is where the finger first landed, not where it is
   * now — otherwise a mouse lift would silently swallow its first 3 px.
   *
   * Positions are kept in document space (`clientY + scrollY`). Viewport space
   * looks equivalent right up until autoscroll runs: the page moves under a
   * stationary finger, `clientY` never changes, and the card stays pinned to
   * the time it started at while the day slides past it.
   */
  function beginMove(pressed, clientY) {
    const { id, card, pointerId } = pressed;
    const item = scheduleOf(store.plan).items.find(entry => entry.id === id);
    if (!item || item.locked) return clearCandidate();

    clearCandidate();
    card.setPointerCapture(pointerId);
    // A tap is over: whatever happens now, it is not a click.
    suppressClickUntil = Date.now() + 700;

    active = {
      kind: 'move',
      id,
      ids: groupFor(id),
      card,
      handle: card,
      pointerId,
      originDocY: clientY + window.scrollY,
      pointerY: clientY,
      delta: 0,
      plan: store.plan,
      item,
      autoscroll: null,
      armedFor: 0,
      lastFrame: 0,
      // The line the card is dragged against: read once, because a move
      // never changes the day's visible range the way committing one can.
      from: Number(root.querySelector('.timeline-grid')?.dataset.from),
      bubble: createBubble()
    };

    document.body.classList.add('is-moving');
    card.classList.add('is-lifted');
    drawMove();

    card.addEventListener('pointermove', onMoveMove, { passive: false });
    card.addEventListener('pointerup', onMoveEnd, { once: true });
    card.addEventListener('pointercancel', cancelGesture, { once: true });
  }

  function onMoveMove(event) {
    if (active?.kind !== 'move' || active.pointerId !== event.pointerId) return;
    active.pointerY = event.clientY;
    const deltaMinutes = readDelta();
    runAutoscroll();
    if (deltaMinutes === active.delta) return;
    active.delta = deltaMinutes;
    schedulePaint(drawMove);
  }

  /** Where the card is now, in whole five-minute steps, measured in the document. */
  function readDelta() {
    const docY = active.pointerY + window.scrollY;
    return Math.round((docY - active.originDocY) / PX_PER_MIN / 5) * 5;
  }

  /** How deep the pointer is into an autoscroll edge, and which way. */
  function autoscrollEdge() {
    const fine = matchMedia('(pointer: fine)').matches;
    const zone = fine
      ? AUTOSCROLL_ZONE_FINE
      : Math.min(AUTOSCROLL_ZONE_MAX,
        Math.max(AUTOSCROLL_ZONE_MIN, window.innerHeight * AUTOSCROLL_ZONE_RATIO));
    // A thumb naturally rests low on a phone, so a bottom zone as deep as the
    // top one would be triggered just by holding the card comfortably.
    const bottomZone = fine ? zone : Math.min(AUTOSCROLL_ZONE_BOTTOM_TOUCH, zone);

    const fromTop = active.pointerY;
    const fromBottom = window.innerHeight - active.pointerY;
    if (fromTop < zone) return { way: -1, depth: (zone - fromTop) / zone };
    if (fromBottom < bottomZone) return { way: 1, depth: (bottomZone - fromBottom) / bottomZone };
    return { way: 0, depth: 0 };
  }

  /**
   * Speed rises with the square of how far past the boundary the pointer is,
   * so the edge of the zone is a creep slow enough to hold a position on and
   * the far corner crosses the day in a few seconds. It also eases in over
   * AUTOSCROLL_RAMP_MS, so entering the zone accelerates rather than jolting,
   * and it is scaled by elapsed time rather than counted per frame, so it runs
   * at the same speed on a 120 Hz screen as on a 60 Hz one.
   */
  function runAutoscroll() {
    if (autoscrollEdge().way === 0) {
      if (active.autoscroll) cancelAnimationFrame(active.autoscroll);
      active.autoscroll = null;
      active.armedFor = 0;
      active.lastFrame = 0;
      return;
    }
    if (active.autoscroll) return;

    active.lastFrame = 0;
    const step = now => {
      if (active?.kind !== 'move') return;
      const { way, depth } = autoscrollEdge();
      if (!way) {
        active.autoscroll = null;
        active.armedFor = 0;
        active.lastFrame = 0;
        return;
      }
      // The first frame has no elapsed time to measure yet, so it scrolls
      // nothing and only starts the clock.
      if (!active.lastFrame) active.lastFrame = now;
      const seconds = Math.min(0.05, (now - active.lastFrame) / 1000);
      active.lastFrame = now;
      active.armedFor += seconds * 1000;

      const ramp = Math.min(1, active.armedFor / AUTOSCROLL_RAMP_MS);
      const speed = (AUTOSCROLL_MIN + (AUTOSCROLL_MAX - AUTOSCROLL_MIN) * depth * depth) * ramp;

      const before = window.scrollY;
      window.scrollBy(0, way * speed * seconds);
      // Scrolling alone moves the card, because the origin is in document
      // space — the finger does not have to keep moving for the drag to travel.
      if (window.scrollY !== before) {
        const deltaMinutes = readDelta();
        if (deltaMinutes !== active.delta) {
          active.delta = deltaMinutes;
          drawMove();
        }
      }
      active.autoscroll = requestAnimationFrame(step);
    };
    active.autoscroll = requestAnimationFrame(step);
  }

  /**
   * The dragged card follows the pointer exactly, the same treatment a
   * resize edge gets — no lag, no relayout of anything else while the
   * gesture is live. A group move carries its other unlocked members by the
   * same delta, eased (`.is-settling`) rather than snapping with it, so the
   * hand reads as being on one card even though several are moving.
   *
   * Nothing outside the dragged group previews at all: what the drop would
   * do to an unrelated card's lane is shown once, on commit, not guessed at
   * every frame.
   */
  function drawMove() {
    if (active?.kind !== 'move') return;
    const offset = active.delta * PX_PER_MIN;

    // `.is-lifted` already carries the rotate/scale/shadow; only the offset
    // is driven from here, so the two never fight over `transform`.
    active.card.style.setProperty('--drag-y', `${offset}px`);

    for (const id of active.ids) {
      if (id === active.id) continue;
      const other = cardFor(id);
      if (!other) continue;
      other.classList.add('is-settling');
      other.style.transform = `translateY(${offset}px)`;
    }

    const newStart = active.item.start + active.delta;
    const clashMinutes = drawClash();

    active.bubble.classList.toggle('is-bad', clashMinutes > 0);
    active.card.classList.toggle('is-clash', clashMinutes > 0);
    // A snap line answers "where", which is only half the question. When the
    // drop would collide, the readout answers "should you" instead.
    active.bubble.textContent = clashMinutes > 0
      ? `Overlaps ${formatDuration(clashMinutes)}`
      : active.ids.length > 1
        ? `Starts ${formatTime(newStart)} · ${active.ids.length} activities`
        : `Starts ${formatTime(newStart)}`;
    positionBubble(active.bubble, active.card, 'top');
    if (Number.isFinite(active.from)) markSnapLine(newStart, active.from, clashMinutes > 0);
  }

  /**
   * Shows what the drop would collide with while the card is still in the air,
   * so an overlap is something you steer around rather than discover afterwards.
   * Both sides of the collision get the outline every overlapping card already
   * wears, and only the exact colliding minutes are hatched — the same
   * treatment `renderCard` draws, reused rather than reinvented, so the preview
   * and the committed state are the same picture.
   *
   * Every exit from a move repaints the timeline, so nothing here is undone by
   * hand: the next paint is the reset.
   */
  function drawClash() {
    const moved = active.ids.length > 1
      ? moveGroup(active.plan, active.ids, active.delta)
      : moveTo(active.plan, active.id, active.item.start + active.delta);
    const schedule = scheduleOf(moved ? moved.plan : active.plan);

    const involved = new Map();
    let total = 0;
    for (const id of active.ids) {
      const entry = schedule.items.find(candidateItem => candidateItem.id === id);
      if (!entry?.overlaps?.length) continue;
      total += entry.overlapMinutes;
      involved.set(id, entry);
      for (const overlap of entry.overlaps) {
        const other = schedule.items.find(candidateItem => candidateItem.id === overlap.withId);
        if (other) involved.set(other.id, other);
      }
    }

    for (const card of root.querySelectorAll('.card')) {
      const entry = involved.get(card.dataset.activityId);
      card.classList.toggle('is-overlap', Boolean(entry));
      const box = entry ? overlapBox(entry) : null;
      if (box) {
        card.style.setProperty('--overlap-top', `${box.top}px`);
        card.style.setProperty('--overlap-height', `${box.height}px`);
      }
    }
    return total;
  }

  function onMoveEnd() {
    if (active?.kind !== 'move') return;
    const { id, ids, delta, item } = active;
    finishGesture();

    if (!delta) return repaint(['timeline']);
    if (ids.length > 1) commit('activity.moveGroup', { ids, deltaMinutes: delta });
    else commit('activity.moveTo', { id, start: item.start + delta });
  }

  // ---------------------------------------------------------------- shared

  /**
   * Draws a plan without changing it. Positions are written directly so the
   * preview is exactly the geometry that will be committed.
   */
  function applyPreview(plan) {
    const schedule = scheduleOf(plan);
    const layout = buildLayout(plan, schedule);

    const grid = root.querySelector('.timeline-grid');
    if (grid) grid.style.height = `${layout.height + 48}px`;

    for (const entry of layout.cards) {
      const card = cardFor(entry.item.id);
      if (!card) continue;

      const heightChanged = card.style.height !== `${entry.height}px`;
      card.style.top = `${entry.top}px`;
      card.style.height = `${entry.height}px`;
      applyLaneStyle(card, entry.lane, entry.totalLanes);

      const time = card.querySelector('.card-time span');
      const duration = card.querySelector('.card-time strong');
      if (time) time.textContent = entry.item.rangeLabel;
      if (duration) duration.textContent = formatDuration(entry.item.duration);

      // A card's height is its duration, and what it can show follows from its
      // height — so a card being resized has to re-fit as it goes. Without
      // this, dragging an hour down to a quarter of one left the people, the
      // location and the stage tag sliced off mid-row behind the body's
      // `overflow: hidden` until the finger came up, which is the one moment
      // in the app when density is visibly changing and the card was the last
      // to know.
      if (heightChanged) refit(card);
    }

    const end = root.querySelector('.timeline-end');
    if (end) end.style.top = `${layout.endTop + 10}px`;

    // An open-time block's own top/bottom edges move with whichever
    // neighbour is being resized — otherwise it (and the handle riding on
    // it) sits frozen at its pre-drag position while the card beside it
    // visibly grows or shrinks, coming loose from the edge it's dragging.
    for (const gap of layout.openTimes) {
      const block = root.querySelector(`.open-time[data-before="${cssEscape(gap.beforeId)}"]`);
      if (!block) continue;
      block.style.top = `${gap.top}px`;
      block.style.height = `${gap.height}px`;
      const strong = block.querySelector('strong');
      if (strong) strong.textContent = `${formatDuration(gap.minutes)} open`;
    }
    return layout;
  }

  /** The five-minute line being snapped to turns blue — or red, if landing there collides. */
  function markSnapLine(minute, from, bad = false) {
    clearSnapLine();
    const top = (minute - from) * PX_PER_MIN;
    const tick = [...root.querySelectorAll('.tick')]
      .find(node => Math.abs(parseFloat(node.style.top) - top) < 0.5);
    if (!tick) return;
    tick.classList.add('tick--snap');
    tick.classList.toggle('tick--snap-bad', bad);
    tick.dataset.previousLabel = tick.querySelector('b')?.textContent ?? '';
    let label = tick.querySelector('b');
    if (!label) {
      label = document.createElement('b');
      tick.append(label);
      tick.dataset.labelAdded = 'true';
    }
    label.textContent = formatTime(minute, { meridiem: false });
  }

  function clearSnapLine() {
    for (const tick of root.querySelectorAll('.tick--snap')) {
      tick.classList.remove('tick--snap', 'tick--snap-bad');
      const label = tick.querySelector('b');
      if (tick.dataset.labelAdded === 'true') label?.remove();
      else if (label) label.textContent = tick.dataset.previousLabel ?? '';
      delete tick.dataset.labelAdded;
      delete tick.dataset.previousLabel;
    }
  }

  function createBubble() {
    const bubble = document.createElement('div');
    bubble.className = 'resize-bubble';
    document.body.append(bubble);
    return bubble;
  }

  function positionBubble(bubble, card, edge) {
    const rect = card.getBoundingClientRect();
    bubble.style.left = `${Math.max(12, rect.left)}px`;
    bubble.style.top = edge === 'bottom' ? `${rect.bottom + 8}px` : `${rect.top - 40}px`;
  }

  function finishGesture() {
    cancelPaint();
    clearSnapLine();
    if (!active) return;

    if (active.kind === 'resize') {
      active.bubble.remove();
      active.card.classList.remove('is-resizing');
      active.handle.removeEventListener('pointermove', onResizeMove);
      document.body.classList.remove('is-resizing');
    }
    if (active.kind === 'move') {
      if (active.autoscroll) cancelAnimationFrame(active.autoscroll);
      active.bubble.remove();
      active.card.classList.remove('is-lifted', 'is-clash');
      active.handle.removeEventListener('pointermove', onMoveMove);
      document.body.classList.remove('is-moving');
    }
    for (const card of root.querySelectorAll('.card')) {
      card.style.transform = '';
      card.style.removeProperty('--drag-y');
      card.style.visibility = '';
      card.classList.remove('is-settling');
    }
    active = null;
  }

  function cancelGesture() {
    if (!active) return;
    finishGesture();
    // Esc and a cancelled touch put everything back exactly as it was.
    repaint(['timeline']);
  }

  // ----------------------------------------------------------------- wiring

  root.addEventListener('pointerdown', onCardPointerDown);
  root.addEventListener('pointermove', onCardPointerMove);
  root.addEventListener('pointerup', onCardPointerUp);
  root.addEventListener('pointercancel', clearCandidate);
  root.addEventListener('pointerdown', onOpenTimePointerDown);
  root.addEventListener('pointermove', onOpenTimePointerMove);
  root.addEventListener('pointerup', onOpenTimePointerUp);
  root.addEventListener('pointercancel', clearOpenTimeCandidate);
  /**
   * A pointer event's preventDefault cannot stop a scroll; only the touchmove
   * underneath it can. Cards are `touch-action: pan-y`, so once one has been
   * lifted the pan has to be refused here — otherwise the browser takes the
   * same finger as a scroll, the day slides out from under the drag, and the
   * pointer is cancelled mid-gesture.
   *
   * It is safe to refuse it only because a lift requires stillness: the first
   * touchmove of a gesture that has already lifted arrives before any pan has
   * begun, which is the one moment the browser still honours this.
   */
  root.addEventListener('touchmove', event => {
    if (active) event.preventDefault();
  }, { passive: false });
  window.addEventListener('scroll', onScrollDuringPress, { passive: true });
  // An open-time press has no lift to survive a glide for, so a scroll still
  // ends it outright.
  window.addEventListener('scroll', clearOpenTimeCandidate, { passive: true });

  return {
    /** Re-attached after every timeline repaint; handles are recreated each time. */
    bind() {
      for (const handle of root.querySelectorAll('[data-role="resize"]')) {
        handle.addEventListener('pointerdown', event => startResize(event, handle.dataset.id, 'bottom'));
      }
      for (const handle of root.querySelectorAll('[data-role="resize-top"]')) {
        handle.addEventListener('pointerdown', event => startResize(event, handle.dataset.id, 'top'));
      }
    },
    get active() { return Boolean(active); },
    /** True while a long press has just fired, so the click it causes is ignored. */
    get suppressingClick() { return Date.now() < suppressClickUntil; },
    cancel: cancelGesture
  };
}
