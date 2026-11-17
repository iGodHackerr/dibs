// End-to-end: real HTTP against the dev server, real file store in a temp dir.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

const PORT = 3100 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dibs-test-'));
const PW = { iGodHackerr: 'one-Strong-test-pass', KingOfWord: 'two-Strong-test-pass' };
let server;

class Client {
  constructor() { this.cookie = ''; }
  async req(method, url, body, { headers = {}, csrf = true } = {}) {
    const res = await fetch(BASE + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-Requested-With': 'dibs' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  login(username) { return this.req('POST', '/api/session', { username, password: PW[username] }); }
}

before(async () => {
  server = spawn(process.execPath, ['scripts/dev-server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      PATH: process.env.PATH, PORT: String(PORT), DATA_FILE: path.join(dir, 'db.json'),
      SESSION_SECRET: 'x'.repeat(64), CRON_SECRET: 'cron-secret-for-tests',
      PASSWORD_IGODHACKERR: PW.iGodHackerr, PASSWORD_KINGOFWORD: PW.KingOfWord,
      FAKE_TODAY: '2026-11-30', DIBS_OPEN_FROM: '2026-11-27', APP_TIMEZONE: 'Asia/Kolkata',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + '/'); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});
after(() => { server?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

test('serves the app shell', async () => {
  const r = await fetch(BASE + '/');
  assert.equal(r.status, 200);
});

test('state requires login', async () => {
  const r = await new Client().req('GET', '/api/state');
  assert.equal(r.status, 401);
});

test('login: wrong password rejected, usernames case-insensitive, cookie is HttpOnly', async () => {
  const c = new Client();
  assert.equal((await c.req('POST', '/api/session', { username: 'iGodHackerr', password: 'nope' })).status, 401);
  assert.equal((await c.req('POST', '/api/session', { username: 'nobody', password: 'nope' })).status, 401);
  const ok = await c.req('POST', '/api/session', { username: 'igodhackerr', password: PW.iGodHackerr });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user, 'iGodHackerr');
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
  assert.match(ok.headers.get('set-cookie'), /SameSite=Lax/);
});

test('mutations without the CSRF header are refused', async () => {
  const c = new Client();
  const r = await c.req('POST', '/api/session', { username: 'iGodHackerr', password: PW.iGodHackerr }, { csrf: false });
  assert.equal(r.status, 403);
});

test('calling dibs: rules, notifications, quota, release', async () => {
  const a = new Client(), b = new Client();
  await a.login('iGodHackerr'); await b.login('KingOfWord');

  let s = (await a.req('GET', '/api/state')).data;
  assert.equal(s.today, '2026-11-30');
  assert.equal(s.me, 'iGodHackerr');
  assert.equal(s.other, 'KingOfWord');

  // wrong day of week
  assert.equal((await a.req('POST', '/api/dibs', { weekStart: '2026-12-05' })).status, 400);
  // locked week (starts before 27 Nov)
  assert.equal((await a.req('POST', '/api/dibs', { weekStart: '2026-11-20' })).status, 409);
  // too far ahead (today = Mon 30 Nov, current week = Fri 27 Nov, +5 weeks = 1 Jan)
  const far = await a.req('POST', '/api/dibs', { weekStart: '2027-01-01' });
  assert.equal(far.status, 409);
  assert.equal(far.data.status, 'far');

  // happy path
  const first = await a.req('POST', '/api/dibs', { weekStart: '2026-12-04' });
  assert.equal(first.status, 200);
  assert.equal(first.data.state.weeks['2026-12-04'].status, 'mine');

  // the other person sees it as "theirs" and was notified
  s = (await b.req('GET', '/api/state')).data;
  assert.equal(s.weeks['2026-12-04'].status, 'theirs');
  assert.equal(s.unread, 1);
  assert.match(s.notifications[0].title, /iGodHackerr called dibs/);
  assert.match(s.notifications[0].body, /Fri 4 Dec → Thu 10 Dec/);

  // can't take someone else's week
  const clash = await b.req('POST', '/api/dibs', { weekStart: '2026-12-04' });
  assert.equal(clash.status, 409);
  // can't release someone else's dibs
  assert.equal((await b.req('DELETE', '/api/dibs?weekStart=2026-12-04')).status, 403);

  // second dibs ok, third in the same month is blocked
  assert.equal((await a.req('POST', '/api/dibs', { weekStart: '2026-12-11' })).status, 200);
  const third = await a.req('POST', '/api/dibs', { weekStart: '2026-12-18' });
  assert.equal(third.status, 409);
  assert.equal(third.data.status, 'quota');
  // ...but the other person still has their own two
  assert.equal((await b.req('POST', '/api/dibs', { weekStart: '2026-12-18' })).status, 200);

  // mark as read
  await b.req('POST', '/api/notifications');
  assert.equal((await b.req('GET', '/api/state')).data.unread, 0);

  // release frees the slot & notifies the other person
  assert.equal((await a.req('DELETE', '/api/dibs?weekStart=2026-12-11')).status, 200);
  assert.equal((await a.req('POST', '/api/dibs', { weekStart: '2026-12-25' })).status, 200); // December quota is free again
  s = (await b.req('GET', '/api/state')).data;
  assert.ok(s.notifications.some((n) => /let go of their dibs/.test(n.title)));
});

test('change password: validation, old password dies, other devices are signed out', async () => {
  const phone = new Client(), laptop = new Client();
  await phone.login('KingOfWord'); await laptop.login('KingOfWord');

  assert.equal((await phone.req('POST', '/api/password', { current: 'wrong', next: 'brand-new-password-1' })).status, 403);
  assert.equal((await phone.req('POST', '/api/password', { current: PW.KingOfWord, next: 'short' })).status, 400);
  assert.equal((await phone.req('POST', '/api/password', { current: PW.KingOfWord, next: PW.KingOfWord })).status, 400);

  const ok = await phone.req('POST', '/api/password', { current: PW.KingOfWord, next: 'brand-new-password-1' });
  assert.equal(ok.status, 200);

  assert.equal((await phone.req('GET', '/api/state')).status, 200);   // this device stays in
  assert.equal((await laptop.req('GET', '/api/state')).status, 401);  // the other is out
  assert.equal((await new Client().req('POST', '/api/session', { username: 'KingOfWord', password: PW.KingOfWord })).status, 401);
  assert.equal((await new Client().req('POST', '/api/session', { username: 'KingOfWord', password: 'brand-new-password-1' })).status, 200);
});

test('push subscribe validates input', async () => {
  const c = new Client(); await c.login('iGodHackerr');
  assert.equal((await c.req('POST', '/api/push', { action: 'subscribe', subscription: { endpoint: 'http://x' } })).status, 400);
  const good = { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'p', auth: 'a' } };
  const r = await c.req('POST', '/api/push', { action: 'subscribe', subscription: good });
  assert.equal(r.status, 200);
  assert.equal(r.data.devices, 1);
  assert.equal((await c.req('POST', '/api/push', { action: 'unsubscribe', endpoint: good.endpoint })).data.devices, 0);
});

test('cron endpoint needs the secret', async () => {
  const c = new Client();
  assert.equal((await c.req('GET', '/api/cron')).status, 401);
  assert.equal((await c.req('GET', '/api/cron', undefined, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  const ok = await c.req('GET', '/api/cron', undefined, { headers: { Authorization: 'Bearer cron-secret-for-tests' } });
  assert.equal(ok.status, 200);
});

test('login is rate limited after repeated failures', async () => {
  const c = new Client();
  let last;
  for (let i = 0; i < 9; i++) last = await c.req('POST', '/api/session', { username: 'KingOfWord', password: 'bad' + i });
  assert.equal(last.status, 429);
});
