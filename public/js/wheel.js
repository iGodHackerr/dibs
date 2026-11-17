// iOS-alarm style rotating wheel: drag, flick, tap, mouse wheel or arrow keys. Looks like a drum
// (items tilt away from the centre) and snaps to a value. Only 7 DOM nodes are ever used, so a
// 60-minute wheel costs the same as a 2-item AM/PM wheel.

export const ITEM_H = 44;
const STEP = 24;                                              // degrees between neighbouring items
const R = ITEM_H / (2 * Math.tan((STEP / 2) * Math.PI / 180)); // drum radius that makes neighbours touch
const SLOTS = 7;

const ease = (t) => 1 - (1 - t) ** 3;

/**
 * @param {HTMLElement} el
 * @param {{items: string[], index?: number, loop?: boolean, label?: string,
 *          onInput?: (i:number)=>void,   // fires every time the value under the highlight changes
 *          onChange?: (i:number)=>void,  // fires once the wheel has settled
 *          onBusy?: (busy:boolean)=>void}} o
 */
export function createWheel(el, { items, index = 0, loop = true, label = '', onInput, onChange, onBusy }) {
  const n = items.length;
  const wrap = (i) => ((i % n) + n) % n;
  const clamp = (p) => (loop ? p : Math.max(0, Math.min(n - 1, p)));

  el.classList.add('wheel');
  el.tabIndex = 0;
  el.setAttribute('role', 'spinbutton');
  el.setAttribute('aria-label', label);
  el.setAttribute('aria-valuemin', '0');
  el.setAttribute('aria-valuemax', String(n - 1));
  el.innerHTML = `<div class="wh-in" style="transform:translateZ(${-R}px)">${'<div class="wi"></div>'.repeat(SLOTS)}</div>`;
  const nodes = [...el.querySelectorAll('.wi')];

  let pos = clamp(index);     // continuous position, in items
  let lastIdx = -1;
  let raf = 0;
  let drag = null;
  let busy = false;
  let lastTick = 0;
  let goal = null;            // where the running animation is headed, so quick repeated ticks add up

  const setBusy = (b) => { if (b !== busy) { busy = b; onBusy?.(b); } };
  const tick = () => {
    const now = performance.now();
    if (now - lastTick > 45) { lastTick = now; try { navigator.vibrate?.(2); } catch { /* unsupported */ } }
  };

  function paint() {
    const c = Math.round(pos);
    for (let j = 0; j < SLOTS; j++) {
      const node = nodes[j];
      const abs = c + (j - 3);
      if (!loop && (abs < 0 || abs > n - 1)) { node.style.visibility = 'hidden'; continue; }
      const d = abs - pos;
      const text = items[wrap(abs)];
      if (node._t !== text) { node.textContent = text; node._t = text; }
      node.style.visibility = '';
      node.style.transform = `rotateX(${-d * STEP}deg) translateZ(${R}px)`;
      node.style.opacity = String(Math.max(0, 1 - Math.abs(d) * 0.36));
      node.classList.toggle('on', Math.abs(d) < 0.5);
    }
    const idx = wrap(c);
    if (idx !== lastIdx) {
      const first = lastIdx === -1;
      lastIdx = idx;
      el.setAttribute('aria-valuenow', String(idx));
      el.setAttribute('aria-valuetext', items[idx]);
      if (!first) { tick(); onInput?.(idx); }
    }
  }

  function settle() {
    goal = null;
    pos = loop ? wrap(Math.round(pos)) : clamp(Math.round(pos));
    paint();
    setBusy(false);
    onChange?.(wrap(Math.round(pos)));
  }

  function animateTo(target, ms) {
    cancelAnimationFrame(raf);
    goal = target;
    const from = pos, t0 = performance.now();
    setBusy(true);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      pos = from + (target - from) * ease(t);
      paint();
      if (t < 1) raf = requestAnimationFrame(step); else settle();
    };
    raf = requestAnimationFrame(step);
  }

  /* drag / flick / tap */
  el.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    cancelAnimationFrame(raf);
    goal = null;
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    drag = { y0: e.clientY, p0: pos, moved: false, t0: performance.now(), samples: [{ t: performance.now(), p: pos }] };
    setBusy(true);
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y0;
    if (Math.abs(dy) > 4) drag.moved = true;
    pos = clamp(drag.p0 - dy / ITEM_H);
    const t = performance.now();
    drag.samples.push({ t, p: pos });
    if (drag.samples.length > 8) drag.samples.shift();
    paint();
  });
  const release = (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved && e.type === 'pointerup') {          // a tap: jump to the item that was touched
      const r = el.getBoundingClientRect();
      const off = Math.round((e.clientY - (r.top + r.height / 2)) / (ITEM_H * 0.95));
      animateTo(clamp(Math.round(pos) + off), 220);
      return;
    }
    const now = performance.now();
    const recent = d.samples.filter((s) => now - s.t < 110);
    let v = 0;                                          // items per ms
    if (recent.length > 1) v = (recent.at(-1).p - recent[0].p) / Math.max(16, recent.at(-1).t - recent[0].t);
    const target = clamp(Math.round(pos + v * 320));
    animateTo(target, Math.min(950, 240 + Math.abs(target - pos) * 55));
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);

  /* mouse wheel / trackpad (desktop) */
  let acc = 0;
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    acc += e.deltaY;
    if (Math.abs(acc) >= 40) {
      const dir = Math.sign(acc); acc = 0;
      animateTo(clamp((goal ?? Math.round(pos)) + dir), 140);
    }
  }, { passive: false });

  /* keyboard */
  el.addEventListener('keydown', (e) => {
    const k = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 }[e.key];
    if (k === undefined) return;
    e.preventDefault();
    animateTo(clamp((goal ?? Math.round(pos)) + k), 160);
  });

  paint();
  return {
    get: () => wrap(Math.round(pos)),
    set(i, animate = false) {
      cancelAnimationFrame(raf);
      let target = clamp(i);
      if (loop) {                                  // take the short way round
        const cur = Math.round(pos);
        let diff = wrap(i) - wrap(cur);
        if (diff > n / 2) diff -= n; else if (diff < -n / 2) diff += n;
        target = cur + diff;
      }
      if (animate) animateTo(target, 420); else { pos = target; paint(); setBusy(false); }
    },
    destroy() { cancelAnimationFrame(raf); },
  };
}
