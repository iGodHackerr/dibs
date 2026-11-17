// In-app notification feed + Web Push delivery.
import crypto from 'node:crypto';
import webpush from 'web-push';
import { HttpError } from './http.js';
import { getStore } from './store.js';

const MAX_SUBS = 8;

function configure(req) {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  // The push services want a contact URL. We use this site's own address, so no personal data leaves.
  const host = req?.headers?.host || '';
  const subject = process.env.VAPID_SUBJECT || (host && !/^(localhost|127\.)/.test(host) ? `https://${host}` : 'https://example.com');
  webpush.setVapidDetails(subject, pub, priv);
  return true;
}

export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY || '';

const subId = (endpoint) => crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 20);

export async function saveSubscription(user, sub, ua = '') {
  const ok = sub && typeof sub.endpoint === 'string' && /^https:\/\//.test(sub.endpoint) && sub.endpoint.length < 1000
    && sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string';
  if (!ok) throw new HttpError(400, 'That notification subscription looks invalid.');
  const store = getStore();
  const key = 'push:' + user;
  const existing = (await store.hgetall(key)) || {};
  const entries = Object.entries(existing).map(([id, v]) => [id, JSON.parse(v)]).sort((a, b) => a[1].createdAt - b[1].createdAt);
  while (entries.length >= MAX_SUBS) { const [old] = entries.shift(); await store.hdel(key, old); }
  await store.hset(key, subId(sub.endpoint), JSON.stringify({
    endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, ua: String(ua).slice(0, 160), createdAt: Date.now(),
  }));
}

export async function removeSubscription(user, endpoint) {
  if (typeof endpoint === 'string') await getStore().hdel('push:' + user, subId(endpoint));
}

export async function subscriptionCount(user) {
  return Object.keys((await getStore().hgetall('push:' + user)) || {}).length;
}

async function sendPush(user, payload, req) {
  if (!configure(req)) return { sent: 0, failed: 0 };
  const store = getStore();
  const subs = (await store.hgetall('push:' + user)) || {};
  let sent = 0, failed = 0;
  await Promise.all(Object.entries(subs).map(async ([id, raw]) => {
    try {
      await webpush.sendNotification(JSON.parse(raw), JSON.stringify(payload), { TTL: 60 * 60 * 12, urgency: 'high', timeout: 8000 });
      sent++;
    } catch (e) {
      failed++;
      if (e.statusCode === 404 || e.statusCode === 410) await store.hdel('push:' + user, id); // device unsubscribed
      else console.warn('push failed', e.statusCode || e.message);
    }
  }));
  return { sent, failed };
}

/** Store an in-app notification for `user` and push it to their devices. Never throws. */
export async function notify(user, { type, title, body, url = '/#activity' }, req) {
  const store = getStore();
  const entry = { id: crypto.randomBytes(6).toString('hex'), type, title, body, ts: Date.now() };
  let push = { sent: 0, failed: 0 };
  try {
    await store.lpush('notes:' + user, JSON.stringify(entry));
    await store.ltrim('notes:' + user, 0, 49);
    push = await sendPush(user, { ...entry, url, tag: entry.id }, req);
  } catch (e) {
    console.error('notify failed', e);
  }
  return { entry, push };
}

export async function recentNotes(user, n = 30) {
  const raw = await getStore().lrange('notes:' + user, 0, n - 1);
  return raw.map((r) => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
}

export async function unreadCount(user, notes) {
  const seen = Number((await getStore().get('seen:' + user)) || 0);
  return notes.filter((n) => n.ts > seen).length;
}

export const markSeen = (user) => getStore().set('seen:' + user, String(Date.now()));

/** Test notification sent to the caller's own devices. */
export async function sendTest(user, req) {
  return sendPush(user, {
    id: 'test-' + Date.now(), type: 'test', title: 'Notifications are working 🎉',
    body: 'You will be pinged when dibs are called or about to end.', url: '/', tag: 'test', ts: Date.now(),
  }, req);
}
