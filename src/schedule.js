const MINUTES_PER_DAY = 24 * 60;

export function parseTime(value) {
  if (!/^\d{2}:\d{2}$/.test(value || '')) return null;
  const [hours, minutes] = value.split(':').map(Number);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatTime(totalMinutes) {
  const normalized = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

export function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function minutesToTime(totalMinutes) {
  const normalized = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

export function buildSchedule(plan) {
  let cursor = parseTime(plan.dayStart) ?? 8 * 60;
  const items = [];
  let totalConflicts = 0;

  for (const activity of plan.activities) {
    const duration = Math.max(5, Number(activity.duration) || 5);
    let fixedStart = parseTime(activity.lockedStart);
    if (fixedStart !== null && cursor >= 12 * 60 && fixedStart < cursor - 12 * 60) fixedStart += MINUTES_PER_DAY;
    let start = cursor;
    let gapBefore = 0;
    let conflictMinutes = 0;

    if (fixedStart !== null) {
      start = fixedStart;
      if (cursor < fixedStart) gapBefore = fixedStart - cursor;
      if (cursor > fixedStart) {
        conflictMinutes = cursor - fixedStart;
        totalConflicts += 1;
      }
    }

    const end = start + duration;
    items.push({
      ...activity,
      duration,
      start,
      end,
      startLabel: formatTime(start),
      endLabel: formatTime(end),
      gapBefore,
      conflictMinutes,
      isLocked: fixedStart !== null
    });

    cursor = Math.max(cursor, end);
  }

  return {
    items,
    totalConflicts,
    end: cursor,
    endLabel: formatTime(cursor)
  };
}

export function clampDuration(minutes) {
  const rounded = Math.ceil(Number(minutes || 0) / 5) * 5;
  return Math.min(12 * 60, Math.max(5, rounded));
}
