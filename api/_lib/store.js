// Tiny key-value layer. Production = Upstash Redis over its REST API (free tier on the Vercel
// Marketplace). Local dev = a JSON file in .data/. Every value is a plain string; callers JSON.parse.
import fs from 'node:fs';
import path from 'node:path';

const REST_URL = () => process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const REST_TOKEN = () => process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';

/* ───────────── Upstash REST ───────────── */
async function cmd(...args) {
  const res = await fetch(REST_URL(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${REST_TOKEN()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args.map((a) => (typeof a === 'number' ? String(a) : a))),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`Redis error: ${data.error || res.status}`);
  return data.result;
}
const pairs = (r) => {
  if (!r) return null;
  if (!Array.isArray(r)) return Object.keys(r).length ? r : null;
  if (!r.length) return null;
  const o = {};
  for (let i = 0; i < r.length; i += 2) o[r[i]] = r[i + 1];
  return o;
};

const redisStore = {
  get: (k) => cmd('GET', k),
  async set(k, v, { nx, ex } = {}) {
    const a = ['SET', k, String(v)];
    if (nx) a.push('NX');
    if (ex) a.push('EX', ex);
    return cmd(...a);
  },
  del: (k) => cmd('DEL', k),
  incr: (k) => cmd('INCR', k),
  expire: (k, s) => cmd('EXPIRE', k, s),
  async hgetall(k) { return pairs(await cmd('HGETALL', k)); },
  hget: (k, f) => cmd('HGET', k, f),
  hset: (k, f, v) => cmd('HSET', k, f, String(v)),
  hsetnx: (k, f, v) => cmd('HSETNX', k, f, String(v)),
  hdel: (k, f) => cmd('HDEL', k, f),
  lpush: (k, v) => cmd('LPUSH', k, String(v)),
  ltrim: (k, s, e) => cmd('LTRIM', k, s, e),
  lrange: (k, s, e) => cmd('LRANGE', k, s, e),
};

/* ───────────── Local JSON file (dev & tests only) ───────────── */
function fileStore(file) {
  let db = {};
  try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { db = {}; }
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, file);
  };
  const live = (k) => {
    const e = db[k];
    if (!e) return null;
    if (e.exp && e.exp <= Date.now()) { delete db[k]; return null; }
    return e;
  };
  const hash = (k) => { const e = live(k); return e && e.t === 'h' ? e : (db[k] = { t: 'h', v: {} }); };
  const list = (k) => { const e = live(k); return e && e.t === 'l' ? e : (db[k] = { t: 'l', v: [] }); };
  return {
    async get(k) { const e = live(k); return e && e.t === 's' ? e.v : null; },
    async set(k, v, { nx, ex } = {}) {
      if (nx && live(k)) return null;
      db[k] = { t: 's', v: String(v), exp: ex ? Date.now() + ex * 1000 : undefined };
      save(); return 'OK';
    },
    async del(k) { const had = !!live(k); delete db[k]; save(); return had ? 1 : 0; },
    async incr(k) {
      const e = live(k);
      const n = (e ? Number(e.v) : 0) + 1;
      db[k] = { t: 's', v: String(n), exp: e && e.exp }; save(); return n;
    },
    async expire(k, s) { const e = live(k); if (e) { e.exp = Date.now() + s * 1000; save(); } return e ? 1 : 0; },
    async hgetall(k) { const e = live(k); return e && e.t === 'h' && Object.keys(e.v).length ? { ...e.v } : null; },
    async hget(k, f) { const e = live(k); return e && e.t === 'h' ? e.v[f] ?? null : null; },
    async hset(k, f, v) { hash(k).v[f] = String(v); save(); return 1; },
    async hsetnx(k, f, v) { const h = hash(k); if (f in h.v) return 0; h.v[f] = String(v); save(); return 1; },
    async hdel(k, f) { const h = hash(k); const had = f in h.v; delete h.v[f]; save(); return had ? 1 : 0; },
    async lpush(k, v) { list(k).v.unshift(String(v)); save(); return 1; },
    async ltrim(k, s, e) { const l = list(k); l.v = l.v.slice(s, e + 1); save(); return 'OK'; },
    async lrange(k, s, e) { const e0 = live(k); if (!e0 || e0.t !== 'l') return []; return e0.v.slice(s, e === -1 ? undefined : e + 1); },
  };
}

let local;
export function getStore() {
  if (REST_URL() && REST_TOKEN()) return redisStore;
  if (process.env.VERCEL) {
    throw new Error('No database configured. In Vercel: Storage -> add "Upstash Redis" and connect it to this project, then redeploy.');
  }
  return (local ||= fileStore(process.env.DATA_FILE || path.join(process.cwd(), '.data', 'db.json')));
}
