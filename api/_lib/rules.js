// The one place that decides whether a week can be claimed. Pure functions -> easy to test.
import { MAX_WEEKS_AHEAD, PER_MONTH } from './config.js';
import { addDays, diffDays, monthOf, nice, niceMonth, weekEndOf, weekStartOf } from './dates.js';

/**
 * @param {object} p
 * @param {string} p.weekStart   Friday (YYYY-MM-DD) of the week being asked about
 * @param {string} p.today       today's date in the app timezone
 * @param {Record<string, {user:string, weekStart:string}>} p.dibsByWeek  all active dibs, keyed by weekStart
 * @param {string} p.me          the viewer
 * @param {string} p.openFrom    first Friday dibs are allowed
 * @returns {{status:string, owner?:string, past:boolean, canBook:boolean, canRelease:boolean, reason?:string, opensOn?:string}}
 *   status: past | mine | theirs | locked | far | quota | open
 */
export function evaluateWeek({ weekStart, today, dibsByWeek, me, openFrom }) {
  const weekEnd = weekEndOf(weekStart);
  const currentWeek = weekStartOf(today);
  const past = weekEnd < today;
  const dib = dibsByWeek[weekStart];

  if (dib) {
    const mine = dib.user === me;
    return {
      status: mine ? 'mine' : 'theirs',
      owner: dib.user,
      past,
      canBook: false,
      canRelease: mine && !past,
      reason: mine ? undefined : `${dib.user} has dibs this week.`,
    };
  }

  if (past) return { status: 'past', past: true, canBook: false, canRelease: false, reason: 'This week is over.' };

  if (weekStart < openFrom) {
    return {
      status: 'locked', past: false, canBook: false, canRelease: false, opensOn: openFrom,
      reason: `No dibs yet. Dibs open from ${nice(openFrom)}, until then the ball is free for both of you.`,
    };
  }

  const weeksAhead = diffDays(currentWeek, weekStart) / 7;
  if (weeksAhead > MAX_WEEKS_AHEAD) {
    const opensOn = addDays(weekStart, -7 * MAX_WEEKS_AHEAD);
    return {
      status: 'far', past: false, canBook: false, canRelease: false, opensOn,
      reason: `Dibs can be called up to ${MAX_WEEKS_AHEAD} weeks in advance. This week opens on ${nice(opensOn)}.`,
    };
  }

  const month = monthOf(weekStart);
  const used = Object.values(dibsByWeek).filter((d) => d.user === me && monthOf(d.weekStart) === month).length;
  if (used >= PER_MONTH) {
    return {
      status: 'quota', past: false, canBook: false, canRelease: false,
      reason: `You've used both of your ${niceMonth(month)} dibs. Fair is fair, so someone else gets a turn.`,
    };
  }

  return { status: 'open', past: false, canBook: true, canRelease: false };
}

export const usedInMonth = (dibsByWeek, user, ym) =>
  Object.values(dibsByWeek).filter((d) => d.user === user && monthOf(d.weekStart) === ym).length;
