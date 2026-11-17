import { icon } from './icons.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── toast: iOS-style banner dropping from the top ── */
export function toast({ title, body = '', icon: ic = 'bell', tone = 'purple' }, { ms = 5200, onTap } = {}) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast glass';
  el.setAttribute('role', 'status');
  const bg = { purple: 'linear-gradient(145deg,#9b8cff,#6d4aff)', green: 'linear-gradient(145deg,#5eead4,#10b981)', red: 'linear-gradient(145deg,#ff8f9e,#ff3d63)', orange: 'linear-gradient(145deg,#ffc27a,#ff7a2f)', blue: 'linear-gradient(145deg,#5ad2ff,#1d8cff)' }[tone];
  el.innerHTML = `<div class="ico" style="background:${bg}">${icon(ic)}</div><div class="tx"><b>${esc(title)}</b>${body ? `<p>${esc(body)}</p>` : ''}</div>`;
  host.appendChild(el);
  const close = () => { if (el.classList.contains('out')) return; el.classList.add('out'); setTimeout(() => el.remove(), 380); };
  el.addEventListener('click', () => { onTap?.(); close(); });
  setTimeout(close, ms);
  if (navigator.vibrate) navigator.vibrate(12);
  return close;
}

/* ── bottom sheet ── */
let scrim, sheet, onCloseCb, isOpen = false, skipPop = false;

export function initSheet() {
  scrim = document.querySelector('.scrim');
  sheet = document.querySelector('.sheet');
  scrim.addEventListener('click', () => closeSheet());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) closeSheet(); });
  window.addEventListener('popstate', () => { if (skipPop) { skipPop = false; return; } if (isOpen) hide(); });

  // drag the handle (or the header area) down to dismiss
  let startY = 0, dy = 0, dragging = false, t0 = 0;
  sheet.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.grab')) return;
    dragging = true; startY = e.clientY; dy = 0; t0 = performance.now();
    sheet.classList.add('drag');
    sheet.setPointerCapture(e.pointerId);
  });
  sheet.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translate(-50%, ${dy}px)`;
  });
  const end = () => {
    if (!dragging) return;
    dragging = false; sheet.classList.remove('drag');
    const fast = dy / Math.max(1, performance.now() - t0) > 0.6;
    sheet.style.transform = '';
    if (dy > 110 || (fast && dy > 30)) closeSheet();
  };
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
}

export function openSheet(html, { onClose } = {}) {
  onCloseCb = onClose;
  sheet.innerHTML = `<div class="grab" aria-hidden="true"><i></i></div>${html}`;
  sheet.scrollTop = 0;
  if (!isOpen) {
    isOpen = true;
    try { history.pushState({ sheet: 1 }, ''); } catch { /* ignore */ }
    requestAnimationFrame(() => { scrim.classList.add('on'); sheet.classList.add('on'); });
  }
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
}
export const updateSheet = (html) => { if (isOpen) { const top = sheet.scrollTop; sheet.innerHTML = `<div class="grab" aria-hidden="true"><i></i></div>${html}`; sheet.scrollTop = top; } };
export const sheetOpen = () => isOpen;

function hide() {
  if (!isOpen) return;
  isOpen = false;
  scrim.classList.remove('on');
  sheet.classList.remove('on');
  const cb = onCloseCb; onCloseCb = null;
  cb?.();
}
export function closeSheet() {
  if (!isOpen) return;
  if (history.state?.sheet) { skipPop = true; history.back(); } // keep the history stack tidy
  hide();
}

/* ── confetti ── */
export function confetti(x = innerWidth / 2, y = innerHeight * 0.6) {
  if (reducedMotion()) return;
  const cv = document.getElementById('confetti');
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  const colors = ['#ff8a3d', '#34d399', '#3cc8ff', '#8d7dff', '#ff4f9a', '#ffd166'];
  const parts = Array.from({ length: 90 }, () => {
    const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 9;
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 7, w: 5 + Math.random() * 6, h: 3 + Math.random() * 5, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: colors[(Math.random() * colors.length) | 0], life: 0 };
  });
  let last = performance.now();
  (function frame(now) {
    const dt = Math.min(2, (now - last) / 16.7); last = now;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    let alive = 0;
    for (const p of parts) {
      p.life += dt; p.vy += 0.38 * dt; p.vx *= 0.992; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
      const o = Math.max(0, 1 - p.life / 95);
      if (o <= 0 || p.y > innerHeight + 20) continue;
      alive++;
      ctx.save(); ctx.globalAlpha = o; ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    }
    if (alive) requestAnimationFrame(frame); else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })(last);
}
