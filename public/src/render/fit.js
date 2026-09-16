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
 * text. All reads happen before any writes, and the whole pass runs in one
 * animation frame.
 */

const CLIPPED = 'is-clipped';

/**
 * People tags: show as many whole names as fit on one line, then count the
 * rest in a "+N" tag. Never initials (D25).
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

function fitCard(card) {
  const body = card.querySelector('.card-body');
  if (!body) return [];

  const rows = [...body.querySelectorAll('[data-drop]')];
  for (const row of rows) row.hidden = false;
  card.classList.remove(CLIPPED);

  // A one-line card has already dropped everything it can.
  if (card.classList.contains('card--line')) {
    card.classList.add(CLIPPED);
    return [];
  }

  const peopleRow = body.querySelector('.card-people');
  if (peopleRow) fitPeople(peopleRow);

  const hidden = [];
  for (const row of rows.sort((a, b) => Number(a.dataset.drop) - Number(b.dataset.drop))) {
    if (body.scrollHeight <= body.clientHeight + 1) break;
    row.hidden = true;
    hidden.push(row);
    card.classList.add(CLIPPED);
  }

  // A people row that lost names is hidden detail too, even if the row stayed.
  if (peopleRow && !peopleRow.hidden && peopleRow.querySelector('.tag--count')) {
    card.classList.add(CLIPPED);
  }
  return hidden;
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
    const missing = people.hidden ? names : names.filter(tag => tag.hidden);
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
    for (const card of root.querySelectorAll('.card')) fitCard(card);
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
