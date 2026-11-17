import assert from 'node:assert/strict';
import test from 'node:test';
import { clock12, dayIdx, nowIn, parseHM, toHM } from '../api/_lib/dates.js';
import { evaluateWeek } from '../api/_lib/rules.js';
import { blockingSession, checkSession, dayStatus, describe, endOf, horizon, nowIdx } from '../api/_lib/sessions.js';

const ME = 'iGodHackerr', THEM = 'KingOfWord';
// Today = Mon 30 Nov 2026, 10:00. Current week = Fri 27 Nov -> Thu 3 Dec.
const base = { today: '2026-11-30', nowMin: 600, dibsByWeek: {}, sessionsByDate: {}, me: ME };
const sess = (date, start, user = THEM) => ({ id: date, date, start, user });

test('clock helpers', () => {
  assert.equal(parseHM('15:00'), 900);
  assert.equal(parseHM('24:00'), null);
  assert.equal(parseHM('9:00'), null);
  assert.equal(toHM(905), '15:05');
  assert.equal(clock12(0), '12:00 AM');
  assert.equal(clock12(12 * 60), '12:00 PM');
  assert.equal(clock12(15 * 60 + 5), '3:05 PM');
  assert.equal(clock12(23 * 60 + 59), '11:59 PM');
  assert.equal(dayIdx('1970-01-02'), 1);
  const n = nowIn('Asia/Kolkata');
  assert.match(n.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(n.secs >= 0 && n.secs < 86400);
});

test('a session is 5 hours and can run past midnight', () => {
  assert.deepEqual(endOf('2026-12-01', 15 * 60), { date: '2026-12-01', min: 20 * 60 });
  assert.deepEqual(endOf('2026-12-01', 22 * 60), { date: '2026-12-02', min: 3 * 60 });
  assert.equal(describe(sess('2026-12-01', '15:00')), 'Tue 1 Dec · 3:00 PM → 8:00 PM');
  assert.equal(describe(sess('2026-12-01', '22:00')), 'Tue 1 Dec · 10:00 PM → 3:00 AM (Wed 2 Dec)');
});

test('free day, past day, far day', () => {
  assert.equal(dayStatus({ ...base, date: '2026-12-01' }).status, 'free');
  assert.equal(dayStatus({ ...base, date: '2026-11-29' }).status, 'past');
  // current week = Fri 27 Nov; +4 weeks = Fri 25 Dec .. Thu 31 Dec is the last bookable day
  assert.equal(horizon('2026-11-30'), '2026-12-31');
  assert.equal(dayStatus({ ...base, date: '2026-12-31' }).status, 'free');
  assert.equal(dayStatus({ ...base, date: '2027-01-01' }).status, 'far');
});

test('only one session a day, shared by both of you', () => {
  const sessionsByDate = { '2026-12-01': sess('2026-12-01', '15:00') };
  const r = checkSession({ ...base, sessionsByDate, date: '2026-12-01', startMin: 9 * 60 });
  assert.equal(r.ok, false);
  assert.equal(r.status, 'taken');
  assert.match(r.reason, /one session a day/);
  assert.equal(dayStatus({ ...base, sessionsByDate, date: '2026-12-01' }).session.user, THEM);
});

test('no sessions on a week with weekly dibs (yours or theirs)', () => {
  const dibsByWeek = { '2026-12-04': { weekStart: '2026-12-04', user: THEM } };
  const theirs = checkSession({ ...base, dibsByWeek, date: '2026-12-06', startMin: 900 });
  assert.equal(theirs.ok, false); assert.equal(theirs.status, 'dib');
  const mine = checkSession({ ...base, dibsByWeek: { '2026-12-04': { weekStart: '2026-12-04', user: ME } }, date: '2026-12-06', startMin: 900 });
  assert.equal(mine.ok, false); assert.equal(mine.status, 'dib');
  // the week before is untouched (Thu 3 Dec is still the old week)
  assert.equal(checkSession({ ...base, dibsByWeek, date: '2026-12-03', startMin: 600 }).ok, true);
});

test('a session may not start in the past, but "now" works', () => {
  assert.equal(checkSession({ ...base, date: '2026-11-30', startMin: 9 * 60 }).ok, false);
  assert.equal(checkSession({ ...base, date: '2026-11-30', startMin: 600 }).ok, true);
  assert.equal(checkSession({ ...base, date: '2026-11-30', startMin: 598 }).ok, true);   // within the grace window
  assert.equal(checkSession({ ...base, date: '2026-12-01', startMin: 0 }).ok, true);    // other days: any time
});

test('sessions must not overlap, even across midnight', () => {
  const sessionsByDate = { '2026-12-02': sess('2026-12-02', '22:00') }; // runs until 3:00 AM on the 3rd
  assert.equal(checkSession({ ...base, sessionsByDate, date: '2026-12-03', startMin: 2 * 60 }).status, 'overlap');
  assert.equal(checkSession({ ...base, sessionsByDate, date: '2026-12-03', startMin: 3 * 60 }).ok, true);        // touching is fine
  // the other direction: my session would run into a session that starts early the next day
  const next = { '2026-12-03': sess('2026-12-03', '01:00') };
  assert.equal(checkSession({ ...base, sessionsByDate: next, date: '2026-12-02', startMin: 22 * 60 }).status, 'overlap');
  assert.equal(checkSession({ ...base, sessionsByDate: next, date: '2026-12-02', startMin: 20 * 60 }).ok, true);
});

test('a late session cannot spill into a week the other person has dibs on', () => {
  // Thu 3 Dec 11 PM -> 4 AM Fri 4 Dec, and KingOfWord holds the week starting Fri 4 Dec
  const dibsByWeek = { '2026-12-04': { weekStart: '2026-12-04', user: THEM } };
  assert.equal(checkSession({ ...base, dibsByWeek, date: '2026-12-03', startMin: 23 * 60 }).status, 'dib');
  assert.equal(checkSession({ ...base, dibsByWeek, date: '2026-12-03', startMin: 18 * 60 }).ok, true); // ends 11 PM, fine
});

test("someone else's unfinished session blocks claiming that week; finished or own sessions don't", () => {
  const ws = '2026-12-04';
  const sessionsByDate = { '2026-12-06': sess('2026-12-06', '15:00', THEM) };
  const args = { today: '2026-11-30', openFrom: '2026-11-27', me: ME, dibsByWeek: {} };
  const nowIndex = nowIdx('2026-11-30', 600);
  assert.equal(evaluateWeek({ ...args, weekStart: ws, sessionsByDate, nowIndex }).status, 'busy');
  assert.equal(evaluateWeek({ ...args, weekStart: ws, sessionsByDate, nowIndex }).canBook, false);
  assert.match(evaluateWeek({ ...args, weekStart: ws, sessionsByDate, nowIndex }).reason, /KingOfWord has a session on Sun 6 Dec/);
  assert.equal(evaluateWeek({ ...args, weekStart: ws, sessionsByDate: { '2026-12-06': sess('2026-12-06', '15:00', ME) }, nowIndex }).status, 'open');
  // once the session is over, the week is claimable again
  const later = nowIdx('2026-12-06', 21 * 60);
  assert.equal(evaluateWeek({ ...args, weekStart: ws, sessionsByDate, nowIndex: later }).status, 'open');
  // a Thursday-night session that spills into Friday also blocks the following week
  const spill = { '2026-12-03': sess('2026-12-03', '23:00', THEM) };
  assert.ok(blockingSession({ weekStart: ws, sessionsByDate: spill, me: ME, nowIndex }));
});
