/**
 * The single store.
 *
 * Two things live here and are kept apart on purpose:
 *
 *   data — the plan, its revision, and when it was last written. This is what
 *          gets saved.
 *   ui   — selection, which menu is open, which sheet is showing, the active
 *          filter, drag and resize previews. None of it is ever saved, and
 *          none of it belongs to anyone but this device.
 *
 * Nothing changes the plan directly. Every change goes through `dispatch`,
 * which runs a registered action, records the plan as it was in a one-slot
 * undo buffer with a label ("Deleted Toast"), and reports what moved so the
 * caller can say "2 activities shifted".
 */

export const ACTIONS = new Map();

/**
 * An action is a pure function of the plan:
 *   (plan, payload) -> plan | { plan, shifted, label }
 * It must not mutate the plan it is given.
 */
export function defineAction(name, handler, { label } = {}) {
  ACTIONS.set(name, { handler, label });
}

function defaultUi() {
  return {
    selectedId: null,
    // Two or more ids, held together only long enough to drag them as one
    // group. Empty otherwise — a single selection lives in `selectedId` alone.
    groupSelection: [],
    // An open-time block's own lightweight selection, identified by the
    // activity it sits before (a gap's stable-enough identity — see
    // schedule.js). Separate from `selectedId`: an open block has no
    // toolbar, no lock, nothing the card selection machinery assumes.
    selectedOpenTime: null,
    // Only one menu or popover is open at a time; this holds its identity.
    openMenu: null,
    dialog: null,
    filter: null,
    mode: 'planning',
    preview: null,
    conflict: null,
    loadError: null,
    saveState: 'saved',
    versions: [],
    authenticated: null
  };
}

export function createStore(initial = {}) {
  const data = {
    plan: initial.plan ?? null,
    revision: initial.revision ?? null,
    updatedAt: initial.updatedAt ?? null
  };
  let ui = { ...defaultUi(), ...(initial.ui || {}) };

  // One step only, by design: an undo stack invites people to walk backwards
  // through a plan two other devices are also editing.
  let undoSlot = null;
  const listeners = new Set();

  function notify(change) {
    for (const listener of [...listeners]) listener(change);
  }

  const store = {
    get plan() { return data.plan; },
    get revision() { return data.revision; },
    get updatedAt() { return data.updatedAt; },
    get ui() { return ui; },
    get canUndo() { return undoSlot !== null; },
    get undoLabel() { return undoSlot?.label ?? null; },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Replace the plan wholesale (load, restore, conflict resolution). */
    setPlan(plan, { revision, updatedAt, keepUndo = false } = {}) {
      data.plan = plan;
      if (revision !== undefined) data.revision = revision;
      if (updatedAt !== undefined) data.updatedAt = updatedAt;
      if (!keepUndo) undoSlot = null;
      notify({ regions: ['all'], data: true });
    },

    setRevision(revision, updatedAt) {
      data.revision = revision;
      if (updatedAt !== undefined) data.updatedAt = updatedAt;
    },

    /**
     * Change UI state. Regions to repaint are named by the caller, because the
     * store has no opinion about what a piece of UI state is drawn by.
     *
     * A card and an open-time block keep separate selection fields — the
     * block has none of a card's toolbar, lock or edit baggage to carry —
     * but only one of them is ever "the" selection. Setting one to a real
     * value clears the other automatically, so every caller that selects a
     * card doesn't also need to remember an open-time block might currently
     * be the thing showing its own handles, and vice versa.
     */
    setUi(changes, { regions = ['all'] } = {}) {
      if ('selectedId' in changes && changes.selectedId != null && !('selectedOpenTime' in changes)) {
        changes = { ...changes, selectedOpenTime: null };
      } else if ('selectedOpenTime' in changes && changes.selectedOpenTime != null && !('selectedId' in changes)) {
        changes = { ...changes, selectedId: null };
      }
      let changed = false;
      for (const [key, value] of Object.entries(changes)) {
        if (ui[key] === value) continue;
        ui[key] = value;
        changed = true;
      }
      if (changed) notify({ regions, data: false });
      return changed;
    },

    resetUi() {
      ui = defaultUi();
      notify({ regions: ['all'], data: false });
    },

    /**
     * Run an action. Returns `{ prev, next, shifted, label }`, or null when the
     * action decided nothing needed to change (dropping a card back where it
     * started, for instance) — in that case nothing is recorded and nothing is
     * saved.
     */
    dispatch(name, payload, { regions = ['all'] } = {}) {
      const action = ACTIONS.get(name);
      if (!action) throw new Error(`Unknown action "${name}"`);
      if (!data.plan) return null;

      const prev = data.plan;
      // An action returns null to say "nothing to do here" — dropping a card
      // back where it started, or setting a stage to the one it already has.
      const result = action.handler(structuredClone(prev), payload);
      if (!result) return null;
      const next = result.plan ?? result;
      if (!next || next === prev) return null;

      const label = result.label
        ?? (typeof action.label === 'function' ? action.label(payload, { prev, next }) : action.label)
        ?? name;

      undoSlot = { plan: prev, label };
      data.plan = next;
      notify({ regions, data: true });

      return { prev, next, shifted: result.shifted ?? null, label };
    },

    /**
     * Undo is itself a change: it is saved like any other, and it swaps the
     * buffer so that undoing twice returns to where you were.
     */
    undo({ regions = ['all'] } = {}) {
      if (!undoSlot) return null;
      const restored = undoSlot.plan;
      const label = undoSlot.label;
      undoSlot = { plan: data.plan, label: `Undo ${label}` };
      data.plan = restored;
      notify({ regions, data: true });
      return { plan: restored, label };
    },

    clearUndo() {
      undoSlot = null;
    }
  };

  return store;
}
