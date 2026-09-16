/**
 * The person filter (D12).
 *
 * Filtering fades the activities that do not match rather than removing them.
 * The point of this plan is when things happen, and a photographer looking at
 * their own three activities still needs to see that there are two hours
 * between them. Hiding the rest would collapse the day into a list and lose
 * exactly the thing the timeline is for.
 *
 * Matching is exact: "Bride" does not match "All Guests", and a group is a
 * name like any other.
 */
import { escapeHtml } from '../dom.js';
import { icon } from '../icons.js';

/** Every distinct name in the plan, in the order it is first used. */
export function peopleInPlan(plan) {
  const seen = new Set();
  const names = [];
  for (const activity of plan.activities) {
    for (const person of activity.people || []) {
      if (seen.has(person)) continue;
      seen.add(person);
      names.push(person);
    }
  }
  return names;
}

export function countMatching(plan, person) {
  if (!person) return plan.activities.length;
  return plan.activities.filter(activity => (activity.people || []).includes(person)).length;
}

export function renderFilters({ plan, ui }) {
  const names = peopleInPlan(plan);
  if (!names.length) return '';

  const chip = (label, value, on) =>
    `<button type="button" class="filter-chip ${on ? 'is-on' : ''}" data-action="filter" data-person="${escapeHtml(value ?? '')}"
      aria-pressed="${on}">${escapeHtml(label)}</button>`;

  return `<div class="filter-chips" role="group" aria-label="Show one person's activities">
    ${chip('Everyone', '', !ui.filter)}
    ${names.map(name => chip(name, name, ui.filter === name)).join('')}
  </div>`;
}

/**
 * While a filter is on it stays pinned under the top bar, because a faded
 * activity and a filtered-out one look the same after a few seconds of
 * scrolling, and forgetting that a filter is on is how people mistrust what
 * they are reading.
 */
export function renderFilterBar({ plan, ui }) {
  if (!ui.filter) return '';
  const matching = countMatching(plan, ui.filter);
  return `<div class="pinned-bar pinned-bar--filter" role="status">
    <span>Showing <b>${escapeHtml(ui.filter)}</b> · ${matching} of ${plan.activities.length}</span>
    <button type="button" class="filter-clear" data-action="filter" data-person="" aria-label="Show everyone">${icon('x')}</button>
  </div>`;
}
