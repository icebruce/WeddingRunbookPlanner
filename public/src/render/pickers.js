/**
 * flatpickr wiring.
 *
 * The one third-party dependency in this app, vendored under /vendor rather
 * than pulled from a CDN, so the planner still works with no network beyond
 * loading the page itself. It replaces the browser's own date and time
 * inputs — which differ from platform to platform and offer no calendar or
 * confirm affordance at all on desktop — with one picker, styled from this
 * app's own tokens, everywhere a date or time is entered.
 */

let ready = null;

function loadFlatpickr() {
  if (window.flatpickr) return Promise.resolve(window.flatpickr);
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/flatpickr/flatpickr.min.js';
    script.onload = () => resolve(window.flatpickr);
    script.onerror = reject;
    document.head.append(script);
  });
  return ready;
}

/**
 * Wires every `[data-picker]` input inside `root`. Each carries its own kind:
 *
 *   data-picker="time"     — a time of day, on the 5-minute grid.
 *   data-picker="date"     — a calendar date, no time.
 *   data-picker="datetime" — both, for an activity's absolute start, which can
 *                            fall on the day after the plan's own date.
 *
 * `onChange` is called with the field's name and the picked value (a "HH:MM"
 * string, a "YYYY-MM-DD" string, or a Date for a datetime field) as soon as a
 * value is confirmed — flatpickr's own change event, not every keystroke.
 */
export async function initPickers(root, { onChange } = {}) {
  const inputs = [...root.querySelectorAll('[data-picker]')];
  if (!inputs.length) return [];

  const flatpickr = await loadFlatpickr().catch(() => null);
  if (!flatpickr) return []; // Offline with nothing cached yet: the plain input still works.

  return inputs.map(input => {
    const kind = input.dataset.picker;
    const common = {
      allowInput: true,
      minuteIncrement: 5,
      disableMobile: true
    };

    if (kind === 'time') {
      return flatpickr(input, {
        ...common,
        enableTime: true,
        noCalendar: true,
        dateFormat: 'H:i',
        altInput: true,
        altFormat: 'h:i K',
        onChange: ([date]) => date && onChange?.(input.name, `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`)
      });
    }
    if (kind === 'date') {
      return flatpickr(input, {
        ...common,
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'F j, Y',
        onChange: ([date]) => date && onChange?.(input.name, toDateString(date))
      });
    }
    // datetime: an activity's start. Seeded from a real Date so flatpickr's
    // calendar can move a day forward for something that runs past midnight.
    return flatpickr(input, {
      ...common,
      enableTime: true,
      dateFormat: 'Y-m-d H:i',
      altInput: true,
      altFormat: 'D, M j · h:i K',
      onChange: ([date]) => date && onChange?.(input.name, date)
    });
  });
}

function toDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
