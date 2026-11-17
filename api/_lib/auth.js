// Sessions = HMAC-signed cookie. Passwords = env value until changed in-app, then a scrypt hash in the DB.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { SESSION_DAYS, canonicalUser, envPasswordFor } from './config.js';
import { HttpError } from './http.js';
import { getStore } from './store.js';

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'dibs_session';

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET is missing or too short (need 32+ chars).');
  return s;
};
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const hmac = (data) => crypto.createHmac('sha256', secret()).update(data).digest();

export function signToken(payload) {
  const body = b64u(JSON.stringify(payload));
  return `${body}.${b64u(hmac(body))}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const good = hmac(body);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== good.length || !crypto.timingSafeEqual(given, good)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}

export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https' || !!process.env.VERCEL;

export async function issueSession(res, req, user) {
  const store = getStore();
  const sv = Number((await store.get('sv:' + user)) || 0);
  const maxAge = SESSION_DAYS * 86400;
  const token = signToken({ u: user, sv, iat: Date.now(), exp: Date.now() + maxAge * 1000 });
  res.setHeader('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`);
}

export function clearSession(res, req) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`);
}

/** Returns the logged-in username or null. Also refreshes old sessions so you stay signed in. */
export async function getUser(req, res) {
  const p = verifyToken(parseCookies(req)[COOKIE]);
  if (!p) return null;
  const user = canonicalUser(p.u);
  if (!user) return null;
  const current = Number((await getStore().get('sv:' + user)) || 0);
  if (p.sv !== current) return null; // password was changed -> old logins are dead
  if (res && Date.now() - p.iat > 7 * 86400000) await issueSession(res, req, user);
  return user;
}

export async function requireUser(req, res) {
  const user = await getUser(req, res);
  if (!user) throw new HttpError(401, 'Please sign in.');
  return user;
}

/* ── passwords ── */
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function checkHash(record, pw) {
  const [, salt, hash] = String(record).split('$');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(pw, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(key, expected);
}

export async function verifyPassword(user, pw) {
  if (typeof pw !== 'string' || !pw || pw.length > 256) return false;
  const record = await getStore().get('pw:' + user);
  if (record) return checkHash(record, pw);
  const fromEnv = envPasswordFor(user);
  return !!fromEnv && safeEqual(fromEnv, pw);
}

export async function setPassword(user, pw) {
  const store = getStore();
  await store.set('pw:' + user, await hashPassword(pw));
  await store.incr('sv:' + user); // signs out every other device
}

/* ── brute-force guard ── */
export const clientIp = (req) =>
  String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();

export async function failuresOf(key) { return Number((await getStore().get(key)) || 0); }
export async function recordFailure(key, windowSec) {
  const store = getStore();
  const n = await store.incr(key);
  if (n === 1) await store.expire(key, windowSec);
  return n;
}
