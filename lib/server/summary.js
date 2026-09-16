/**
 * The one-line description of a plan, used on version rows: "12 activities ·
 * 11:30 AM – 10:45 PM". It is computed once when a version is written, so the
 * list can be shown without loading every plan body.
 */
import { buildSchedule, formatTime } from '../../public/src/schedule.js';

export function buildSummary(plan) {
  const schedule = buildSchedule(plan);
  return {
    count: schedule.summary.count,
    start: schedule.summary.count ? formatTime(schedule.summary.start) : null,
    end: schedule.summary.count ? formatTime(schedule.summary.end) : null
  };
}
