/**
 * Pointer gestures: reorder by grip, resize by the bottom handle.
 *
 * Still the pre-redesign behaviour, moved onto the time-true geometry so the
 * preview matches what will be committed. Top-edge resizing, long-press,
 * touch reordering and the snap label belong to the direct manipulation stage,
 * which replaces this file.
 */
import { buildLayout } from './layout.js';
import { buildSchedule, formatDuration } from './schedule.js';
import { resizeBottom } from './operations.js';
import { cssEscape } from './dom.js';

export function createGestures({ root, store, commit, repaint }) {
  let drag = null;
  let resize = null;

  const cardFor = id => root.querySelector(`.card[data-activity-id="${cssEscape(id)}"]`);

  function startDrag(event, id) {
    if (event.button !== 0) return;
    event.preventDefault();

    const card = cardFor(id);
    if (!card) return;
    const fromIndex = Number(card.dataset.index);
    store.setUi({ selectedId: id, openMenu: null }, { regions: ['timeline'] });

    const rect = card.getBoundingClientRect();
    const clone = card.cloneNode(true);
    clone.classList.add('is-lifted');
    clone.style.position = 'fixed';
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.left = `${rect.left}px`;
    clone.style.top = `${rect.top}px`;
    clone.style.zIndex = '90';
    clone.setAttribute('aria-hidden', 'true');
    clone.querySelectorAll('button').forEach(button => { button.tabIndex = -1; });
    document.body.append(clone);

    card.classList.add('is-drag-source');
    const handle = event.currentTarget;
    drag = { pointerId: event.pointerId, id, card, clone, fromIndex, offsetY: event.clientY - rect.top, slot: fromIndex, moved: false, handle };
    handle.setPointerCapture(event.pointerId);
    handle.addEventListener('pointermove', moveDrag);
    handle.addEventListener('pointerup', endDrag, { once: true });
    handle.addEventListener('pointercancel', cancelDrag, { once: true });
    document.body.classList.add('is-reordering');
  }

  function moveDrag(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.moved = true;
    drag.clone.style.top = `${event.clientY - drag.offsetY}px`;

    const others = [...root.querySelectorAll('.card')].filter(card => card !== drag.card);
    others.forEach(card => card.classList.remove('is-drop-before', 'is-drop-after'));

    let slot = others.length;
    for (let i = 0; i < others.length; i += 1) {
      const rect = others[i].getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        slot = i;
        break;
      }
    }
    drag.slot = slot;
    if (!others.length) return;
    if (slot < others.length) others[slot].classList.add('is-drop-before');
    else others[others.length - 1].classList.add('is-drop-after');
  }

  function cleanupDrag() {
    if (!drag) return;
    root.querySelectorAll('.is-drop-before, .is-drop-after').forEach(card => card.classList.remove('is-drop-before', 'is-drop-after'));
    drag.clone.remove();
    drag.card.classList.remove('is-drag-source');
    drag.handle.removeEventListener('pointermove', moveDrag);
    document.body.classList.remove('is-reordering');
    drag = null;
  }

  function endDrag() {
    if (!drag) return;
    const { id, slot, moved } = drag;
    cleanupDrag();
    // Dropping a card back where it started is not a change, so it is not saved.
    if (moved) commit('activity.move', { id, toIndex: slot });
    else repaint(['timeline']);
  }

  function cancelDrag() {
    cleanupDrag();
    repaint(['timeline']);
  }

  function startResize(event, id) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const card = cardFor(id);
    if (!card) return;
    const item = buildSchedule(store.plan).items.find(entry => entry.id === id);

    const bubble = document.createElement('div');
    bubble.className = 'resize-bubble';
    document.body.append(bubble);

    card.classList.add('is-resizing');
    resize = {
      pointerId: event.pointerId,
      id,
      card,
      handle: event.currentTarget,
      startY: event.clientY,
      start: item.start,
      startEnd: item.end,
      nextEnd: item.end,
      bubble
    };
    paintBubble();

    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.addEventListener('pointermove', moveResize);
    event.currentTarget.addEventListener('pointerup', endResize, { once: true });
    event.currentTarget.addEventListener('pointercancel', cancelResize, { once: true });
  }

  function paintBubble() {
    if (!resize) return;
    const minutes = resize.nextEnd - resize.start;
    resize.bubble.textContent = `Ends ${formatEnd(resize.nextEnd)} · ${formatDuration(minutes)}`;
    const rect = resize.card.getBoundingClientRect();
    resize.bubble.style.left = `${rect.right - 150}px`;
    resize.bubble.style.top = `${rect.bottom + 6}px`;
  }

  function formatEnd(minutes) {
    const wrapped = ((minutes % 1440) + 1440) % 1440;
    const hours = Math.floor(wrapped / 60);
    return `${hours % 12 || 12}:${String(wrapped % 60).padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`;
  }

  /**
   * The edge follows the pointer one-to-one, because the preview uses the same
   * scale the timeline is drawn at. The old code mapped 8 px to five minutes
   * against a 13 px rendering, so the edge ran 1.63 times the finger (F7).
   */
  function moveResize(event) {
    if (!resize || resize.pointerId !== event.pointerId) return;

    const deltaMinutes = Math.round((event.clientY - resize.startY) / 4 / 5) * 5;
    const nextEnd = Math.max(resize.start + 5, Math.min(resize.start + 720, resize.startEnd + deltaMinutes));
    if (nextEnd === resize.nextEnd) return;
    resize.nextEnd = nextEnd;

    // Preview only: the plan changes on release.
    const result = resizeBottom(store.plan, resize.id, nextEnd);
    const preview = result ? result.plan : store.plan;
    applyPreview(preview);
    paintBubble();
  }

  function applyPreview(plan) {
    const schedule = buildSchedule(plan);
    const layout = buildLayout(plan, schedule);

    const grid = root.querySelector('.timeline-grid');
    if (grid) grid.style.height = `${layout.height + 48}px`;

    for (const entry of layout.cards) {
      const card = cardFor(entry.item.id);
      if (!card) continue;
      card.style.top = `${entry.top}px`;
      card.style.height = `${entry.height}px`;
      const time = card.querySelector('.card-time span');
      const duration = card.querySelector('.card-time strong');
      if (time) time.textContent = entry.item.rangeLabel;
      if (duration) duration.textContent = formatDuration(entry.item.duration);
    }

    const end = root.querySelector('.timeline-end');
    if (end) end.style.top = `${layout.endTop + 10}px`;
  }

  function cleanupResize() {
    if (!resize) return;
    resize.card.classList.remove('is-resizing');
    resize.bubble.remove();
    resize.handle.removeEventListener('pointermove', moveResize);
    resize = null;
  }

  function endResize() {
    if (!resize) return;
    const { id, nextEnd, startEnd } = resize;
    cleanupResize();
    if (nextEnd !== startEnd) commit('activity.resizeBottom', { id, newEnd: nextEnd });
    else repaint(['timeline']);
  }

  function cancelResize() {
    cleanupResize();
    repaint(['timeline']);
  }

  return {
    /** Attached after every timeline repaint; the handles are recreated each time. */
    bind() {
      root.querySelectorAll('[data-role="reorder"]').forEach(handle => {
        handle.addEventListener('pointerdown', event => startDrag(event, handle.dataset.id));
      });
      root.querySelectorAll('[data-role="resize"]').forEach(handle => {
        handle.addEventListener('pointerdown', event => startResize(event, handle.dataset.id));
      });
    },
    get active() { return Boolean(drag || resize); },
    cancel() {
      if (drag) cancelDrag();
      if (resize) cancelResize();
    }
  };
}
