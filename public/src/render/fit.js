/**
 * Fitting: deciding what a card can show, by measuring it.
 *
 * A card's height is its duration — that is not negotiable, because vertical
 * position is clock time. So when the content does not fit, content goes, in a
 * fixed order: people, then the stage tag, then the location, then the progress
 * bar, then the time. The title and any warning always stay, because they are
 * the reasons to look at the card at all.
 *
 * This has to be measured rather than calculated: whether "St. Peter and Paul
 * Orthodox Sobor" wraps to two lines depends on the width, the font and the
 * text.
 *
 * Reads and writes are kept apart, across the whole pass rather than within
 * one card. Every read of a layout property after a write forces the browser to
 * lay the document out again, so resetting one card, measuring it, resetting
 * the next and measuring that one costs one full layout per card — on a long
 * day, dozens in a single frame, on the phone that can least afford it. The
 * pass therefore runs in phases: reset every card, measure every card, then
 * decide. Which rows to drop is worked out from the row heights rather than by
 * hiding one and measuring again, and a single correction round catches the
 * rounding, so the whole thing costs a handful of layouts however long the day
 * is.
 */

const CLIPPED = 'is-clipped';

/**
 * People tags: show as many whole names as fit on one line, then count the
 * rest in a "+N" tag. Never initials (D25).
 *
 * This one stays iterative. It only runs on a row that has already been
 * measured as overflowing, which is a small minority of cards, and the width
 * of "+N" depends on N — so the arithmetic that works for row heights would
 * need a probe of its own to be no more exact than this.
 */
function fitPeople(row) {
  const existing = row.querySelector('.tag--count');
  if (existing) existing.remove();
  const tags = [...row.querySelectorAll('.tag')];
  if (!tags.length) return;
  for (const tag of tags) tag.hidden = false;

  if (row.scrollWidth <= row.clientWidth + 1) return;

  const count = document.createElement('span');
  count.className = 'tag tag--count';
  row.append(count);

  let hidden = 0;
  for (let i = tags.length - 1; i >= 0; i -= 1) {
    tags[i].hidden = true;
    hidden += 1;
    count.textContent = `+${hidden}`;
    if (row.scrollWidth <= row.clientWidth + 1) break;
  }

  // If even "+N" alone does not fit there is nothing useful to show.
  if (hidden === tags.length) count.remove();
}

/** Phase one, a write: put the card back to showing everything. */
function resetCard(card) {
  const body = card.querySelector('.card-body');
  if (!body) return null;
  card.classList.remove(CLIPPED);
  if (card.classList.contains('card--line')) return null;

  const rows = [...body.querySelectorAll('[data-drop]')]
    .sort((a, b) => Number(a.dataset.drop) - Number(b.dataset.drop));
  for (const row of rows) row.hidden = false;
  return { card, body, rows };
}

/** Phase two, a read: everything the decision needs, and nothing written. */
function measureCard(entry) {
  const { body, rows } = entry;
  const peopleRow = body.querySelector('.card-people');
  return {
    ...entry,
    peopleRow,
    // A desktop card under half an hour drops its people in the stylesheet
    // rather than by measurement (there is no room at that height, whatever
    // the names are). That is still something hidden, so it still gets dots.
    peopleDropped: Boolean(peopleRow) && getComputedStyle(peopleRow).display === 'none',
    peopleOverflows: Boolean(peopleRow) && peopleRow.scrollWidth > peopleRow.clientWidth + 1,
    gap: Number.parseFloat(getComputedStyle(body).rowGap) || 0,
    heights: rows.map(row => row.offsetHeight),
    excess: body.scrollHeight - body.clientHeight
  };
}

/**
 * Phase three, a write: drop rows until the arithmetic says they fit.
 *
 * Hiding a row reclaims its own height and, unless it was the last one left,
 * the gap that went with it.
 */
function dropRows(measurement) {
  const { card, rows, heights, gap } = measurement;
  let excess = measurement.excess;
  let visible = rows.length;
  let clipped = false;

  for (let i = 0; i < rows.length; i += 1) {
    if (excess <= 1) break;
    rows[i].hidden = true;
    excess -= heights[i] + (visible > 1 ? gap : 0);
    visible -= 1;
    clipped = true;
  }

  if (measurement.peopleDropped) clipped = true;
  if (clipped) card.classList.add(CLIPPED);
}

/**
 * The correction rounds.
 *
 * The arithmetic above assumes that hiding a row gives back that row's height.
 * That is true of the phone card, which is a flex column, and false of the
 * desktop card, which is a grid: there the time sits in the same grid row as
 * the title, so hiding it reclaims nothing at all. Rather than special-case
 * the two layouts, the shortfall is simply measured and corrected — but a
 * round at a time, across every card at once, so the cost is one layout per
 * droppable row instead of one per row per card.
 */
const MAX_CORRECTION_ROUNDS = 5;

function stillOverflowing(measurement) {
  const { body } = measurement;
  return body.scrollHeight > body.clientHeight + 1;
}

/** Hides the next row in drop order. False once there is nothing left to drop. */
function dropOneMore(measurement) {
  const next = measurement.rows.find(row => !row.hidden);
  if (!next) return false;
  next.hidden = true;
  measurement.card.classList.add(CLIPPED);
  return true;
}

/** The whole pass over a set of cards, in phases. */
function fitAll(cards) {
  // 1 — write: everything back on.
  const entries = [];
  for (const card of cards) {
    const entry = resetCard(card);
    if (entry) entries.push(entry);
    else card.classList.toggle(CLIPPED, card.classList.contains('card--line'));
  }

  // 2 — read: one layout for the lot.
  const measured = entries.map(measureCard);

  // 3 — write: names first, then rows.
  //
  // The order matters only in one unreachable corner — a row so narrow that
  // even "+N" has to go, which leaves it empty and therefore shorter — but it
  // is the order the measured heights describe, so it is the order used.
  for (const measurement of measured) {
    if (!measurement.peopleRow || !measurement.peopleOverflows) continue;
    fitPeople(measurement.peopleRow);
    // A people row that lost names is hidden detail too, even if the row
    // stayed.
    if (measurement.peopleRow.querySelector('.tag--count')) measurement.card.classList.add(CLIPPED);
  }
  for (const measurement of measured) dropRows(measurement);

  // 4 — correct, a round at a time: write for everything still short, then
  // one read for the lot.
  let short = measured.filter(stillOverflowing);
  for (let round = 0; round < MAX_CORRECTION_ROUNDS && short.length; round += 1) {
    short = short.filter(dropOneMore).filter(stillOverflowing);
  }
}

/** Re-fit a single card, for a resize that is changing its height right now. */
export function refit(card) {
  if (card) fitAll([card]);
}

/** What a card had to hide, in words, for the selection toolbar's second line. */
export function hiddenDetails(card) {
  const parts = [];
  const body = card?.querySelector('.card-body');
  if (!body) return '';

  const stage = body.querySelector('.card-stage');
  if (stage?.hidden) parts.push(stage.textContent.trim());

  const location = body.querySelector('.card-location');
  if (location?.hidden) parts.push(location.textContent.trim());

  const people = body.querySelector('.card-people');
  if (people) {
    const names = [...people.querySelectorAll('.tag:not(.tag--count)')];
    const gone = people.hidden || getComputedStyle(people).display === 'none';
    const missing = gone ? names : names.filter(tag => tag.hidden);
    if (missing.length) parts.push(missing.map(tag => tag.textContent.trim()).join(', '));
  }

  const time = body.querySelector('.card-time');
  if (time?.hidden) parts.unshift(time.textContent.trim().replace(/\s+/g, ' '));

  return parts.filter(Boolean).join(' · ');
}

let queued = false;

/** Runs the pass once per frame, however many times it is asked for. */
export function fitCards(root, done) {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    fitAll(root.querySelectorAll('.card'));
    // The toolbar repeats what the selected card dropped, so it can only be
    // drawn once the measuring is finished.
    done?.();
  });
}

/**
 * Re-measures when the width changes or a webfont arrives — both change what
 * fits, and neither triggers a render on its own.
 */
export function watchFit(root) {
  let timer = null;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(() => fitCards(root), 120);
  };
  window.addEventListener('resize', later);
  document.fonts?.ready?.then(() => fitCards(root));
  return () => {
    clearTimeout(timer);
    window.removeEventListener('resize', later);
  };
}
