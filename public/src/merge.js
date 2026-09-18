/**
 * Three-way merge for two people editing one plan.
 *
 * The old answer to a collision was a modal offering two whole days: keep
 * mine, or take theirs. With two people editing the same plan on the same
 * afternoon that question is almost always the wrong one — you moved the
 * ceremony, they renamed the dinner, and neither change has anything to say
 * about the other. Asking which *day* to keep makes one of you throw away work
 * that was never in dispute.
 *
 * So the question is asked at the smallest place it is real. Given the plan as
 * the server last confirmed it (`base`), the plan on this screen (`mine`) and
 * the plan the server is now holding (`theirs`), everything only one side
 * touched is taken without a word. What is left — the same field of the same
 * activity, changed by both to different values — is the only thing worth
 * anyone's attention, and it comes back named.
 *
 * Nothing here knows the shape of a plan beyond "it has `activities`, keyed by
 * id, and some other fields". New fields merge correctly the day they are
 * added, which is the property that lets the schema keep moving.
 */

/** Deliberately structural: plans are JSON, so this is the whole story. */
export function isEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((item, index) => isEqual(item, b[index]));
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(key => Object.hasOwn(b, key) && isEqual(a[key], b[key]));
}

/**
 * One value, three versions. The side that did not move yields to the side
 * that did; when both moved to the same place there was never a disagreement.
 * A real disagreement returns the preferred side and says so.
 */
function pick(base, mine, theirs, prefer) {
  const mineMoved = !isEqual(base, mine);
  const theirsMoved = !isEqual(base, theirs);
  if (!mineMoved) return { value: theirs, conflict: false };
  if (!theirsMoved) return { value: mine, conflict: false };
  if (isEqual(mine, theirs)) return { value: mine, conflict: false };
  return { value: prefer === 'theirs' ? theirs : mine, conflict: true };
}

function keyUnion(...objects) {
  const keys = [];
  for (const object of objects) {
    for (const key of Object.keys(object || {})) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

function byId(activities) {
  return new Map((activities || []).map(activity => [activity.id, activity]));
}

/**
 * Both sides kept the activity and both changed it. Merged field by field, so
 * a renamed title and a moved location land together and only the same field
 * changed twice is a question.
 */
function mergeActivity(base, mine, theirs, prefer) {
  const merged = {};
  const fields = [];
  for (const key of keyUnion(base, mine, theirs)) {
    const result = pick(base?.[key], mine?.[key], theirs?.[key], prefer);
    if (result.value !== undefined) merged[key] = result.value;
    if (result.conflict) fields.push(key);
  }
  return { activity: merged, fields };
}

function describe(...candidates) {
  for (const activity of candidates) {
    if (activity?.title) return activity.title;
  }
  return 'an activity';
}

/**
 * The merged plan, and every disagreement that survived merging.
 *
 * `prefer` decides which side wins a genuine disagreement. It exists so the
 * same merge can be run twice — once to show what is in dispute, once when
 * someone answers — rather than the answer being applied by a second code path
 * that could disagree with the first.
 */
export function mergePlans(base, mine, theirs, { prefer = 'mine' } = {}) {
  const conflicts = [];
  const plan = {};

  for (const key of keyUnion(base, mine, theirs)) {
    if (key === 'activities') continue;
    const result = pick(base?.[key], mine?.[key], theirs?.[key], prefer);
    if (result.value !== undefined) plan[key] = result.value;
    if (result.conflict) conflicts.push({ kind: 'plan', field: key, title: key });
  }

  const baseById = byId(base?.activities);
  const mineById = byId(mine?.activities);
  const theirsById = byId(theirs?.activities);

  // Mine first, in the order this screen has them, then anything only the
  // other side knows about. Display sorts by start regardless, so this is
  // about being predictable rather than about what anyone sees.
  const order = [
    ...(mine?.activities || []).map(activity => activity.id),
    ...(theirs?.activities || []).map(activity => activity.id).filter(id => !mineById.has(id)),
    ...(base?.activities || []).map(activity => activity.id).filter(id => !mineById.has(id) && !theirsById.has(id))
  ];

  const activities = [];
  const seen = new Set();

  for (const id of order) {
    if (seen.has(id)) continue;
    seen.add(id);

    const wasThere = baseById.get(id);
    const here = mineById.get(id);
    const there = theirsById.get(id);

    if (!wasThere) {
      // New on one side, or on both. Two devices inventing the same id is not
      // a thing that happens by accident, but if it did, it is a disagreement.
      if (here && there && !isEqual(here, there)) {
        const { activity, fields } = mergeActivity(null, here, there, prefer);
        activities.push(activity);
        if (fields.length) conflicts.push({ kind: 'both-added', id, title: describe(here, there), fields });
      } else {
        activities.push(here || there);
      }
      continue;
    }

    if (!here && !there) continue;                       // both deleted it

    if (!here) {
      // Deleted here. If they left it alone, the delete stands; if they were
      // working on it, deleting it would throw that work away silently, so the
      // activity stays and the disagreement is reported.
      if (isEqual(wasThere, there)) continue;
      activities.push(there);
      conflicts.push({ kind: 'deleted-here', id, title: describe(there, wasThere), fields: [] });
      continue;
    }

    if (!there) {
      if (isEqual(wasThere, here)) continue;
      activities.push(here);
      conflicts.push({ kind: 'deleted-there', id, title: describe(here, wasThere), fields: [] });
      continue;
    }

    const { activity, fields } = mergeActivity(wasThere, here, there, prefer);
    activities.push(activity);
    if (fields.length) conflicts.push({ kind: 'activity', id, title: describe(here, there), fields });
  }

  plan.activities = activities.filter(Boolean);
  return { plan, conflicts };
}

/** What the merge is worth saying out loud. One line, naming what is in dispute. */
export function describeConflicts(conflicts) {
  const names = [...new Set(conflicts.map(entry => entry.title))];
  if (!names.length) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
