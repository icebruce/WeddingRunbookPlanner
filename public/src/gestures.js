/**
 * Direct manipulation: select, long-press, resize and drag.
 *
 * The rule that shapes all of it: a swipe that starts anywhere on a card
 * scrolls the day. Cards carry `touch-action: pan-y` and nothing here calls
 * preventDefault before a gesture has actually begun, so the browser is free to
 * take the touch as a scroll. Only the handles and the grip — which is always
 * visible, left edge only — opt out with `touch-action: none`.
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
import { PX_PER_MIN, applyLaneStyle, buildLayout } from './layout.js';
import { buildSchedule, formatDuration, formatTime } from './schedule.js';
import { resizeBottom, resizeTop } from './operations.js';
import { cssEscape } from './dom.js';

/** Movement thresholds, in CSS pixels. */
const TAP_SLOP = 6;
const LONG_PRESS_CANCEL = 10;
const LONG_PRESS_MS = 500;
const MOVE_HOLD_MS = 150;
const AUTOSCROLL_EDGE = 64;
const AUTOSCROLL_STEP = 12;
/** How close together two taps on the same card have to land to count as a double-click. */
const DOUBLE_TAP_MS = 400;

export function createGestures({ root, store, commit, repaint, onLongPress, onDoubleClick }) {
  /** The one gesture in progress, if any. */
  let active = null;
  /** A press that has not yet become a tap, a long press or a scroll. */
  let candidate = null;
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
    // candidate while its long-press timer was still armed, and the timer read
    // whatever `candidate` had become — so two fingers opened the editor for
    // the wrong card and left the first one looking pressed for good.
    if (active || candidate || event.button > 0) return;
    const card = event.target.closest('.card');
    if (!card) return;
    // Controls and handles run their own gestures.
    if (event.target.closest('button, .handle, .card-grip, .stage-menu')) return;

    const id = card.dataset.activityId;
    card.classList.add('is-pressed');

    candidate = {
      id,
      card,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      touch: event.pointerType !== 'mouse',
      groupPick: event.ctrlKey || event.metaKey,
      longPress: null
    };

    // A long press opens the editor. It is the phone's alternative to
    // double-click, and it is cancelled by any movement that looks like a
    // scroll — which is why the pressed state appears at once but nothing is
    // committed until the timer fires.
    if (candidate.touch) {
      // The press this timer belongs to, captured rather than read back: by
      // the time it fires, `candidate` may be somebody else's.
      const pressed = candidate;
      pressed.longPress = setTimeout(() => {
        if (candidate !== pressed) return;
        clearCandidate();
        suppressClickUntil = Date.now() + 700;
        onLongPress?.(pressed.id);
      }, LONG_PRESS_MS);
    }
  }

  function onCardPointerMove(event) {
    if (!candidate || candidate.pointerId !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y);
    if (moved > LONG_PRESS_CANCEL || (!candidate.touch && moved > TAP_SLOP)) clearCandidate();
  }

  function onCardPointerUp(event) {
    if (!candidate || candidate.pointerId !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y);
    const { id, touch, groupPick } = candidate;
    clearCandidate();
    if (moved > TAP_SLOP) return;

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

    // A mouse only: touch's equivalent gesture is the long press above.
    if (!touch && onDoubleClick && lastTap && lastTap.id === id && Date.now() - lastTap.time <= DOUBLE_TAP_MS) {
      lastTap = null;
      onDoubleClick(id);
      return;
    }
    lastTap = touch ? null : { id, time: Date.now() };

    store.setUi({ selectedId: id, groupSelection: [], openMenu: null }, { regions: ['timeline', 'toolbar'] });
  }

  function clearCandidate() {
    if (!candidate) return;
    clearTimeout(candidate.longPress);
    candidate.card.classList.remove('is-pressed');
    candidate = null;
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
    const { edge, id, value, item, handle } = active;
    const unchanged = edge === 'bottom' ? value === item.end : value === item.start;
    // Dragged from an open-time block's own handle rather than the
    // resized activity's: its selection (which is only what revealed the
    // handle in the first place) has done its job and would otherwise sit
    // highlighted, with a handle still showing, on a gap that has since
    // moved or closed under it.
    const fromOpenTime = Boolean(handle.closest('.open-time'));
    // Whatever is still focused inside the block — its own tabindex="0"
    // body, most likely, not the handle: startResize's preventDefault on
    // pointerdown suppresses the focus a mousedown would otherwise give the
    // handle, so focus never actually left wherever selecting the block put
    // it. paint() (dom.js) restores focus by key across every repaint, so
    // left alone this keeps re-focusing the block on its own `open-time:id`
    // key forever, and `:focus-within` (timeline.css) keeps its handle
    // looking revealed for as long as that holds.
    if (fromOpenTime) document.activeElement?.closest('.open-time')?.blur();
    finishGesture();

    if (unchanged) {
      if (fromOpenTime) store.setUi({ selectedOpenTime: null }, { regions: ['timeline'] });
      else repaint(['timeline']);
      return;
    }
    commit(edge === 'bottom' ? 'activity.resizeBottom' : 'activity.resizeTop',
      edge === 'bottom' ? { id, newEnd: value } : { id, newStart: value });
    if (fromOpenTime) store.setUi({ selectedOpenTime: null }, { regions: ['timeline'] });
  }

  // ------------------------------------------------------------------ move

  /** Every id that should travel with this one: the group it belongs to, or just itself. */
  function groupFor(id) {
    const selection = store.ui.groupSelection;
    return selection.length > 1 && selection.includes(id) ? selection : [id];
  }

  function startMove(event, id, { hold }) {
    if (active || event.button > 0) return;
    const card = cardFor(id);
    if (!card) return;

    const item = scheduleOf(store.plan).items.find(entry => entry.id === id);
    if (!item || item.locked) return;

    event.preventDefault();
    event.stopPropagation();
    clearCandidate();

    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);

    const ids = groupFor(id);

    const begin = () => {
      active = {
        kind: 'move',
        id,
        ids,
        card,
        handle,
        pointerId: event.pointerId,
        originY: event.clientY,
        delta: 0,
        plan: store.plan,
        item,
        // The line the card is dragged against: read once, because a move
        // never changes the day's visible range the way committing one can.
        from: Number(root.querySelector('.timeline-grid')?.dataset.from),
        bubble: createBubble()
      };
      document.body.classList.add('is-moving');
      card.classList.add('is-lifted');
      drawMove();
    };

    if (hold) {
      // A short hold before the card lifts, so a finger resting on the grip
      // while scrolling does not start a drag (D23). The hold has to be still:
      // moving before it completes means this was a scroll, not a drag, and
      // the timer is abandoned.
      const origin = { x: event.clientX, y: event.clientY };
      let timer = null;

      const abort = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        handle.removeEventListener('pointermove', watch);
        handle.removeEventListener('pointerup', abort);
        handle.removeEventListener('pointercancel', abort);
      };
      const watch = moveEvent => {
        if (!timer) return;
        if (Math.hypot(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y) > LONG_PRESS_CANCEL) abort();
      };

      timer = setTimeout(() => {
        timer = null;
        handle.removeEventListener('pointermove', watch);
        begin();
      }, MOVE_HOLD_MS);

      handle.addEventListener('pointermove', watch);
      handle.addEventListener('pointerup', abort);
      handle.addEventListener('pointercancel', abort);
    } else {
      begin();
    }

    handle.addEventListener('pointermove', onMoveMove);
    handle.addEventListener('pointerup', onMoveEnd, { once: true });
    handle.addEventListener('pointercancel', cancelGesture, { once: true });
  }

  function onMoveMove(event) {
    if (active?.kind !== 'move' || active.pointerId !== event.pointerId) return;
    active.pointerY = event.clientY;
    const deltaMinutes = Math.round((event.clientY - active.originY) / PX_PER_MIN / 5) * 5;
    if (deltaMinutes === active.delta) { runAutoscroll(); return; }
    active.delta = deltaMinutes;
    runAutoscroll();
    schedulePaint(drawMove);
  }

  function runAutoscroll() {
    const distanceTop = active.pointerY;
    const distanceBottom = window.innerHeight - active.pointerY;
    const direction = distanceTop < AUTOSCROLL_EDGE ? -1 : distanceBottom < AUTOSCROLL_EDGE ? 1 : 0;

    if (!direction) {
      if (active.autoscroll) {
        cancelAnimationFrame(active.autoscroll);
        active.autoscroll = null;
      }
      return;
    }
    if (active.autoscroll) return;

    const step = () => {
      if (active?.kind !== 'move') return;
      const top = active.pointerY;
      const bottom = window.innerHeight - active.pointerY;
      const way = top < AUTOSCROLL_EDGE ? -1 : bottom < AUTOSCROLL_EDGE ? 1 : 0;
      if (!way) {
        active.autoscroll = null;
        return;
      }
      window.scrollBy(0, way * AUTOSCROLL_STEP);
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
    active.bubble.textContent = active.ids.length > 1
      ? `Starts ${formatTime(newStart)} · ${active.ids.length} activities`
      : `Starts ${formatTime(newStart)}`;
    positionBubble(active.bubble, active.card, 'top');
    if (Number.isFinite(active.from)) markSnapLine(newStart, active.from);
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

      card.style.top = `${entry.top}px`;
      card.style.height = `${entry.height}px`;
      applyLaneStyle(card, entry.lane, entry.totalLanes);

      const time = card.querySelector('.card-time span');
      const duration = card.querySelector('.card-time strong');
      if (time) time.textContent = entry.item.rangeLabel;
      if (duration) duration.textContent = formatDuration(entry.item.duration);
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

  /** The five-minute line being snapped to turns blue and shows its time. */
  function markSnapLine(minute, from) {
    clearSnapLine();
    const top = (minute - from) * PX_PER_MIN;
    const tick = [...root.querySelectorAll('.tick')]
      .find(node => Math.abs(parseFloat(node.style.top) - top) < 0.5);
    if (!tick) return;
    tick.classList.add('tick--snap');
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
      tick.classList.remove('tick--snap');
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
      active.card.classList.remove('is-lifted');
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
  // A scroll anywhere means this was never a press.
  window.addEventListener('scroll', clearCandidate, { passive: true });

  return {
    /** Re-attached after every timeline repaint; handles are recreated each time. */
    bind() {
      for (const handle of root.querySelectorAll('[data-role="resize"]')) {
        handle.addEventListener('pointerdown', event => startResize(event, handle.dataset.id, 'bottom'));
      }
      for (const handle of root.querySelectorAll('[data-role="resize-top"]')) {
        handle.addEventListener('pointerdown', event => startResize(event, handle.dataset.id, 'top'));
      }
      // A mouse on the grip drags at once; a finger on the grip holds first.
      for (const grip of root.querySelectorAll('.card-grip[data-role="move"]')) {
        grip.addEventListener('pointerdown', event => startMove(event, grip.dataset.id, { hold: event.pointerType !== 'mouse' }));
      }
    },
    get active() { return Boolean(active); },
    /** True while a long press has just fired, so the click it causes is ignored. */
    get suppressingClick() { return Date.now() < suppressClickUntil; },
    cancel: cancelGesture
  };
}
