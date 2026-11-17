// Web-push helpers. iOS only allows push for apps added to the Home Screen (iOS 16.4+).
import { api } from './api.js';

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const b64ToBytes = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function currentSub() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Snapshot of what this device can do right now. */
export async function status() {
  const s = { supported: supported(), ios: isIOS(), standalone: isStandalone(), permission: supported() ? Notification.permission : 'unsupported', subscribed: false };
  s.needsInstall = s.ios && !s.standalone;
  if (s.supported && !s.needsInstall) s.subscribed = !!(await currentSub()) && s.permission === 'granted';
  return s;
}

export async function enable(publicKey) {
  if (!publicKey) throw new Error('Notifications are not set up on the server yet.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked. Turn them on in your phone settings.' : 'Notifications were not allowed.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  await api('POST', '/api/push', { action: 'subscribe', subscription: sub.toJSON() });
}

export async function disable() {
  const sub = await currentSub();
  if (!sub) return;
  try { await api('POST', '/api/push', { action: 'unsubscribe', endpoint: sub.endpoint }); } catch { /* best effort */ }
  await sub.unsubscribe();
}

/** If this device already has permission + a subscription, make sure the server knows about it. */
export async function resync() {
  const sub = await currentSub();
  if (sub && Notification.permission === 'granted') {
    try { await api('POST', '/api/push', { action: 'subscribe', subscription: sub.toJSON() }); } catch { /* ignore */ }
  }
}

export const sendTest = () => api('POST', '/api/push', { action: 'test' });
