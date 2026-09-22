/**
 * The app's own date and time picker.
 *
 * This replaced flatpickr, which was the one runtime dependency and could not
 * be made to work here: it hangs its calendar off `document.body`, and every
 * field that needs a picker is inside a `<dialog>` in the browser's top layer,
 * so the calendar opened *underneath* the sheet and its scrim. Nothing was
 * broken about the wiring — the picker was simply never visible.
 *
 * One component, three modes:
 *
 *   data-picker="time"     — a time of day on the 5-minute grid. Optional
 *                            fields (`data-optional`) can be cleared.
 *   data-picker="date"     — a calendar date, no time.
 *   data-picker="datetime" — an activity's absolute start, stored as minutes
 *                            from midnight on the plan's date. There is no
 *                            calendar: a time before 04:00 can only mean the
 *                            small hours after the wedding, so the day is
 *                            worked out from the clock (FUNCTIONAL_SPEC §5.2).
 *
 * The picker itself is a `<dialog>` opened with `showModal()`, so it stacks
 * above the sheet in the same top layer rather than fighting it.
 */
import { icon } from '../icons.js';
import { escapeHtml } from '../dom.js';

/**
 * Before 04:00, a time belongs to the day after the plan's date.
 *
 * A wedding day starts in the morning, so the small hours are always the far
 * end of the night rather than the beginning of it. The one thing this rule
 * cannot express is a 2 AM activity on the plan's own date — that is a drag on
 * the timeline, not a typed time.
 */
export const NEXT_DAY_BEFORE = 4 * 60;

/** One wheel row. `styles/sheets.css` sets the same number. */
const ROW = 44;

const MINUTES_IN_DAY = 24 * 60;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const pad = value => String(value).padStart(2, '0');

// ------------------------------------------------------------------ values

/** "2026-11-21" → a local Date at midnight. */
export function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  return new Date(year, month - 1, day);
}

export function toDateString(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Minutes past midnight, from "HH:MM". */
export function parseTime(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function toTimeString(minutes) {
  const total = ((Math.round(minutes) % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** "7:45 PM" — the reading the rest of the app uses. */
export function formatClock(minutes) {
  const total = ((Math.round(minutes) % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  const hours24 = Math.floor(total / 60);
  const hours = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours}:${pad(total % 60)} ${hours24 < 12 ? 'AM' : 'PM'}`;
}

/**
 * The day rule, in one place.
 *
 * Given a time of day and the plan's date, this is the absolute start the
 * picker commits — the plan's own date, or the day after it when the time is
 * in the small hours.
 */
export function resolveStart(minutesOfDay) {
  const time = ((Math.round(minutesOfDay) % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  return time < NEXT_DAY_BEFORE ? time + MINUTES_IN_DAY : time;
}

/** "Sat, Nov 21 · 7:45 PM" for an absolute start on a plan that starts `planDate`. */
export function formatStart(absoluteMinutes, planDate) {
  const minutes = Number(absoluteMinutes) || 0;
  const day = parseDate(planDate) || new Date();
  day.setDate(day.getDate() + Math.floor(minutes / MINUTES_IN_DAY));
  const label = day.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${label} · ${formatClock(minutes)}`;
}

/** "November 21, 2026" for a date field. */
export function formatDate(value) {
  const date = parseDate(value);
  if (!date) return '';
  return date.toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' });
}

// ------------------------------------------------------------------- field

/**
 * The markup a form writes for a picker field. The hidden input is what the
 * form submits; the button is what a person presses, and carries the reading.
 */
export function pickerField(name, { kind, value, label, placeholder = '', optional = false, glyph = 'clock', planDate = null }) {
  return `<span class="picker-field">
    <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value ?? '')}">
    <button type="button" class="picker-trigger" data-picker="${kind}" data-target="${escapeHtml(name)}"
      ${optional ? 'data-optional' : ''} ${planDate ? `data-plan-date="${escapeHtml(planDate)}"` : ''}
      aria-label="${escapeHtml(label)}">
      ${icon(glyph, 'picker-icon')}<span class="picker-text">${escapeHtml(display(kind, value, planDate) || placeholder)}</span>
    </button>
  </span>`;
}

function display(kind, value, planDate) {
  if (value === '' || value === null || value === undefined) return '';
  if (kind === 'datetime') return formatStart(value, planDate);
  if (kind === 'date') return formatDate(value);
  const minutes = parseTime(value);
  return minutes === null ? '' : formatClock(minutes);
}

// ------------------------------------------------------------------- wheel

/**
 * The time wheel: three scroll-snapped columns over a fixed centre band.
 *
 * Each column is a `spinbutton` rather than a listbox. A listbox would be a
 * lie — you cannot see the options, only scroll past them — and `spinbutton`
 * is what a screen reader already knows how to read out and step through.
 */
function buildWheel(minutesOfDay, onChange) {
  const root = document.createElement('div');
  root.className = 'wheel';
  root.setAttribute('role', 'group');

  const hours = Array.from({ length: 12 }, (_, index) => index + 1);
  const minutes = Array.from({ length: 12 }, (_, index) => pad(index * 5));

  const column = (unit, label, values, max) => `<div class="wheel-col" data-unit="${unit}"
    role="spinbutton" tabindex="0" aria-label="${label}" aria-valuemin="1" aria-valuemax="${max}">
    ${values.map(entry => `<span role="presentation" data-value="${entry}">${entry}</span>`).join('')}
  </div>`;

  root.innerHTML = `
    <div class="wheel-band" aria-hidden="true"></div>
    ${column('hour', 'Hour', hours.map(hour => pad(hour)), 12)}
    <span class="wheel-sep" aria-hidden="true">:</span>
    ${column('minute', 'Minute', minutes, 12)}
    ${column('ampm', 'Morning or afternoon', ['AM', 'PM'], 2)}`;

  const columns = [...root.querySelectorAll('.wheel-col')];
  let current = minutesOfDay;

  const indexFor = unit => {
    const hours24 = Math.floor(current / 60);
    if (unit === 'hour') return (hours24 % 12 === 0 ? 12 : hours24 % 12) - 1;
    if (unit === 'minute') return Math.round((current % 60) / 5) % 12;
    return hours24 < 12 ? 0 : 1;
  };

  const paint = column => {
    const index = Math.round(column.scrollTop / ROW);
    [...column.children].forEach((child, position) => child.classList.toggle('is-centre', position === index));
    column.setAttribute('aria-valuenow', String(index + 1));
    column.setAttribute('aria-valuetext', column.children[index]?.dataset.value ?? '');
  };

  const seat = () => {
    for (const column of columns) {
      column.scrollTop = indexFor(column.dataset.unit) * ROW;
      paint(column);
    }
  };

  const read = () => {
    const valueOf = unit => {
      const column = root.querySelector(`[data-unit="${unit}"]`);
      const index = Math.min(column.children.length - 1, Math.max(0, Math.round(column.scrollTop / ROW)));
      return column.children[index].dataset.value;
    };
    let hours24 = Number(valueOf('hour')) % 12;
    if (valueOf('ampm') === 'PM') hours24 += 12;
    current = hours24 * 60 + Number(valueOf('minute'));
    onChange(current);
  };

  for (const column of columns) {
    let settle = null;
    column.addEventListener('scroll', () => {
      paint(column);
      clearTimeout(settle);
      // Scroll-snap has no "finished" event, so the value is read once the
      // column has been still for long enough to have landed.
      settle = setTimeout(read, 110);
    }, { passive: true });

    column.addEventListener('click', event => {
      const cell = event.target.closest('[data-value]');
      if (cell) column.scrollTo({ top: [...column.children].indexOf(cell) * ROW, behavior: 'smooth' });
    });

    column.addEventListener('keydown', event => {
      const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const index = Math.round(column.scrollTop / ROW) + step;
      const clamped = Math.min(column.children.length - 1, Math.max(0, index));
      column.scrollTo({ top: clamped * ROW, behavior: 'smooth' });
    });
  }

  root.seat = seat;
  // Set has to be able to ask the columns where they are. The settle timer
  // below is what keeps the reading line in step while a wheel is turning, but
  // a finger that flicks a column and presses Set inside those 110 ms would
  // otherwise commit the value before the flick.
  root.read = read;
  return root;
}

// ---------------------------------------------------------------- calendar

function buildCalendar(selected, planDate, onPick) {
  const root = document.createElement('div');
  root.className = 'cal';
  let cursor = new Date(selected.getFullYear(), selected.getMonth(), 1);
  const plan = parseDate(planDate);

  const sameDay = (a, b) => Boolean(a && b)
    && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  function draw() {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());

    const cells = [];
    for (let offset = 0; offset < 42; offset++) {
      const day = new Date(start);
      day.setDate(start.getDate() + offset);
      const outside = day.getMonth() !== cursor.getMonth();
      // A sixth row that belongs entirely to the next month is a row of nothing.
      if (offset >= 35 && outside) continue;
      cells.push(`<button type="button" class="cal-day${outside ? ' is-out' : ''}${sameDay(day, plan) ? ' is-plan' : ''}"
        data-iso="${toDateString(day)}" aria-selected="${sameDay(day, selected)}">${day.getDate()}</button>`);
    }

    root.innerHTML = `
      <div class="cal-head">
        <strong>${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}</strong>
        <span class="cal-nav">
          <button type="button" data-step="-1" aria-label="Previous month">${icon('left')}</button>
          <button type="button" data-step="1" aria-label="Next month">${icon('right')}</button>
        </span>
      </div>
      <div class="cal-grid" role="grid">
        ${DOW.map(day => `<span class="cal-dow" role="columnheader">${day}</span>`).join('')}
        ${cells.join('')}
      </div>`;
  }

  root.addEventListener('click', event => {
    const step = event.target.closest('[data-step]');
    if (step) {
      cursor.setMonth(cursor.getMonth() + Number(step.dataset.step));
      draw();
      return;
    }
    const day = event.target.closest('[data-iso]');
    if (!day) return;
    const picked = parseDate(day.dataset.iso);
    selected.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
    cursor = new Date(picked.getFullYear(), picked.getMonth(), 1);
    draw();
    onPick();
  });

  draw();
  return root;
}

// ------------------------------------------------------------------ dialog

const LABELS = { datetime: 'Starts', date: 'Date', time: 'Time' };

/**
 * Wires every `[data-picker]` trigger under `root`.
 *
 * `onChange` is called with the field's name once a value is confirmed with
 * Set or Clear — never while the wheel is still turning, so a form that
 * recalculates (the editor's "Ends") does it once per decision.
 */
export function initPickers(root, { onChange, overlayRoot = document.body, onOverlayChange } = {}) {
  const triggers = [...root.querySelectorAll('[data-picker]')];
  for (const trigger of triggers) {
    trigger.addEventListener('click', () => open(trigger, { root, onChange, overlayRoot, onOverlayChange }));
  }
  return triggers;
}

function fieldOf(root, trigger) {
  return root.querySelector(`input[name="${trigger.dataset.target}"]`);
}

function open(trigger, { root, onChange, overlayRoot, onOverlayChange }) {
  const kind = trigger.dataset.picker;
  const planDate = trigger.dataset.planDate || null;
  const input = fieldOf(root, trigger);
  if (!input) return;

  const dialog = document.createElement('dialog');
  dialog.className = 'picker-dialog';
  dialog.innerHTML = `<section class="sheet sheet--picker" tabindex="-1">
    <header class="pick-bar">
      <button type="button" class="button button--text" data-pick-cancel>Cancel</button>
      <strong>${escapeHtml(trigger.getAttribute('aria-label') || LABELS[kind])}</strong>
      <button type="button" class="button button--text button--done" data-pick-set>Set</button>
    </header>
    <div class="pick-body"></div>
    <p class="pick-reading" aria-live="polite"></p>
  </section>`;

  const body = dialog.querySelector('.pick-body');
  const reading = dialog.querySelector('.pick-reading');

  /* The draft is the picker's own copy: Cancel really cancels. */
  let draftTime = 12 * 60;
  let draftDate = null;
  let wheel = null;

  if (kind === 'date') {
    draftDate = parseDate(input.value) || parseDate(planDate) || new Date();
    body.append(buildCalendar(draftDate, planDate, paint));
  } else {
    const seeded = kind === 'datetime'
      ? ((Number(input.value) || 0) % MINUTES_IN_DAY)
      : (parseTime(input.value) ?? 12 * 60);
    draftTime = Math.round(seeded / 5) * 5;
    wheel = buildWheel(draftTime, minutes => { draftTime = minutes; paint(); });
    body.append(wheel);
  }

  if (trigger.hasAttribute('data-optional')) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'pick-clear';
    clear.dataset.pickClear = '';
    clear.textContent = 'Clear';
    dialog.querySelector('.sheet').append(clear);
  }

  function paint() {
    if (kind === 'date') reading.textContent = formatDate(toDateString(draftDate));
    else if (kind === 'datetime') reading.textContent = formatStart(resolveStart(draftTime), planDate);
    else reading.textContent = formatClock(draftTime);
  }

  function commit(value) {
    input.value = value;
    trigger.querySelector('.picker-text').textContent =
      display(kind, value, planDate) || trigger.dataset.placeholder || 'Not set';
    // The form's own "has this changed" check reads the inputs, so the change
    // has to be announced the way a typed one would be.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    onChange?.(input.name, value);
  }

  function close() {
    dialog.close();
    dialog.remove();
    onOverlayChange?.();
    trigger.focus();
  }

  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener('click', event => {
    if (event.target.closest('[data-pick-cancel]')) { close(); return; }
    if (event.target.closest('[data-pick-clear]')) { commit(''); close(); return; }
    if (!event.target.closest('[data-pick-set]')) return;
    wheel?.read();
    if (kind === 'date') commit(toDateString(draftDate));
    else if (kind === 'datetime') commit(String(resolveStart(draftTime)));
    else commit(toTimeString(draftTime));
    close();
  });

  paint();
  overlayRoot.append(dialog);
  dialog.showModal();
  onOverlayChange?.();
  // The columns can only be seated once they have a height to scroll within.
  if (wheel) requestAnimationFrame(() => wheel.seat());
}
