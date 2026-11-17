// The production storage path: Upstash Redis over REST. We can't reach a real one in tests, so this
// spins up a tiny fake that follows real Redis return-value semantics and drives the whole store API.
import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';

const TOKEN = 'test-token';
const data = new Map(); // key -> { t, v, exp }
const alive = (k) => { const e = data.get(k); if (e?.exp && e.exp <= Date.now()) { data.delete(k); return null; } return e ?? null; };

function run([cmd, ...a]) {
  switch (cmd.toUpperCase()) {
    case 'GET': { const e = alive(a[0]); return e ? e.v : null; }
    case 'SET': {
      const [k, v, ...opts] = a; const nx = opts.includes('NX'); const i = opts.indexOf('EX');
      if (nx && alive(k)) return null;
      data.set(k, { t: 's', v: String(v), exp: i >= 0 ? Date.now() + Number(opts[i + 1]) * 1000 : undefined });
      return 'OK';
    }
    case 'DEL': return data.delete(a[0]) ? 1 : 0;
    case 'INCR': { const e = alive(a[0]); const n = (e ? Number(e.v) : 0) + 1; data.set(a[0], { t: 's', v: String(n), exp: e?.exp }); return n; }
    case 'EXPIRE': { const e = alive(a[0]); if (!e) return 0; e.exp = Date.now() + Number(a[1]) * 1000; return 1; }
    case 'HSET': { const e = alive(a[0]) || data.set(a[0], { t: 'h', v: {} }).get(a[0]); const isNew = !(a[1] in e.v); e.v[a[1]] = String(a[2]); return isNew ? 1 : 0; }
    case 'HSETNX': { const e = alive(a[0]) || data.set(a[0], { t: 'h', v: {} }).get(a[0]); if (a[1] in e.v) return 0; e.v[a[1]] = String(a[2]); return 1; }
    case 'HGET': { const e = alive(a[0]); return e?.v[a[1]] ?? null; }
    case 'HDEL': { const e = alive(a[0]); if (!e || !(a[1] in e.v)) return 0; delete e.v[a[1]]; return 1; }
    case 'HGETALL': { const e = alive(a[0]); return e ? Object.entries(e.v).flat() : []; } // real Redis: flat array, [] when missing
    case 'LPUSH': { const e = alive(a[0]) || data.set(a[0], { t: 'l', v: [] }).get(a[0]); e.v.unshift(String(a[1])); return e.v.length; }
    case 'LTRIM': { const e = alive(a[0]); if (e) e.v = e.v.slice(Number(a[1]), Number(a[2]) + 1); return 'OK'; }
    case 'LRANGE': { const e = alive(a[0]); if (!e) return []; const s = Number(a[1]), en = Number(a[2]); return e.v.slice(s, en === -1 ? undefined : en + 1); }
    default: throw new Error('ERR unknown command ' + cmd);
  }
}

let server, store;
before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.statusCode = 401; return res.end('{"error":"Unauthorized"}'); }
      try {
        const cmd = JSON.parse(body);
        assert.ok(Array.isArray(cmd) && cmd.every((x) => typeof x === 'string'), 'all args must be strings');
        res.end(JSON.stringify({ result: run(cmd) }));
      } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
    });
  });
  await new Promise((r) => server.listen(0, r));
  process.env.KV_REST_API_URL = `http://localhost:${server.address().port}`;
  process.env.KV_REST_API_TOKEN = TOKEN;
  process.env.VERCEL = '1'; // prove we're on the Redis path, not the local file fallback
  store = (await import('../api/_lib/store.js')).getStore();
});
after(() => server.close());

test('strings, NX/EX, counters', async () => {
  assert.equal(await store.get('a'), null);
  assert.equal(await store.set('a', 'hello'), 'OK');
  assert.equal(await store.get('a'), 'hello');
  assert.equal(await store.set('lock', '1', { nx: true, ex: 5 }), 'OK');
  assert.equal(await store.set('lock', '1', { nx: true, ex: 5 }), null); // second claimant loses
  assert.equal(await store.del('lock'), 1);
  assert.equal(await store.incr('n'), 1);
  assert.equal(await store.incr('n'), 2);
  assert.equal(await store.expire('n', 60), 1);
  assert.equal(await store.get('n'), '2');
});

test('hashes (dibs table)', async () => {
  assert.equal(await store.hgetall('dibs'), null); // missing -> null, not []
  assert.equal(await store.hsetnx('dibs', '2026-12-04', '{"user":"a"}'), 1);
  assert.equal(await store.hsetnx('dibs', '2026-12-04', '{"user":"b"}'), 0); // atomic claim
  await store.hset('dibs', '2026-12-11', '{"user":"b"}');
  assert.deepEqual(await store.hgetall('dibs'), { '2026-12-04': '{"user":"a"}', '2026-12-11': '{"user":"b"}' });
  assert.equal(await store.hget('dibs', '2026-12-04'), '{"user":"a"}');
  assert.equal(await store.hdel('dibs', '2026-12-04'), 1);
  assert.equal(await store.hdel('dibs', '2026-12-04'), 0);
});

test('lists (notification feed)', async () => {
  for (let i = 1; i <= 5; i++) await store.lpush('notes', `n${i}`);
  await store.ltrim('notes', 0, 2);
  assert.deepEqual(await store.lrange('notes', 0, -1), ['n5', 'n4', 'n3']);
  assert.deepEqual(await store.lrange('missing', 0, 29), []);
});

test('bad token surfaces a clear error', async () => {
  process.env.KV_REST_API_TOKEN = 'wrong';
  await assert.rejects(() => store.get('a'), /Redis error/);
  process.env.KV_REST_API_TOKEN = TOKEN;
});
