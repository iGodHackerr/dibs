// End-to-end for 5-hour play sessions: real HTTP against the dev server (own instance + temp DB).
// Pretend it is Mon 30 Nov 2026, 10:00 in India.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

const PORT = 4100 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dibs-plays-'));
const PW = { iGodHackerr: 'one-Strong-test-pass', KingOfWord: 'two-Strong-test-pass' };
let server;

class Client {
  constructor() { this.cookie = ''; }
  async req(method, url, body) {
    const res = await fetch(BASE + url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'dibs', ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  async login(u) { await this.req('POST', '/api/session', { username: u, password: PW[u] }); return this; }
  book(date, start) { return this.req('POST', '/api/plays', { date, start }); }
  cancel(date) { return this.req('DELETE', `/api/plays?date=${date}`); }
  state() { return this.req('GET', '/api/state').then((r) => r.data); }
}

before(async () => {
  server = spawn(process.execPath, ['scripts/dev-server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      PATH: process.env.PATH, PORT: String(PORT), DATA_FILE: path.join(dir, 'db.json'),
      SESSION_SECRET: 'y'.repeat(64), CRON_SECRET: 'cron-secret-for-tests',
      PASSWORD_IGODHACKERR: PW.iGodHackerr, PASSWORD_KINGOFWORD: PW.KingOfWord,
      FAKE_TODAY: '2026-11-30', FAKE_MINUTES: '600', DIBS_OPEN_FROM: '2026-11-27', APP_TIMEZONE: 'Asia/Kolkata',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + '/'); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});
after(() => { server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

test('booking a session tells the other person when it starts and ends', async () => {
  const a = await new Client().login('iGodHackerr');
  const b = await new Client().login('KingOfWord');

  const s0 = await a.state();
  assert.equal(s0.nowSecs, 36000);
  assert.equal(s0.config.sessionHours, 5);
  assert.deepEqual(s0.sessions, []);

  const r = await a.book('2026-11-30', '15:00');
  assert.equal(r.status, 200);
  assert.equal(r.data.state.sessions.length, 1);
  assert.deepEqual(
    { ...r.data.state.sessions[0], id: undefined, createdAt: undefined },
    { id: undefined, date: '2026-11-30', start: '15:00', end: '20:00', endDate: '2026-11-30', user: 'iGodHackerr', createdAt: undefined },
  );

  const sb = await b.state();
  assert.equal(sb.sessions[0].user, 'iGodHackerr');
  assert.equal(sb.unread, 1);
  assert.equal(sb.notifications[0].type, 'session-booked');
  assert.match(sb.notifications[0].title, /iGodHackerr will start a session at 3:00 PM/);
  assert.match(sb.notifications[0].body, /Mon 30 Nov · 3:00 PM → 8:00 PM/);
  // the booker is not notified about their own booking
  assert.equal((await a.state()).notifications.length, 0);
});

test('one session a day, nothing in the past, sane input', async () => {
  const a = await new Client().login('iGodHackerr');
  const b = await new Client().login('KingOfWord');

  const taken = await b.book('2026-11-30', '21:00');
  assert.equal(taken.status, 409);
  assert.match(taken.data.error, /one session a day/);

  assert.equal((await a.book('2026-12-01', '25:00')).status, 400);
  assert.equal((await a.book('2026-12-01', '3pm')).status, 400);
  assert.equal((await a.book('tomorrow', '15:00')).status, 400);
  assert.equal((await a.book('2026-11-29', '15:00')).status, 409);   // yesterday
  assert.equal((await a.book('2027-01-01', '15:00')).status, 409);   // beyond 4 weeks
  assert.equal((await new Client().book('2026-12-01', '15:00')).status, 401);
});

test('sessions cannot overlap, even across midnight (touching is fine)', async () => {
  const a = await new Client().login('iGodHackerr');
  const b = await new Client().login('KingOfWord');
  assert.equal((await a.book('2026-12-02', '22:00')).status, 200); // until 3:00 AM on the 3rd
  const clash = await b.book('2026-12-03', '02:00');
  assert.equal(clash.status, 409);
  assert.match(clash.data.error, /overlaps your|overlaps iGodHackerr's/);
  assert.equal((await b.book('2026-12-03', '03:00')).status, 200);
});

test('weekly dibs and sessions keep out of each other\'s way', async () => {
  const a = await new Client().login('iGodHackerr');
  const b = await new Client().login('KingOfWord');

  // week Fri 4 Dec: iGodHackerr calls dibs -> nobody can book sessions inside it
  assert.equal((await a.req('POST', '/api/dibs', { weekStart: '2026-12-04' })).status, 200);
  const blocked = await b.book('2026-12-06', '15:00');
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /weekly dibs/);
  assert.equal((await a.book('2026-12-06', '15:00')).status, 409);

  // week Fri 11 Dec: KingOfWord books a session first -> iGodHackerr can't claim that week
  assert.equal((await b.book('2026-12-12', '16:00')).status, 200);
  const busy = await a.req('POST', '/api/dibs', { weekStart: '2026-12-11' });
  assert.equal(busy.status, 409);
  assert.equal(busy.data.status, 'busy');
  assert.equal((await a.state()).weeks['2026-12-11'].status, 'busy');

  // ...but the session holder can claim it, which folds their session into the dibs
  assert.equal((await b.req('POST', '/api/dibs', { weekStart: '2026-12-11' })).status, 200);
  assert.equal((await b.state()).sessions.some((s) => s.date === '2026-12-12'), false);

  // once the session is cancelled the week is free again
  assert.equal((await b.book('2026-12-19', '10:00')).status, 200);
  assert.equal((await a.state()).weeks['2026-12-18'].status, 'busy');
  assert.equal((await b.cancel('2026-12-19')).status, 200);
  assert.equal((await a.state()).weeks['2026-12-18'].status, 'open');
});

test('cancelling: only your own, only before it starts, and the other person is told', async () => {
  const a = await new Client().login('iGodHackerr');
  const b = await new Client().login('KingOfWord');
  assert.equal((await a.book('2026-12-22', '18:30')).status, 200);

  assert.equal((await b.cancel('2026-12-22')).status, 403);   // not yours
  assert.equal((await a.cancel('2026-12-23')).status, 404);   // nothing there
  assert.equal((await a.cancel('2026-11-30')).status, 200);   // 15:00 session, it is only 10:00

  const sb = await b.state();
  assert.equal(sb.notifications[0].type, 'session-cancelled');
  assert.match(sb.notifications[0].title, /iGodHackerr cancelled their session/);
  assert.match(sb.notifications[0].body, /Mon 30 Nov · 3:00 PM → 8:00 PM is free again/);

  // the day is bookable again, but not at a time that has already gone by (it is 10:00)
  const past = await b.book('2026-11-30', '08:00');
  assert.equal(past.status, 409);
  assert.match(past.data.error, /already passed/);
  assert.equal((await b.book('2026-11-30', '11:00')).status, 200);
});
