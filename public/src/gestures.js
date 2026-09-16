/**
 * Pointer gestures: reorder by grip, resize by the bottom handle.
 *
 * This is the pre-redesign behaviour moved into one module so the direct
 * manipulation stage has a single file to replace. It still uses the old
 * scale and the drop placeholder; both go when the time-true grid lands.
 */
import { buildSchedule, buildTimelineLayout, formatDuration } from './schedule.js';
import { cssEscape } from './dom.js';
import { timeScale } from './render/timeline.js';

export function createGestures({ root, store, commit, repaint }) {
  let drag = null;
  let resize = null;

  function rowFor(id) {
    return root.querySelector(`.activity-row[data-activity-id="${cssEscape(id)}"]`);
  }

  function startDrag(event, id) {
    if (event.button !== 0) return;
    const handle = event.currentTarget;
    if (handle.disabled) return;
    event.preventDefault();

    const row = rowFor(id);
    const card = row.querySelector('.activity-card');
    const fromIndex = Number(row.dataset.index);
    store.setUi({ selectedId: id, openMenu: null }, { regions: ['timeline'] });

    const rect = card.getBoundingClientRect();
    const clone = card.cloneNode(true);
    clone.classList.add('drag-floating');
    clone.style.width = `${rect.width}px`;
    clone.style.height = `${rect.height}px`;
    clone.style.left = `${rect.left}px`;
    clone.style.top = `${rect.top}px`;
    clone.setAttribute('aria-hidden', 'true');
    clone.querySelectorAll('button').forEach(button => { button.tabIndex = -1; });
    document.body.append(clone);

    row.classList.add('is-drag-source');
    drag = { pointerId: event.pointerId, id, row, card, clone, fromIndex, offsetY: event.clientY - rect.top, slot: fromIndex, moved: false, handle };
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

    const rows = [...root.querySelectorAll('.activity-row')].filter(row => row !== drag.row);
    rows.forEach(row => row.classList.remove('is-drop-before', 'is-drop-after'));

    let slot = rows.length;
    for (let i = 0; i < rows.length; i += 1) {
      const rect = rows[i].getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        slot = i;
        break;
      }
    }
    drag.slot = slot;
    if (!rows.length) return;
    if (slot < rows.length) rows[slot].classList.add('is-drop-before');
    else rows[rows.length - 1].classList.add('is-drop-after');
  }

  function cleanupDrag() {
    if (!drag) return;
    root.querySelectorAll('.is-drop-before, .is-drop-after').forEach(row => row.classList.remove('is-drop-before', 'is-drop-after'));
    drag.clone.remove();
    drag.row.classList.remove('is-drag-source');
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

    const handle = event.currentTarget;
    const row = rowFor(id);
    const card = row.querySelector('.activity-card');
    const activity = store.plan.activities.find(item => item.id === id);

    const tooltip = document.createElement('div');
    tooltip.className = 'resize-tooltip';
    tooltip.textContent = formatDuration(activity.duration);
    document.body.append(tooltip);

    card.classList.add('is-resizing');
    resize = { pointerId: event.pointerId, id, card, handle, startY: event.clientY, startDuration: activity.duration, nextDuration: activity.duration, tooltip };
    positionTooltip();

    handle.setPointerCapture(event.pointerId);
    handle.addEventListener('pointermove', moveResize);
    handle.addEventListener('pointerup', endResize, { once: true });
    handle.addEventListener('pointercancel', cancelResize, { once: true });
  }

  function positionTooltip() {
    if (!resize) return;
    const rect = resize.card.getBoundingClientRect();
    resize.tooltip.style.left = `${rect.right - 70}px`;
    resize.tooltip.style.top = `${rect.bottom - 10}px`;
  }

  function moveResize(event) {
    if (!resize || resize.pointerId !== event.pointerId) return;
    const deltaMinutes = Math.round((event.clientY - resize.startY) / 8) * 5;
    const next = Math.min(720, Math.max(5, resize.startDuration + deltaMinutes));
    resize.nextDuration = next;

    // Preview without changing the plan: the data only moves on release.
    const preview = structuredClone(store.plan);
    preview.activities.find(activity => activity.id === resize.id).duration = next;
    const schedule = buildSchedule(preview);
    const scale = timeScale(preview, schedule);
    const layout = buildTimelineLayout(schedule, { scaleStart: scale.start, minutePx: scale.minutePx });

    const canvas = root.querySelector('#activity-list');
    if (canvas) canvas.style.height = `${Math.max(scale.height, layout.height).toFixed(1)}px`;

    for (const visual of layout.rows) {
      const row = rowFor(visual.item.id);
      if (!row) continue;
      row.style.setProperty('--row-top', `${visual.top.toFixed(1)}px`);
      row.style.setProperty('--row-height', `${visual.height.toFixed(1)}px`);
      row.dataset.anchorTop = visual.anchorTop.toFixed(1);
      row.classList.toggle('activity-row--shifted', visual.offset > 1);
      row.querySelector('.activity-card')?.classList.toggle('activity-card--compact', visual.item.duration < 30);
      const range = row.querySelector('.card-time-range');
      const duration = row.querySelector('.card-time strong');
      if (range) range.textContent = `${visual.item.startLabel} – ${visual.item.endLabel}`;
      if (duration) duration.textContent = formatDuration(visual.item.duration);
    }

    const endMarker = root.querySelector('.end-marker');
    if (endMarker) endMarker.style.top = `${layout.endTop.toFixed(1)}px`;
    resize.tooltip.textContent = formatDuration(next);
    positionTooltip();
  }

  function cleanupResize() {
    if (!resize) return;
    resize.card.classList.remove('is-resizing');
    resize.tooltip.remove();
    resize.handle.removeEventListener('pointermove', moveResize);
    resize = null;
  }

  function endResize() {
    if (!resize) return;
    const { id, nextDuration, startDuration } = resize;
    cleanupResize();
    if (nextDuration !== startDuration) commit('activity.duration', { id, duration: nextDuration });
    else repaint(['timeline']);
  }

  function cancelResize() {
    cleanupResize();
    repaint(['timeline']);
  }

  return {
    /** Attached after every timeline repaint; handles are recreated each time. */
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
