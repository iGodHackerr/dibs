// Business logic: reading state, calling dibs, releasing dibs.
import crypto from 'node:crypto';
import { MAX_WEEKS_AHEAD, PER_MONTH, USERS, openFrom, otherUser, timezone } from './config.js';
import { addDays, isISODate, isWeekStart, nice, todayIn, weekEndOf, weekStartOf } from './dates.js';
import { HttpError } from './http.js';
import { notify, recentNotes, subscriptionCount, unreadCount, vapidPublicKey } from './notify.js';
import { evaluateWeek } from './rules.js';
import { getStore } from './store.js';

/** "Today" in the app timezone. FAKE_TODAY only works off Vercel (used by tests / local demos). */
export const today = () => (!process.env.VERCEL && process.env.FAKE_TODAY) || todayIn(timezone());

export async function loadDibs() {
  const raw = (await getStore().hgetall('dibs')) || {};
  const out = {};
  for (const [week, v] of Object.entries(raw)) {
    try { out[week] = JSON.parse(v); } catch { /* skip corrupt row */ }
  }
  return out;
}

export async function buildState(user, req) {
  const now = today();
  const dibsByWeek = await loadDibs();
  const open = openFrom();
  const cur = weekStartOf(now);

  // Rules verdict for this week and the next few; the app treats anything beyond as "too far".
  const weeks = {};
  for (let i = 0; i <= MAX_WEEKS_AHEAD + 1; i++) {
    const weekStart = addDays(cur, 7 * i);
    weeks[weekStart] = evaluateWeek({ weekStart, today: now, dibsByWeek, me: user, openFrom: open });
  }

  const notifications = await recentNotes(user);
  return {
    me: user,
    other: otherUser(user),
    today: now,
    timezone: timezone(),
    config: { perMonth: PER_MONTH, maxWeeksAhead: MAX_WEEKS_AHEAD, openFrom: open, users: USERS },
    dibs: Object.values(dibsByWeek).sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
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
    const dibsByWeek = await loadDibs();
    const verdict = evaluateWeek({ weekStart, today: today(), dibsByWeek, me: user, openFrom: openFrom() });
    if (!verdict.canBook) throw new HttpError(409, verdict.reason || 'You cannot call dibs on that week.', { status: verdict.status });
    const row = { id: crypto.randomBytes(5).toString('hex'), weekStart, weekEnd: weekEndOf(weekStart), user, createdAt: Date.now() };
    const claimed = await getStore().hsetnx('dibs', weekStart, JSON.stringify(row));
    if (!claimed) throw new HttpError(409, 'Someone just took that week.');
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
