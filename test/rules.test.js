import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, dow, isWeekStart, nice, weekEndOf, weekStartOf } from '../api/_lib/dates.js';
import { evaluateWeek } from '../api/_lib/rules.js';

const OPEN = '2026-11-27';
const ev = (weekStart, today, dibs = [], me = 'iGodHackerr') =>
  evaluateWeek({ weekStart, today, me, openFrom: OPEN, dibsByWeek: Object.fromEntries(dibs.map((d) => [d.weekStart, d])) });
const dib = (weekStart, user) => ({ weekStart, weekEnd: weekEndOf(weekStart), user });

test('weeks run Friday -> Thursday', () => {
  assert.equal(weekStartOf('2026-11-17'), '2026-11-13'); // Tue -> Fri before
  assert.equal(weekEndOf('2026-11-13'), '2026-11-19');   // ...ends Thursday
  assert.equal(weekStartOf('2026-11-19'), '2026-11-13'); // Thursday is still the old week
  assert.equal(weekStartOf('2026-11-20'), '2026-11-20'); // Friday starts a new week
  assert.equal(dow(weekEndOf('2026-11-20')), 4);         // always Thursday
  assert.ok(isWeekStart('2026-11-27'));
  assert.equal(nice('2026-11-27'), 'Fri 27 Nov');
});

test('this week and next week are free-for-all until 27 Nov', () => {
  assert.equal(ev('2026-11-13', '2026-11-17').status, 'locked');
  assert.equal(ev('2026-11-20', '2026-11-17').status, 'locked');
  assert.equal(ev('2026-11-27', '2026-11-17').status, 'open');
  assert.equal(ev('2026-11-27', '2026-11-17').canBook, true);
});

test('cannot call dibs more than 4 weeks ahead', () => {
  const today = '2026-11-17'; // current week = Fri 13 Nov
  assert.equal(ev('2026-12-11', today).status, 'open'); // +4 weeks
  const far = ev('2026-12-18', today);                  // +5 weeks
  assert.equal(far.status, 'far');
  assert.equal(far.opensOn, '2026-11-20');
  assert.equal(far.canBook, false);
});

test('two dibs per month, counted by the week start month', () => {
  const today = '2026-12-02';
  const mine = [dib('2026-12-04', 'iGodHackerr'), dib('2026-12-11', 'iGodHackerr')];
  assert.equal(ev('2026-12-18', today, mine).status, 'quota');
  assert.equal(ev('2026-12-18', today, mine, 'KingOfWord').status, 'open'); // other person unaffected
  // a week that STARTS in January counts toward January even though it begins at the end of the year
  assert.equal(ev('2027-01-01', '2026-12-30', mine).status, 'open');
  // the other person's dibs don't use my quota
  assert.equal(ev('2026-12-18', today, [dib('2026-12-04', 'KingOfWord'), dib('2026-12-11', 'KingOfWord')]).status, 'open');
});

test('mine / theirs / past / release rights', () => {
  const today = '2026-12-02'; // inside week Fri 27 Nov -> Thu 3 Dec
  const m = ev('2026-11-27', today, [dib('2026-11-27', 'iGodHackerr')]);
  assert.deepEqual([m.status, m.canRelease, m.past], ['mine', true, false]);
  const t = ev('2026-12-04', today, [dib('2026-12-04', 'KingOfWord')]);
  assert.deepEqual([t.status, t.canRelease, t.canBook], ['theirs', false, false]);
  const p = ev('2026-11-20', today);
  assert.deepEqual([p.status, p.past], ['past', true]);
  const pm = ev('2026-11-20', today, [dib('2026-11-20', 'iGodHackerr')]);
  assert.deepEqual([pm.status, pm.canRelease], ['mine', false]); // finished dibs can't be released
});

test('a booked week stays booked even before the open date (data is data)', () => {
  assert.equal(ev('2026-11-20', '2026-11-17', [dib('2026-11-20', 'KingOfWord')]).status, 'theirs');
});

test('addDays crosses month/year boundaries', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
});
