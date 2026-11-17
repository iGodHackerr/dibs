// 5-hour play sessions. They only exist on free-play weeks (no weekly dibs), and there is at most ONE
// session per calendar day, shared by both of you, so the ball never gets worn out. Pure functions.
import { MAX_WEEKS_AHEAD, SESSION_MINUTES } from './config.js';
import { addDays, clock12, dayIdx, nice, parseHM, weekEndOf, weekStartOf } from './dates.js';

/** A tiny allowance so "start now" still works when the request lands a few seconds into the next minute. */
export const GRACE_MIN = 3;

export const startIdx = (s) => dayIdx(s.date) * 1440 + parseHM(s.start);
export const endIdx = (s) => startIdx(s) + SESSION_MINUTES;
export const nowIdx = (today, nowMin) => dayIdx(today) * 1440 + nowMin;

/** Last day a session can be booked: the end of the furthest week that dibs can be called for. */
export const horizon = (today) => weekEndOf(addDays(weekStartOf(today), 7 * MAX_WEEKS_AHEAD));

/** When does a session end? -> { date, min } (min is minutes since that day's midnight) */
export function endOf(date, startMin) {
  const e = startMin + SESSION_MINUTES;
  return { date: addDays(date, Math.floor(e / 1440)), min: e % 1440 };
}

/** "Sat 28 Nov · 3:00 PM → 8:00 PM" (adds the day to the end when it runs past midnight) */
export function describe(s) {
  const startMin = parseHM(s.start);
  const e = endOf(s.date, startMin);
  return `${nice(s.date)} · ${clock12(startMin)} → ${clock12(e.min)}${e.date !== s.date ? ` (${nice(e.date)})` : ''}`;
}

/** Can anyone book a session on this day at all? */
export function dayStatus({ date, today, dibsByWeek, sessionsByDate, me }) {
  if (date < today) return { status: 'past', canBook: false, reason: 'That day has passed.' };
  const dib = dibsByWeek[weekStartOf(date)];
  if (dib) {
    const mine = dib.user === me;
    return {
      status: 'dib', owner: dib.user, canBook: false,
      reason: mine ? 'You have weekly dibs, so the ball is yours all week. Sessions are for free-play weeks.' : `${dib.user} has weekly dibs that week. Sessions are for free-play weeks.`,
    };
  }
  if (date > horizon(today)) return { status: 'far', canBook: false, reason: `Sessions can be booked up to ${MAX_WEEKS_AHEAD} weeks ahead.` };
  const s = sessionsByDate[date];
  if (s) return { status: 'taken', session: s, canBook: false, reason: `${s.user === me ? 'You already have' : `${s.user} already has`} a session that day. It's one session a day.` };
  return { status: 'free', canBook: true };
}

/** Full check for booking `startMin` (minutes after midnight) on `date`. -> { ok:true } | { ok:false, reason } */
export function checkSession({ date, startMin, today, nowMin, dibsByWeek, sessionsByDate, me }) {
  const day = dayStatus({ date, today, dibsByWeek, sessionsByDate, me });
  if (!day.canBook) return { ok: false, reason: day.reason, status: day.status };

  if (date === today && startMin < nowMin - GRACE_MIN) return { ok: false, reason: `That time has already passed. It's ${clock12(nowMin)} now.`, status: 'past' };

  const end = endOf(date, startMin);
  if (end.date !== date) {
    const nextDib = dibsByWeek[weekStartOf(end.date)];
    if (nextDib && nextDib.user !== me) return { ok: false, reason: `That session would run into ${nice(end.date)}, when ${nextDib.user} has weekly dibs.`, status: 'dib' };
  }

  const mine = { date, start: `${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}` };
  const a0 = startIdx(mine), a1 = endIdx(mine);
  for (const other of [sessionsByDate[addDays(date, -1)], sessionsByDate[addDays(date, 1)]]) {
    if (!other) continue;
    if (startIdx(other) < a1 && endIdx(other) > a0) {
      const e = endOf(other.date, parseHM(other.start));
      return { ok: false, reason: `That overlaps ${other.user === me ? 'your' : `${other.user}'s`} session (${nice(other.date)}, ${clock12(parseHM(other.start))} → ${clock12(e.min)}).`, status: 'overlap' };
    }
  }
  return { ok: true };
}

/** Another person's unfinished session that touches the week of `weekStart`? Then that week can't be claimed. */
export function blockingSession({ weekStart, sessionsByDate, me, nowIndex }) {
  const weekEnd = weekEndOf(weekStart);
  return Object.values(sessionsByDate).find((s) => {
    if (s.user === me || endIdx(s) <= nowIndex) return false;
    const end = endOf(s.date, parseHM(s.start)).date;
    return s.date <= weekEnd && end >= weekStart;
  });
}

/** My own unfinished sessions that START inside that week. */
export const ownSessionsIn = ({ weekStart, sessionsByDate, me, nowIndex }) =>
  Object.values(sessionsByDate).filter((s) => s.user === me && s.date >= weekStart && s.date <= weekEndOf(weekStart) && endIdx(s) > nowIndex);
