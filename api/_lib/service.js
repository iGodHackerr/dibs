// Business logic: reading state, calling dibs, releasing dibs.
import crypto from 'node:crypto';
import { MAX_WEEKS_AHEAD, PER_MONTH, SESSION_HOURS, USERS, openFrom, otherUser, timezone } from './config.js';
import { addDays, clock12, isISODate, isWeekStart, nice, nowIn, parseHM, toHM, weekEndOf, weekStartOf } from './dates.js';
import { HttpError } from './http.js';
import { notify, recentNotes, subscriptionCount, unreadCount, vapidPublicKey } from './notify.js';
import { evaluateWeek } from './rules.js';
import { checkSession, describe, endOf, endIdx, nowIdx, ownSessionsIn } from './sessions.js';
import { getStore } from './store.js';

/**
 * The date and wall-clock time right now in the app timezone: { date, secs }.
 * FAKE_TODAY / FAKE_MINUTES only work off Vercel (tests and local demos).
 */
export function nowLocal() {
  const real = nowIn(timezone());
  if (process.env.VERCEL) return real;
  const fakeMin = process.env.FAKE_MINUTES;
  return {
    date: process.env.FAKE_TODAY || real.date,
    secs: fakeMin != null && fakeMin !== '' ? Number(fakeMin) * 60 : process.env.FAKE_TODAY ? 10 * 3600 : real.secs,
  };
}
export const today = () => nowLocal().date;

export async function loadDibs() {
  const raw = (await getStore().hgetall('dibs')) || {};
  const out = {};
  for (const [week, v] of Object.entries(raw)) {
    try { out[week] = JSON.parse(v); } catch { /* skip corrupt row */ }
  }
  return out;
}

/** Play sessions keyed by the date they start on. */
export async function loadSessions() {
  const raw = (await getStore().hgetall('plays')) || {};
  const out = {};
  for (const [date, v] of Object.entries(raw)) {
    try { out[date] = JSON.parse(v); } catch { /* skip corrupt row */ }
  }
  return out;
}

export async function buildState(user, req) {
  const { date: now, secs } = nowLocal();
  const [dibsByWeek, sessionsByDate] = await Promise.all([loadDibs(), loadSessions()]);
  const nowIndex = nowIdx(now, Math.floor(secs / 60));
  const open = openFrom();
  const cur = weekStartOf(now);

  // Rules verdict for this week and the next few; the app treats anything beyond as "too far".
  const weeks = {};
  for (let i = 0; i <= MAX_WEEKS_AHEAD + 1; i++) {
    const weekStart = addDays(cur, 7 * i);
    weeks[weekStart] = evaluateWeek({ weekStart, today: now, dibsByWeek, me: user, openFrom: open, sessionsByDate, nowIndex });
  }

  const notifications = await recentNotes(user);
  return {
    me: user,
    other: otherUser(user),
    today: now,
    nowSecs: secs,
    timezone: timezone(),
    config: { perMonth: PER_MONTH, maxWeeksAhead: MAX_WEEKS_AHEAD, openFrom: open, users: USERS, sessionHours: SESSION_HOURS },
    dibs: Object.values(dibsByWeek).sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
    // sessions from the last month onwards, oldest first
    sessions: Object.values(sessionsByDate).filter((x) => x.date >= addDays(now, -35)).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)),
    weeks,
    notifications,
    unread: await unreadCount(user, notifications),
    push: { publicKey: vapidPublicKey(), devices: await subscriptionCount(user) },
  };
}

async function withLock(fn) {
  const store = getStore();
  const got = await store.set('lock:dibs', '1', { nx: true, ex: 8 });
  if (!got) throw new HttpError(409, 'Another change is happening right now. Try again in a second.');
  try { return await fn(); } finally { await store.del('lock:dibs'); }
}

function checkWeekStart(weekStart) {
  if (!isISODate(weekStart) || !isWeekStart(weekStart)) {
    throw new HttpError(400, 'Dibs weeks start on a Friday.');
  }
}

export async function createDib(user, weekStart, req) {
  checkWeekStart(weekStart);
  const dib = await withLock(async () => {
    const [dibsByWeek, sessionsByDate] = await Promise.all([loadDibs(), loadSessions()]);
    const { date, secs } = nowLocal();
    const nowIndex = nowIdx(date, Math.floor(secs / 60));
    const verdict = evaluateWeek({ weekStart, today: date, dibsByWeek, me: user, openFrom: openFrom(), sessionsByDate, nowIndex });
    if (!verdict.canBook) throw new HttpError(409, verdict.reason || 'You cannot call dibs on that week.', { status: verdict.status });
    const row = { id: crypto.randomBytes(5).toString('hex'), weekStart, weekEnd: weekEndOf(weekStart), user, createdAt: Date.now() };
    const claimed = await getStore().hsetnx('dibs', weekStart, JSON.stringify(row));
    if (!claimed) throw new HttpError(409, 'Someone just took that week.');
    // weekly dibs cover the whole week, so your own not-yet-finished sessions in it are folded in
    for (const mine of ownSessionsIn({ weekStart, sessionsByDate, me: user, nowIndex })) await getStore().hdel('plays', mine.date);
    return row;
  });

  await notify(otherUser(user), {
    type: 'dibs-called',
    title: `✋ ${user} called dibs`,
    body: `The ball is theirs ${nice(dib.weekStart)} → ${nice(dib.weekEnd)}.`,
  }, req);
  return dib;
}

export async function releaseDib(user, weekStart, req) {
  checkWeekStart(weekStart);
  const dib = await withLock(async () => {
    const dibsByWeek = await loadDibs();
    const row = dibsByWeek[weekStart];
    if (!row) throw new HttpError(404, 'There are no dibs on that week.');
    if (row.user !== user) throw new HttpError(403, "That's not your dibs to release.");
    if (row.weekEnd < today()) throw new HttpError(409, 'That week is already over.');
    await getStore().hdel('dibs', weekStart);
    return row;
  });

  await notify(otherUser(user), {
    type: 'dibs-released',
    title: `👋 ${user} let go of their dibs`,
    body: `${nice(dib.weekStart)} → ${nice(dib.weekEnd)} is free play again.`,
  }, req);
  return dib;
}

/* ───────────────────────── play sessions ───────────────────────── */

export async function createSession(user, date, start, req) {
  const startMin = parseHM(start);
  if (!isISODate(date) || startMin === null) throw new HttpError(400, 'Pick a day and a start time.');
  const row = await withLock(async () => {
    const [dibsByWeek, sessionsByDate] = await Promise.all([loadDibs(), loadSessions()]);
    const { date: now, secs } = nowLocal();
    const verdict = checkSession({ date, startMin, today: now, nowMin: Math.floor(secs / 60), dibsByWeek, sessionsByDate, me: user });
    if (!verdict.ok) throw new HttpError(409, verdict.reason, { status: verdict.status });
    const end = endOf(date, startMin);
    const created = { id: crypto.randomBytes(5).toString('hex'), date, start: toHM(startMin), end: toHM(end.min), endDate: end.date, user, createdAt: Date.now() };
    if (!(await getStore().hsetnx('plays', date, JSON.stringify(created)))) throw new HttpError(409, 'Someone just booked that day.');
    // tidy: forget sessions older than two months
    const cutoff = addDays(now, -60);
    for (const old of Object.keys(sessionsByDate)) if (old < cutoff) await getStore().hdel('plays', old);
    return created;
  });

  await notify(otherUser(user), {
    type: 'session-booked',
    title: `⏱️ ${user} will start a session at ${clock12(parseHM(row.start))}`,
    body: `${describe(row)} · ${SESSION_HOURS} hours with the ball.`,
  }, req);
  return row;
}

export async function cancelSession(user, date, req) {
  if (!isISODate(date)) throw new HttpError(400, 'Which day?');
  const row = await withLock(async () => {
    const found = (await loadSessions())[date];
    if (!found) throw new HttpError(404, 'There is no session on that day.');
    if (found.user !== user) throw new HttpError(403, "That's not your session to cancel.");
    const { date: now, secs } = nowLocal();
    if (found.date < now || (found.date === now && parseHM(found.start) <= Math.floor(secs / 60))) {
      throw new HttpError(409, endIdx(found) <= nowIdx(now, Math.floor(secs / 60)) ? 'That session is already over.' : 'That session has already started.');
    }
    await getStore().hdel('plays', date);
    return found;
  });

  await notify(otherUser(user), {
    type: 'session-cancelled',
    title: `👋 ${user} cancelled their session`,
    body: `${describe(row)} is free again.`,
  }, req);
  return row;
}
