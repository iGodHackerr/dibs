import { api } from './api.js';
import * as D from './dates.js';
import { dropFilled, icon, mascot } from './icons.js';
import * as push from './push.js';
import { closeSheet, confetti, esc, initSheet, openSheet, reducedMotion, sheetOpen, toast, updateSheet } from './ui.js';
import { createWheel } from './wheel.js';

/* ───────────────────────── state ───────────────────────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const store = (k, v) => {
  try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage blocked */ }
  return null;
};

const S = {
  state: null,
  json: '',
  tab: 'home',
  month: null,
  selected: null,
  known: new Set(),
  fresh: 0,
  push: null,
  installEvt: null,
  bannerOff: store('dibs-banner-off') === '1',
  theme: store('dibs-theme') || 'auto',
  sheet: null,
  mounted: false,
  fetchedAt: 0,        // when state.nowSecs was measured, so the clock can keep ticking between polls
  pick: null,          // the day + start time chosen in the session picker { date, startMin }
  wheels: [],
  wheelBusy: false,    // a wheel is being dragged: don't rebuild the page under the finger
  renderPending: false,
  cancelDate: null,    // session awaiting a "really cancel?" answer
  sesBusy: false,
  sesError: '',
  liveKey: '',
};
const root = $('#root');
const TABS = ['home', 'activity', 'settings'];

/* ───────────────────────── helpers ───────────────────────── */
const cfg = () => S.state.config;
const tagFor = (owner) => {
  if (owner === S.state.me) return 'YOU';
  const caps = owner.replace(/[^A-Z]/g, '');
  return (caps.length >= 2 ? caps : owner.slice(0, 3).toUpperCase()).slice(0, 3);
};
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const mineInMonth = (ym) => S.state.dibs.filter((d) => d.user === S.state.me && D.monthOf(d.weekStart) === ym).length;

/** What can be done with the week starting `ws` (a Friday). The server is the authority; this fills in the gaps. */
function weekInfo(ws) {
  const st = S.state;
  const known = st.weeks[ws];
  if (known) return known;
  const dib = st.dibs.find((d) => d.weekStart === ws);
  const past = D.weekEndOf(ws) < st.today;
  if (dib) return { status: dib.user === st.me ? 'mine' : 'theirs', owner: dib.user, past, canBook: false, canRelease: false };
  if (past) return { status: 'past', past: true, canBook: false, canRelease: false, reason: 'This week is over.' };
  const opensOn = D.addDays(ws, -7 * cfg().maxWeeksAhead);
  return { status: 'far', past: false, canBook: false, canRelease: false, opensOn, reason: `Dibs can be called up to ${cfg().maxWeeksAhead} weeks in advance. This week opens on ${D.nice(opensOn)}.` };
}

/* ───────────────────────── screens: splash / login ───────────────────────── */
function showSplash(msg = '') {
  S.mounted = false;
  root.innerHTML = `<div class="center splash"><div class="box">${mascot()}<p>${esc(msg)}</p></div></div>`;
}

function showOffline(msg) {
  S.mounted = false;
  root.innerHTML = `<div class="center splash"><div class="box">${mascot()}<p>${esc(msg || "Can't reach the server.")}</p><div style="margin-top:18px"><button class="btn sm" data-act="retry">Try again</button></div></div></div>`;
}

function showLogin(msg = '') {
  S.mounted = false;
  const last = store('dibs-user') || '';
  root.innerHTML = `
  <div class="center"><div class="login">
    <div class="logo">${mascot()}</div>
    <h1>Ball Dibs</h1>
    <p class="tag">Two friends. One ball. Fair play.</p>
    <form id="login-form" class="glass" autocomplete="on" novalidate>
      <label class="field"><span>Username</span>
        <div class="input"><input name="username" value="${esc(last)}" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next" placeholder="Your username" required></div>
      </label>
      <label class="field"><span>Password</span>
        <div class="input"><input name="password" type="password" autocomplete="current-password" enterkeyhint="go" placeholder="Your password" required>
          <button type="button" class="eye" data-act="eye" aria-label="Show password">${icon('eye')}</button></div>
      </label>
      <p class="err" role="alert">${esc(msg)}</p>
      <button class="btn" type="submit"><span>Sign in</span></button>
    </form>
  </div></div>`;
  (last ? $('input[name=password]') : $('input[name=username]'))?.focus({ preventScroll: true });
}

async function submitLogin(form) {
  const btn = $('button[type=submit]', form);
  const err = $('.err', form);
  const username = form.username.value.trim();
  const password = form.password.value;
  if (!username || !password) { err.textContent = 'Enter your username and password.'; shake(form); return; }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    await api('POST', '/api/session', { username, password });
    store('dibs-user', username);
    showSplash();
    await loadState(true);
  } catch (e) {
    showLogin(e.message);
    shake($('#login-form'));
  }
}
function shake(el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }

/* ───────────────────────── app shell ───────────────────────── */
function mountApp() {
  root.innerHTML = `
  <main id="app">
    <section class="view on" id="v-home" aria-label="Dibs calendar"></section>
    <section class="view" id="v-activity" aria-label="Activity"></section>
    <section class="view" id="v-settings" aria-label="You"></section>
  </main>
  <nav class="tabbar" aria-label="Main">
    <div class="tabs glass" role="tablist">
      <i class="lens"></i>
      <button class="tab" role="tab" data-act="tab" data-tab="home" aria-selected="true">${icon('calendar')}<span>Dibs</span></button>
      <button class="tab" role="tab" data-act="tab" data-tab="activity" aria-selected="false">${icon('bell')}<span>Activity</span><b class="dot" hidden></b></button>
      <button class="tab" role="tab" data-act="tab" data-tab="settings" aria-selected="false">${icon('user')}<span>You</span></button>
    </div>
  </nav>`;
  S.mounted = true;
  S.tab = 'home';
  setTimeout(() => root.classList.add('settled'), 1500);
}

function setTab(tab, { silent = false } = {}) {
  if (!TABS.includes(tab)) tab = 'home';
  const leaving = S.tab;
  S.tab = tab;
  TABS.forEach((t) => $(`#v-${t}`)?.classList.toggle('on', t === tab));
  $$('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  const lens = $('.lens');
  if (lens) lens.style.transform = `translateX(${TABS.indexOf(tab) * 100}%)`;
  if (!silent) scrollTo({ top: 0 });

  if (tab === 'activity') {
    S.fresh = S.state.unread;
    render();
    if (S.fresh) setTimeout(markSeen, 900);
  } else if (leaving === 'activity') {
    S.fresh = 0;
    render();
  }
  if (tab === 'home' && S.state && leaving !== 'home') drawCal();
}

async function markSeen() {
  if (S.tab !== 'activity' || !S.state?.unread) return;
  try { await api('POST', '/api/notifications'); S.state.unread = 0; S.json = snap(S.state); render(); } catch { /* try next time */ }
}

/* ───────────────────────── data ───────────────────────── */
// `nowSecs` moves every second, so it is left out when checking whether anything really changed.
const snap = (st) => JSON.stringify({ ...st, nowSecs: 0 });
function setState(st) { S.state = st; S.json = snap(st); S.fetchedAt = Date.now(); }

/** The date and time right now in the app's timezone, ticking forward from the last server reading. */
function clientNow() {
  const st = S.state;
  const secs = st.nowSecs + (Date.now() - S.fetchedAt) / 1000;
  const days = Math.floor(secs / 86400);
  const into = secs - days * 86400;
  return { date: days ? D.addDays(st.today, days) : st.today, min: Math.floor(into / 60), secs: into };
}

async function loadState(first = false) {
  const st = await api('GET', '/api/state');
  const changed = snap(st) !== S.json;
  setState(st);

  if (first || !S.mounted) {
    S.month = D.monthOf(st.today);
    S.pick = null;
    S.known = new Set(st.notifications.map((n) => n.id));
    mountApp();
    render();
    const hash = location.hash.replace('#', '');
    if (TABS.includes(hash)) setTab(hash, { silent: true });
    initPush();
    return;
  }

  const fresh = st.notifications.filter((n) => !S.known.has(n.id));
  fresh.forEach((n) => S.known.add(n.id));
  if (changed) render();
  if (fresh.length && !document.hidden) {
    fresh.slice(0, 2).forEach((n) => {
      const [ic, tone] = NOTE[n.type] || NOTE.test;
      toast({ title: n.title, body: n.body, icon: ic, tone }, { onTap: () => setTab('activity') });
    });
    if (S.tab === 'activity') { S.fresh = st.unread; setTimeout(markSeen, 900); }
  }
}

async function refresh() {
  if (!S.mounted) return;
  try { await loadState(); } catch (e) {
    if (e.status === 401) { S.sheet = null; closeSheet(); showLogin('Please sign in again.'); }
  }
}

async function initPush() {
  S.push = await push.status();
  if (S.push.subscribed) push.resync();
  render();
}

/* ───────────────────────── render ───────────────────────── */
function render() {
  if (!S.state || !S.mounted) return;
  if (S.wheelBusy) { S.renderPending = true; return; } // a finger is on the clock: redraw once it lets go
  const keep = $('.dayscroll')?.scrollLeft;
  S.wheels.forEach((w) => w.destroy());
  $('#v-home').innerHTML = homeHTML();
  afterHome(keep);
  $('#v-activity').innerHTML = activityHTML();
  $('#v-settings').innerHTML = settingsHTML();
  const dot = $('.tab .dot');
  const unread = S.tab === 'activity' ? 0 : S.state.unread;
  if (dot) { dot.hidden = !unread; dot.textContent = unread > 9 ? '9+' : unread; }
  try { unread ? navigator.setAppBadge?.(unread) : navigator.clearAppBadge?.(); } catch { /* unsupported */ }
  if (S.sheet?.type === 'week' && sheetOpen()) updateSheet(weekSheetHTML());
}

/* ── home ── */
function homeHTML() {
  const st = S.state;
  const unread = S.tab === 'activity' ? 0 : st.unread;
  return `
  <header class="topbar">
    <div><div class="hello">Hey ${esc(st.me)}</div><h1>Ball Dibs</h1></div>
    <button class="icon-btn glass" data-act="tab" data-tab="activity" aria-label="Notifications${unread ? `, ${unread} new` : ''}">${icon('bell')}${unread ? `<b class="badge">${unread > 9 ? '9+' : unread}</b>` : ''}</button>
  </header>
  ${bannerHTML()}
  ${heroHTML()}
  <section class="ses glass" id="ses" aria-label="Book a session">${sesHTML()}</section>
  ${upcomingHTML()}
  <section class="cal glass" id="cal" aria-label="Calendar">${calHTML()}</section>`;
}

function bannerHTML() {
  const p = S.push;
  if (!p || S.bannerOff) return '';
  if (p.needsInstall) {
    return `<div class="banner glass"><div class="ico">${icon('bell')}</div><div class="txt"><b>Get alerts on iPhone</b>Add Ball Dibs to your Home Screen to turn on notifications.</div><button class="btn sm" data-act="tab" data-tab="settings">How</button><button class="x" data-act="banner-x" aria-label="Dismiss">${icon('x')}</button></div>`;
  }
  if (p.supported && !p.subscribed && p.permission !== 'denied') {
    return `<div class="banner glass"><div class="ico">${icon('bell')}</div><div class="txt"><b>Know when dibs change</b>Get pinged when ${esc(S.state.other)} calls dibs or yours is ending.</div><button class="btn sm" data-act="push-enable">Turn on</button><button class="x" data-act="banner-x" aria-label="Dismiss">${icon('x')}</button></div>`;
  }
  return '';
}

/* ── sessions: helpers ── */
const SES_MIN = () => cfg().sessionHours * 60;
const sessionOn = (date) => S.state.sessions.find((x) => x.date === date);
const absMin = (date, min) => D.dayIdx(date) * 1440 + min;
const sessSpan = (s) => { const a = absMin(s.date, D.parseHM(s.start)); return [a, a + SES_MIN()]; };
const timeRange = (s) => `${D.clock12(D.parseHM(s.start))} → ${D.clock12(D.parseHM(s.end))}${s.endDate !== s.date ? ` (${D.nice(s.endDate)})` : ''}`;
/** upcoming | live | done */
function sessState(s, now = clientNow()) {
  const [a, b] = sessSpan(s);
  const n = absMin(now.date, now.secs / 60);
  return n < a ? 'upcoming' : n < b ? 'live' : 'done';
}
const horizonDate = () => D.weekEndOf(D.addDays(D.weekStartOf(S.state.today), 7 * cfg().maxWeeksAhead));
function sessionDates() {
  const out = [];
  for (let d = clientNow().date, last = horizonDate(); d <= last; d = D.addDays(d, 1)) out.push(d);
  return out;
}

/** Can a session be booked on `date`? (the server has the final say) */
function dayInfo(date) {
  const st = S.state;
  if (date < clientNow().date) return { status: 'past' };
  const wi = weekInfo(D.weekStartOf(date));
  if (wi.status === 'mine' || wi.status === 'theirs') return { status: 'dib', owner: wi.owner, ws: D.weekStartOf(date) };
  if (wi.status === 'far' || date > horizonDate()) return { status: 'far' };
  const s = sessionOn(date);
  if (s) return { status: 'taken', session: s };
  return { status: 'free' };
}

/** Is this a valid start time? -> { ok } or { ok:false, msg } */
function checkPick(date, startMin) {
  const st = S.state, now = clientNow();
  const day = dayInfo(date);
  if (day.status !== 'free') return { ok: false, msg: 'This day is not available.' };
  if (date === now.date && startMin < now.min - 3) return { ok: false, msg: `That time has already passed. It's ${D.clock12(now.min)} now.` };
  const a = absMin(date, startMin), b = a + SES_MIN();
  if (startMin + SES_MIN() >= 1440) {
    const nextDay = D.addDays(date, 1);
    const wi = weekInfo(D.weekStartOf(nextDay));
    if (wi.status === 'theirs') return { ok: false, msg: `That would run into ${D.nice(nextDay)}, when ${wi.owner} has weekly dibs.` };
  }
  for (const o of [sessionOn(D.addDays(date, -1)), sessionOn(D.addDays(date, 1))]) {
    if (!o) continue;
    const [c, d] = sessSpan(o);
    if (c < b && d > a) return { ok: false, msg: `That overlaps ${o.user === st.me ? 'your' : `${o.user}'s`} session (${D.nice(o.date)}, ${timeRange(o)}).` };
  }
  return { ok: true };
}

const remembered = () => { const t = store('dibs-time'); return t ? D.parseHM(t) : 16 * 60; };
const nextFive = (min) => Math.min(1435, Math.ceil((min + 1) / 5) * 5);
function defaultStart(date) {
  const now = clientNow(), r = remembered();
  return date === now.date && r < now.min ? nextFive(now.min) : r;
}
function ensurePick() {
  const now = clientNow();
  if (S.pick && S.pick.date >= now.date && S.pick.date <= horizonDate()) return S.pick;
  const free = sessionDates().find((d) => dayInfo(d).status === 'free' && !(d === now.date && now.min >= 23 * 60 + 55));
  const date = free || now.date;
  S.pick = { date, startMin: defaultStart(date) };
  return S.pick;
}

/* ── hero: the ball right now ── */
function heroHTML() {
  const st = S.state, now = clientNow();
  const cur = D.weekStartOf(now.date);
  const end = D.weekEndOf(cur);
  const info = weekInfo(cur);
  const live = st.sessions.find((x) => sessState(x, now) === 'live');
  const mine = (u) => u === st.me;

  let kind = 'free', ic = 'sparkle', eyebrow = 'This week', title = 'Free play', sub, prog = '';
  if (live) {
    const [a, b] = sessSpan(live), n = absMin(now.date, now.secs / 60);
    const left = Math.max(0, b - n), h = Math.floor(left / 60), m = Math.round(left % 60);
    kind = 'live'; ic = 'play'; eyebrow = 'Right now';
    title = mine(live.user) ? "You're playing" : `${esc(live.user)} is playing`;
    sub = mine(live.user) ? 'Enjoy the ball. Your session is on.' : 'The ball is with them for now.';
    prog = `<div class="prog"><div class="bar"><i style="--p:${Math.min(100, Math.max(2, ((n - a) / (b - a)) * 100)).toFixed(1)}%"></i></div><div class="cap"><span>Started ${D.clock12(D.parseHM(live.start))}</span><span><b>${h ? `${h}h ` : ''}${m}m left</b> · ends ${D.clock12(D.parseHM(live.end))}</span></div></div>`;
  } else if (info.status === 'mine') { kind = 'mine'; ic = 'check'; title = 'You have dibs'; sub = `The ball is all yours until ${D.nice(end)}.`; }
  else if (info.status === 'theirs') { kind = 'theirs'; ic = 'lock'; title = `${esc(info.owner)} has dibs`; sub = `The ball is with them until ${D.nice(end)}.`; }
  else sub = cur < cfg().openFrom ? `Nobody has dibs, so anyone can play. Dibs open on ${D.nice(cfg().openFrom)}.` : 'Nobody has dibs this week, so anyone can play.';

  const nextSes = st.sessions.find((x) => sessState(x, now) === 'upcoming');
  const nextDib = st.dibs.find((d) => d.weekStart > cur);
  const who = (u) => `<span class="chip ${mine(u) ? 'mine' : 'theirs'}">${mine(u) ? 'You' : esc(u)}</span>`;
  const lines = [];
  if (nextSes) lines.push(`<div>${icon('clock')}<span>Next session</span>${who(nextSes.user)}<span>${D.nice(nextSes.date)} · ${timeRange(nextSes)}</span></div>`);
  if (nextDib) lines.push(`<div>${icon('calendar')}<span>Next dibs</span>${who(nextDib.user)}<span>${D.nice(nextDib.weekStart)} → ${D.nice(nextDib.weekEnd)}</span></div>`);
  if (!lines.length) lines.push(st.today < cfg().openFrom ? `<div>${icon('lock')}<span>Dibs open from <b>${D.nice(cfg().openFrom)}</b></span></div>` : '<div><span>Nothing booked yet. Pick a time below, or tap a week to call dibs.</span></div>');

  return `
  <section class="hero glass ${kind}" aria-live="polite">
    <i class="glow"></i>
    <div class="hero-top">
      <div class="stat">${icon(ic)}</div>
      <div class="hero-text">
        <div class="eyebrow">${eyebrow}</div>
        <h2>${title}</h2>
        <p>${sub}</p>
      </div>
    </div>
    ${prog}
    <div class="next">${lines.join('')}</div>
  </section>`;
}

/* ── session picker ── */
const HOURS = ['12', ...Array.from({ length: 11 }, (_, i) => String(i + 1))];
const MINS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

function sesHTML() {
  const p = ensurePick();
  const now = clientNow(), cur = D.weekStartOf(now.date);
  const chips = sessionDates().map((d, i) => {
    const di = dayInfo(d);
    const wk = D.weekStartOf(d);
    const cls = ['dc'];
    if (d === p.date) cls.push('sel');
    if (d === now.date) cls.push('today');
    if (i === 0) cls.push('first');
    if (D.dow(d) === 5) cls.push('fri');
    if (di.status === 'dib') cls.push('dib');
    let mk = '';
    if (di.status === 'taken') mk = `<i class="sd ${di.session.user === S.state.me ? 'mine' : 'theirs'}"></i>`;
    else if (di.status === 'dib') mk = `<i class="sd ${di.owner === S.state.me ? 'dibm' : 'dibt'}"></i>`;
    const label = `${D.nice(d)}${di.status === 'taken' ? `, ${di.session.user === S.state.me ? 'your' : `${di.session.user}'s`} session` : di.status === 'dib' ? ', weekly dibs' : ''}`;
    return `<button class="${cls.join(' ')}" data-act="pick-day" data-date="${d}" aria-label="${esc(label)}" aria-pressed="${d === p.date}"><span class="w">${d === now.date ? 'Today' : D.nice(d).slice(0, 3)}</span><span class="nn">${D.dayNum(d)}</span><span class="mk">${mk}</span></button>`;
  }).join('');
  const isToday = p.date === now.date && dayInfo(p.date).status === 'free';
  return `
  <div class="ses-head">
    <div><h2>Book a session</h2><small>${cfg().sessionHours} hours · one session a day</small></div>
    ${isToday ? '<button class="pill-btn" data-act="pick-now">Start now</button>' : ''}
  </div>
  <div class="dayscroll" role="group" aria-label="Choose a day">${chips}</div>
  <div id="ses-body">${sesBodyHTML()}</div>`;
}

function sesBodyHTML() {
  const st = S.state, p = S.pick, di = dayInfo(p.date);
  if (di.status === 'free') {
    return `
    <div class="picker">
      <div class="pick-top"><b>${D.longDay(p.date)} ${D.nice(p.date).slice(4)}</b><span>Start time</span></div>
      <div class="clock" id="clock" role="group" aria-label="Start time">
        <div class="h"></div><div class="colon" aria-hidden="true">:</div><div class="m"></div><div class="p"></div>
      </div>
      <div class="sum" id="sum"></div>
      <div class="warnline" id="ses-warn" role="status"></div>
      <button class="btn" id="ses-go" data-act="ses-book">${icon('clock')}<span>Book this session</span></button>
      <p class="tip">${esc(st.other)} gets a notification with your start and end time.</p>
    </div>`;
  }
  if (di.status === 'taken') return takenHTML(di.session);
  if (di.status === 'dib') {
    const mine = di.owner === st.me;
    return `<div class="verdict ${mine ? 'mine' : 'theirs'}"><div class="ico">${icon(mine ? 'check' : 'lock')}</div><div><b>${mine ? 'You have weekly dibs' : `${esc(di.owner)} has weekly dibs`}</b><p>${mine ? 'The ball is yours all week, so there is nothing to book.' : 'The ball is theirs all week. Sessions are for weeks nobody has dibs on.'} (${D.nice(di.ws)} → ${D.nice(D.weekEndOf(di.ws))})</p></div></div>`;
  }
  return '';
}

function takenHTML(s) {
  const st = S.state, mine = s.user === st.me, state = sessState(s);
  const head = state === 'live' ? (mine ? "You're playing now" : `${esc(s.user)} is playing now`) : state === 'done' ? (mine ? 'You played' : `${esc(s.user)} played`) : mine ? 'Your session' : `${esc(s.user)}'s session`;
  let actions = '';
  if (mine && state === 'upcoming') {
    actions = S.cancelDate === s.date
      ? `<p class="tip" style="margin-top:12px">Cancel this session? ${esc(st.other)} will be told.</p><div class="confirm"><button class="btn ghost" data-act="ses-cancel-no">Keep it</button><button class="btn danger" data-act="ses-cancel-yes" ${S.sesBusy ? 'disabled' : ''} style="margin-top:0">${S.sesBusy ? '<span class="spinner"></span>' : 'Cancel session'}</button></div>`
      : '<button class="btn danger" data-act="ses-cancel">Cancel my session</button>';
  } else if (state !== 'done') {
    actions = `<p class="tip" style="margin-top:12px">It's one session a day, so this day is taken.</p>`;
  }
  return `<div class="verdict ${mine ? 'mine' : 'theirs'}"><div class="ico">${icon(state === 'live' ? 'play' : 'clock')}</div><div><b>${head}</b><p>${D.nice(s.date)} · ${timeRange(s)}</p></div></div>${S.sesError ? `<p class="err" role="alert">${esc(S.sesError)}</p>` : ''}${actions}`;
}

function upcomingHTML() {
  const now = clientNow();
  const list = S.state.sessions.filter((x) => sessState(x, now) !== 'done');
  if (!list.length) return '';
  const rows = list.map((s) => {
    const mine = s.user === S.state.me, live = sessState(s, now) === 'live';
    return `<button class="row" data-act="ses-day" data-date="${s.date}"><div class="ico ${mine ? 'green' : 'red'}">${icon(live ? 'play' : 'clock')}</div><div class="body"><b>${D.nice(s.date)}${live ? ' · live now' : ''}</b><small>${timeRange(s)}</small></div><span class="chip ${mine ? 'mine' : 'theirs'}">${mine ? 'You' : esc(s.user)}</span></button>`;
  }).join('');
  return `<div class="section-title">Booked sessions</div><div class="group glass">${rows}</div>`;
}

/** Wire the three wheels (hour, minute, AM/PM) to S.pick. */
function mountClock() {
  S.wheels.forEach((w) => w.destroy());
  S.wheels = [];
  const host = $('#clock');
  if (!host || !S.pick) return;
  const m = S.pick.startMin, h24 = Math.floor(m / 60);
  const v = { h: h24 % 12, m: m % 60, p: h24 >= 12 ? 1 : 0 };
  const changed = () => {
    S.pick.startMin = (v.p * 12 + v.h) * 60 + v.m;
    store('dibs-time', D.toHM(S.pick.startMin));
    S.sesError = '';
    updateSummary();
  };
  const make = (sel, cls, items, key, loop, label) => {
    const el = $(sel, host); el.classList.add(cls);
    return createWheel(el, { items, index: v[key], loop, label, onInput: (i) => { v[key] = i; changed(); }, onBusy: wheelBusy });
  };
  S.wheels = [make('.h', 'h', HOURS, 'h', true, 'Hour'), make('.m', 'm', MINS, 'm', true, 'Minute'), make('.p', 'p', ['AM', 'PM'], 'p', false, 'AM or PM')];
  updateSummary();
}

function wheelBusy(b) {
  S.wheelBusy = b;
  if (!b && S.renderPending) { S.renderPending = false; render(); }
}

function setClock(min, animate = true) {
  const h24 = Math.floor(min / 60);
  [h24 % 12, min % 60, h24 >= 12 ? 1 : 0].forEach((val, i) => S.wheels[i]?.set(val, animate && !reducedMotion()));
}

function updateSummary() {
  const el = $('#sum');
  if (!el || !S.pick) return;
  const { date, startMin } = S.pick;
  const endMin = startMin + SES_MIN();
  const v = checkPick(date, startMin);
  const nextDay = endMin >= 1440 ? ` · ends ${D.nice(D.addDays(date, 1))}` : '';
  el.innerHTML = `<div><div class="big">${D.clock12(startMin)} → ${D.clock12(endMin)}</div><small>${cfg().sessionHours} hours with the ball${nextDay}</small></div>`;
  const warn = $('#ses-warn');
  warn.textContent = S.sesError || (v.ok ? '' : v.msg);
  warn.classList.toggle('bad', !!S.sesError);
  const go = $('#ses-go');
  if (go) go.disabled = !v.ok || S.sesBusy;
}

function afterHome(keep) {
  const sc = $('.dayscroll');
  if (sc && keep != null) sc.scrollLeft = keep; else centerChip(false);
  mountClock();
  S.liveKey = liveKey();
}

function centerChip(smooth) {
  const sc = $('.dayscroll'), sel = $('.dc.sel');
  if (!sc || !sel) return;
  sc.scrollTo({ left: sel.offsetLeft - (sc.clientWidth - sel.offsetWidth) / 2, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
}

function drawSesBody() {
  const el = $('#ses-body');
  if (!el) return;
  S.wheels.forEach((w) => w.destroy());
  el.innerHTML = sesBodyHTML();
  const head = $('.ses-head');
  const isToday = S.pick.date === clientNow().date && dayInfo(S.pick.date).status === 'free';
  head.querySelector('.pill-btn')?.remove();
  if (isToday) head.insertAdjacentHTML('beforeend', '<button class="pill-btn" data-act="pick-now">Start now</button>');
  mountClock();
}

function pickDay(date, { smooth = true } = {}) {
  const now = clientNow();
  S.pick.date = date;
  const wasPast = date === now.date && S.pick.startMin < now.min - 3;
  if (wasPast) S.pick.startMin = nextFive(now.min);
  S.cancelDate = null; S.sesError = '';
  $$('.dc').forEach((el) => { const on = el.dataset.date === date; el.classList.toggle('sel', on); el.setAttribute('aria-pressed', String(on)); });
  centerChip(smooth);
  drawSesBody();
}

async function bookSession() {
  const { date, startMin } = S.pick;
  if (S.sesBusy || !checkPick(date, startMin).ok) return;
  S.sesBusy = true; S.sesError = '';
  const go = $('#ses-go'); if (go) { go.disabled = true; go.innerHTML = '<span class="spinner"></span>'; }
  try {
    const res = await api('POST', '/api/plays', { date, start: D.toHM(startMin) });
    S.sesBusy = false;
    setState(res.state);
    render();
    confetti();
    const s = res.state.sessions.find((x) => x.date === date);
    toast({ title: 'Session booked!', body: `${D.nice(date)} · ${s ? timeRange(s) : D.clock12(startMin)}. ${res.state.other} has been told.`, icon: 'check', tone: 'green' });
  } catch (e) {
    S.sesBusy = false; S.sesError = e.message;
    if (e.status === 401) return showLogin('Please sign in again.');
    await refresh();
    drawSesBody();
  }
}

async function cancelSession() {
  const date = S.cancelDate;
  if (!date || S.sesBusy) return;
  S.sesBusy = true; S.sesError = '';
  drawSesBody();
  try {
    const res = await api('DELETE', `/api/plays?date=${encodeURIComponent(date)}`);
    S.sesBusy = false; S.cancelDate = null;
    setState(res.state);
    render();
    toast({ title: 'Session cancelled', body: `${D.nice(date)} is free again.`, icon: 'wave', tone: 'blue' });
  } catch (e) {
    S.sesBusy = false; S.cancelDate = null; S.sesError = e.message;
    await refresh();
    drawSesBody();
  }
}

/** Something time-dependent changed (a session started/ended, a picked time slipped into the past)? Redraw. */
function liveKey() {
  if (!S.state) return '';
  const now = clientNow();
  const live = S.state.sessions.some((x) => sessState(x, now) === 'live');
  const pick = S.pick && dayInfo(S.pick.date).status === 'free' ? checkPick(S.pick.date, S.pick.startMin).ok : '-';
  return [now.date, S.state.sessions.map((x) => x.id + sessState(x, now)).join(), live ? now.min : '', pick].join('|');
}
function tickClock() {
  if (!S.mounted || !S.state || document.hidden || S.wheelBusy) return;
  const k = liveKey();
  if (k !== S.liveKey) { S.liveKey = k; render(); }
}

/* ── calendar (a normal Sunday-first month; dibs weeks run Fri→Thu so they wrap across rows) ── */
function calHTML() {
  const st = S.state;
  const ym = S.month;
  const used = mineInMonth(ym);
  const limit = cfg().perMonth;
  const pips = Array.from({ length: limit }, (_, i) => `<i class="${i < used ? 'on' : ''}"></i>`).join('');
  const dowLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((l, i) => `<span class="${i === 5 ? 'fri' : ''}" ${i === 5 ? 'title="Friday: air refill and a new week"' : ''}>${l}${i === 5 ? dropFilled : ''}</span>`).join('');
  return `
  <div class="cal-head">
    <button class="nav" data-act="prev" aria-label="Previous month">${icon('left')}</button>
    <div class="cal-title"><b>${D.monthName(ym)}</b><span>${D.year(ym)}</span></div>
    <button class="nav" data-act="next" aria-label="Next month">${icon('right')}</button>
  </div>
  <div class="cal-sub">
    <div class="quota"><span class="pips" aria-hidden="true">${pips}</span><span>${used} of ${limit} ${D.monthName(ym)} dibs used</span></div>
    ${ym !== D.monthOf(st.today) ? '<button class="today-btn" data-act="today">Today</button>' : ''}
  </div>
  <div class="dow" aria-hidden="true">${dowLabels}</div>
  <div class="grid" role="group" aria-label="${D.monthName(ym)} ${D.year(ym)}">${gridHTML()}</div>
  <div class="legend">
    <span><i class="l-mine"></i>Your dibs</span>
    <span><i class="l-theirs"></i>${esc(st.other)}'s dibs</span>
    <span><i class="l-dot mine"></i><i class="l-dot theirs"></i>5h sessions</span>
    <span><i class="l-lock"></i>Dibs not open yet</span>
    <span><i class="l-fri">${dropFilled}</i>Fri = refill, new week</span>
  </div>`;
}

function gridHTML() {
  const st = S.state;
  const ym = S.month;
  return D.monthGrid(ym).map((date, i) => {
    const dw = D.dow(date);
    const ws = D.weekStartOf(date);
    const info = weekInfo(ws);
    const cls = ['d'];
    if (D.monthOf(date) !== ym) cls.push('om');
    if (date === st.today) cls.push('today');
    if (info.status === 'mine' || info.status === 'theirs') cls.push(info.status);
    if (info.status === 'locked') cls.push('locked');
    if (info.status === 'far') cls.push('far');
    if (info.past || info.status === 'past') cls.push('past');
    if (S.selected === ws) cls.push('sel');
    const rs = dw === 5 || dw === 0; // Friday (week start) or Sunday (row start)
    const re = dw === 4 || dw === 6; // Thursday (week end) or Saturday (row end)
    if (rs) cls.push('rs');
    if (re) cls.push('re');
    const owned = info.status === 'mine' || info.status === 'theirs';
    const ses = sessionOn(date);
    const label = `${D.nice(date)}. ${owned ? (info.status === 'mine' ? 'You have dibs' : `${info.owner} has dibs`) : info.status === 'locked' ? 'Free for everyone, dibs not open yet' : 'No dibs'}${ses ? `. ${ses.user === st.me ? 'Your' : `${ses.user}'s`} session ${timeRange(ses)}` : ''}`;
    const tag = owned && rs ? esc(tagFor(info.owner)) : ses ? `<i class="sd ${ses.user === st.me ? 'mine' : 'theirs'}"></i>` : '';
    return `<button class="${cls.join(' ')}" data-act="week" data-week="${ws}" data-date="${date}" style="--r:${Math.floor(i / 7)}" aria-label="${esc(label)}"><span class="n">${D.dayNum(date)}</span><span class="tag">${tag}</span></button>`;
  }).join('');
}

function drawCal(dir = 0) {
  const el = $('#cal');
  if (!el || !S.state) return;
  el.innerHTML = calHTML();
  if (dir && !reducedMotion()) {
    $('.grid', el).animate(
      [{ transform: `translateX(${dir * 42}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 460, easing: 'cubic-bezier(.32,.72,0,1)' },
    );
  }
}
function changeMonth(delta) { S.month = D.addMonths(S.month, delta); drawCal(delta); }
function markSelected() { $$('.d').forEach((el) => el.classList.toggle('sel', el.dataset.week === S.selected)); }

/* ── week sheet ── */
function openWeek(ws, date) {
  S.selected = ws;
  S.sheet = { type: 'week', ws, date: date || ws, confirm: false, busy: false, error: '' };
  markSelected();
  openSheet(weekSheetHTML(), { onClose: () => { S.selected = null; S.sheet = null; markSelected(); } });
}

function weekSheetHTML() {
  const st = S.state;
  const { ws, confirm, busy, error } = S.sheet;
  const info = weekInfo(ws);
  const we = D.weekEndOf(ws);
  const cur = D.weekStartOf(st.today);
  const month = D.monthOf(ws);
  const used = mineInMonth(month);
  const limit = cfg().perMonth;
  const days = D.diffDays(st.today, ws);
  const when = info.past ? 'Past week' : ws === cur ? 'This week' : days === 1 ? 'Starts tomorrow' : `Starts in ${days} days`;

  let tone = '', ic = 'ball', head = '', text = '';
  switch (info.status) {
    case 'mine':
      tone = 'mine'; head = info.past ? 'You had dibs' : 'You have dibs';
      text = info.past ? 'You had the ball this week.' : `The ball is yours ${ws <= st.today ? 'until' : 'from ' + D.nice(ws) + ' until'} ${D.nice(we)}. Friday is refill day.`;
      break;
    case 'theirs':
      tone = 'theirs'; ic = 'lock'; head = `${info.owner} has dibs`;
      text = info.past ? `${info.owner} had the ball this week.` : `${info.owner} gets the ball ${ws <= st.today ? 'until' : 'this week, through'} ${D.nice(we)}. Your turn can come after.`;
      break;
    case 'open':
      head = ws === cur ? 'Free to claim' : 'Up for grabs';
      text = 'Nobody has dibs on this week yet. Until someone calls it, anyone can use the ball.';
      break;
    case 'locked':
      tone = 'warn'; ic = 'lock'; head = 'Free for both of you';
      text = info.reason;
      break;
    case 'quota':
      tone = 'warn'; ic = 'hourglass'; head = 'Dibs limit reached';
      text = info.reason;
      break;
    case 'busy':
      tone = 'warn'; ic = 'clock'; head = 'A session is booked';
      text = info.reason;
      break;
    case 'far':
      tone = 'warn'; ic = 'clock'; head = 'Too early to call';
      text = info.reason;
      break;
    default:
      ic = 'clock'; head = 'This week is over'; text = 'Nothing to do here.';
  }

  const kv = `
  <div class="kv">
    <div><span>Starts</span><b>${D.nice(ws)} ${icon('drop', 'style="display:inline;width:14px;height:14px;vertical-align:-2px;color:var(--accent-2)"')}</b></div>
    <div><span>Ends</span><b>${D.nice(we)}</b></div>
    <div><span>Counts toward</span><b>${D.monthName(month)} (${used} of ${limit} used)</b></div>
  </div>`;

  // 5-hour sessions that start inside this week
  const weekSes = st.sessions.filter((x) => x.date >= ws && x.date <= we);
  const sesList = weekSes.length
    ? `<div class="minirows">${weekSes.map((x) => `<div class="minirow"><i class="sd ${x.user === st.me ? 'mine' : 'theirs'}"></i><div class="mr"><b>${D.nice(x.date)}</b><small>${timeRange(x)}</small></div><span class="chip ${x.user === st.me ? 'mine' : 'theirs'}">${x.user === st.me ? 'You' : esc(x.user)}</span></div>`).join('')}</div>`
    : '';
  const folded = info.canBook ? weekSes.filter((x) => x.user === st.me && sessState(x) !== 'done') : [];

  let actions = '';
  if (confirm) {
    actions = `<p class="tip">Let go of dibs for ${D.nice(ws)} → ${D.nice(we)}? ${esc(st.other)} will be told.</p>
      <div class="confirm"><button class="btn ghost" data-act="release-no">Keep dibs</button><button class="btn danger" data-act="release-yes" ${busy ? 'disabled' : ''}>${busy ? '<span class="spinner"></span>' : 'Let go'}</button></div>`;
  } else if (info.canBook) {
    const left = limit - used - 1;
    actions = `<button class="btn go" data-act="dibs" ${busy ? 'disabled' : ''}>${busy ? '<span class="spinner"></span>' : `${icon('ball')}<span>${ws <= st.today ? 'Call dibs for the rest of this week' : 'Call dibs'}</span>`}</button>
      <p class="tip">Uses 1 of your ${limit} ${D.monthName(month)} dibs${left > 0 ? ` (${left} left after this)` : ' (none left after this)'}. You can let go any time.</p>
      ${folded.length ? `<p class="tip">Your session on ${folded.map((x) => D.nice(x.date)).join(', ')} is covered by the dibs, so it will be removed.</p>` : ''}`;
  } else if (info.canRelease) {
    actions = `<button class="btn danger" data-act="release">Let go of my dibs</button>`;
  }
  // a free-play day: jump to the clock to book a session on exactly this day
  const day = S.sheet.date;
  if (!confirm && dayInfo(day).status === 'free') {
    actions += `<button class="btn ghost" data-act="pick-from-sheet" data-date="${day}">${icon('clock')}<span>Book a session on ${D.nice(day)}</span></button>`;
  }

  return `
  <h3>${D.nice(ws)} → ${D.nice(we)}</h3>
  <p class="sub">${when}</p>
  <div class="stack">
    <div class="verdict ${tone}"><div class="ico">${icon(ic)}</div><div><b>${esc(head)}</b><p>${esc(text)}</p></div></div>
    ${kv}
    ${sesList}
    ${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
    ${actions}
  </div>`;
}

async function callDibs() {
  const sh = S.sheet;
  sh.busy = true; sh.error = '';
  updateSheet(weekSheetHTML());
  try {
    const res = await api('POST', '/api/dibs', { weekStart: sh.ws });
    setState(res.state);
    const end = D.weekEndOf(sh.ws);
    closeSheet();
    render();
    confetti();
    toast({ title: 'Dibs called!', body: `The ball is yours ${D.nice(sh.ws)} → ${D.nice(end)}. ${S.state.other} has been told.`, icon: 'check', tone: 'green' });
  } catch (e) {
    sh.busy = false; sh.error = e.message;
    if (e.status === 401) { closeSheet(); return showLogin('Please sign in again.'); }
    await refresh();
    if (S.sheet) updateSheet(weekSheetHTML());
  }
}

async function releaseDibs() {
  const sh = S.sheet;
  sh.busy = true; sh.error = '';
  updateSheet(weekSheetHTML());
  try {
    const res = await api('DELETE', `/api/dibs?weekStart=${encodeURIComponent(sh.ws)}`);
    setState(res.state);
    closeSheet();
    render();
    toast({ title: 'Dibs released', body: `${D.nice(sh.ws)} → ${D.nice(D.weekEndOf(sh.ws))} is free play again.`, icon: 'wave', tone: 'blue' });
  } catch (e) {
    sh.busy = false; sh.confirm = false; sh.error = e.message;
    await refresh();
    if (S.sheet) updateSheet(weekSheetHTML());
  }
}

/* ── activity ── */
const NOTE = {
  'dibs-called': ['ball', 'orange'],
  'dibs-released': ['wave', 'blue'],
  'dibs-ending-soon': ['hourglass', 'purple'],
  'dibs-ending-today': ['bell', 'red'],
  'session-booked': ['clock', 'orange'],
  'session-cancelled': ['wave', 'blue'],
  test: ['sparkle', 'green'],
};

function activityHTML() {
  const notes = S.state.notifications;
  const list = notes.length
    ? `<div class="group glass">${notes.map((n, i) => {
      const [ic, tone] = NOTE[n.type] || NOTE.test;
      return `<div class="note ${i < S.fresh ? 'unread' : ''}" style="--i:${i}"><div class="ico ${tone}">${icon(ic)}</div><div class="t"><b>${esc(n.title)}</b><p>${esc(n.body)}</p></div><time>${D.timeAgo(n.ts)}</time></div>`;
    }).join('')}</div>`
    : `<div class="group glass empty">${mascot()}<b>All quiet</b><span>When ${esc(S.state.other)} calls dibs, books a session, or a dib is about to end, you'll see it here.</span></div>`;
  return `<header class="topbar"><div><div class="hello">${S.state.unread ? `${S.state.unread} new` : 'Everything you missed'}</div><h1>Activity</h1></div></header>${list}`;
}

/* ── settings ── */
function settingsHTML() {
  const st = S.state;
  const p = S.push;

  let pushSub = 'Checking…', pushOn = false, pushOff = true;
  if (p) {
    pushOff = false;
    if (!p.supported) { pushSub = 'This browser does not support push'; pushOff = true; }
    else if (p.needsInstall) { pushSub = 'On iPhone, add the app to your Home Screen first'; pushOff = true; }
    else if (p.permission === 'denied') { pushSub = 'Blocked. Allow notifications in your phone or browser settings'; pushOff = true; }
    else { pushOn = p.subscribed; pushSub = pushOn ? 'On for this device' : 'Off for this device'; }
  }

  const standalone = push.isStandalone();
  let install;
  if (standalone) {
    install = `<div class="row"><div class="ico green">${icon('check')}</div><div class="body"><b>Installed</b><small>You're using Ball Dibs as an app</small></div></div>`;
  } else if (S.installEvt) {
    install = `<button class="row" data-act="install"><div class="ico blue">${icon('plus')}</div><div class="body"><b>Install app</b><small>Add Ball Dibs to your home screen</small></div>${icon('right', 'class="chev"')}</button>`;
  } else if (push.isIOS()) {
    install = `<div class="row"><div class="ico blue">${icon('phone')}</div><div class="body"><b>Add to Home Screen</b><small>Works like a real app, with notifications</small></div></div>
      <ol class="steps"><li>Open this page in <b>Safari</b></li><li>Tap Share ${icon('share')} in the toolbar</li><li>Choose <b>Add to Home Screen</b> ${icon('plus')}</li><li>Open Dibs from your Home Screen, then turn on notifications here</li></ol>`;
  } else {
    install = `<div class="row"><div class="ico blue">${icon('phone')}</div><div class="body"><b>Install the app</b><small>Open your browser menu (⋮) and tap <b>Install app</b> or <b>Add to Home screen</b></small></div></div>`;
  }

  const themeIdx = { auto: 0, light: 1, dark: 2 }[S.theme] ?? 0;
  const c = cfg();
  return `
  <header class="topbar"><div><div class="hello">Your account</div><h1>You</h1></div></header>

  <div class="profile glass"><div class="avatar">${esc(st.me[0].toUpperCase())}</div><div><b>${esc(st.me)}</b><small>Sharing the ball with ${esc(st.other)}</small></div></div>

  <div class="section-title">Notifications</div>
  <div class="group glass">
    <div class="row"><div class="ico purple">${icon('bell')}</div><div class="body"><b>Push notifications</b><small>${esc(pushSub)}</small></div>
      <button class="switch ${pushOn ? 'on' : ''}" role="switch" aria-checked="${pushOn}" aria-label="Push notifications" data-act="push-toggle" ${pushOff ? 'disabled style="opacity:.45"' : ''}></button></div>
    ${pushOn ? `<button class="row" data-act="push-test"><div class="ico green">${icon('sparkle')}</div><div class="body"><b>Send a test</b><small>Check that alerts reach this device</small></div>${icon('right', 'class="chev"')}</button>` : ''}
  </div>

  <div class="section-title">App</div>
  <div class="group glass">${install}</div>

  <div class="section-title">Appearance</div>
  <div class="group glass" style="padding-top:14px">
    <div class="seg" role="group" aria-label="Theme"><i style="transform:translateX(${themeIdx * 100}%)"></i>
      <button data-act="theme" data-theme="auto" aria-pressed="${S.theme === 'auto'}">Auto</button>
      <button data-act="theme" data-theme="light" aria-pressed="${S.theme === 'light'}">Light</button>
      <button data-act="theme" data-theme="dark" aria-pressed="${S.theme === 'dark'}">Dark</button>
    </div>
  </div>

  <div class="section-title">Security</div>
  <div class="group glass">
    <button class="row" data-act="pw-open"><div class="ico orange">${icon('key')}</div><div class="body"><b>Change password</b><small>Signs out your other devices</small></div>${icon('right', 'class="chev"')}</button>
    <button class="row" data-act="logout"><div class="ico red">${icon('logout')}</div><div class="body"><b>Sign out</b><small>On this device</small></div></button>
  </div>

  <div class="section-title">House rules</div>
  <div class="group glass rules">
    <div>${icon('ball')}<span>Dibs last <b>one week</b>: from <b>Friday</b> (refill day) to <b>Thursday</b>.</span></div>
    <div>${icon('hourglass')}<span>Each of you gets <b>${c.perMonth} dibs a month</b>, so it stays fair.</span></div>
    <div>${icon('calendar')}<span>Call dibs up to <b>${c.maxWeeksAhead} weeks ahead</b>.</span></div>
    <div>${icon('lock')}<span>No dibs until <b>${D.nice(c.openFrom)}</b>. Until then, anyone can use the ball.</span></div>
    <div>${icon('sparkle')}<span>No dibs on a week? <b>Free play</b>, either of you can use it.</span></div>
    <div>${icon('clock')}<span>On a free-play week, book a <b>${c.sessionHours}-hour session</b> from any start time. <b>One session a day</b>, and the other person is told.</span></div>
  </div>`;
}

/* ── password sheet ── */
function passwordSheetHTML() {
  const field = (name, label, ac) => `<label class="field"><span>${label}</span><div class="input"><input name="${name}" type="password" autocomplete="${ac}" required><button type="button" class="eye" data-act="eye" aria-label="Show password">${icon('eye')}</button></div></label>`;
  return `
  <h3>Change password</h3>
  <p class="sub">You'll stay signed in here. Other devices will be signed out.</p>
  <form id="pw-form" class="stack" novalidate>
    <input type="text" name="u" value="${esc(S.state.me)}" autocomplete="username" hidden>
    ${field('current', 'Current password', 'current-password')}
    ${field('next', 'New password', 'new-password')}
    <div class="meter"><i></i></div><p class="hint" id="pw-hint">At least 10 characters. A few random words make a great one.</p>
    ${field('confirm', 'Repeat new password', 'new-password')}
    <p class="err" role="alert"></p>
    <button class="btn" type="submit">Update password</button>
  </form>`;
}

function strength(pw) {
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  if (/(.)\1{3,}/.test(pw) || /^(1234|password|qwerty)/i.test(pw)) score = Math.max(0, score - 2);
  return Math.min(4, score);
}

async function submitPassword(form) {
  const err = $('.err', form);
  const btn = $('button[type=submit]', form);
  const { current, next, confirm } = form;
  err.textContent = '';
  if (next.value.length < 10) err.textContent = 'Use at least 10 characters.';
  else if (next.value !== confirm.value) err.textContent = "The new passwords don't match.";
  else if (next.value === current.value) err.textContent = 'Pick something different from your current password.';
  if (err.textContent) { shake(form); return; }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try {
    await api('POST', '/api/password', { current: current.value, next: next.value });
    S.sheet = null; closeSheet();
    toast({ title: 'Password updated', body: 'Your other devices were signed out.', icon: 'shield', tone: 'green' });
  } catch (e) {
    err.textContent = e.message; btn.disabled = false; btn.textContent = 'Update password'; shake(form);
  }
}

/* ───────────────────────── actions ───────────────────────── */
async function enablePush() {
  try {
    await push.enable(S.state.push.publicKey);
    toast({ title: 'Notifications on', body: "You'll be pinged about dibs.", icon: 'bell', tone: 'green' });
  } catch (e) {
    toast({ title: "Couldn't turn on notifications", body: e.message, icon: 'x', tone: 'red' });
  }
  S.push = await push.status();
  render();
}

const ACT = {
  tab: (el) => setTab(el.dataset.tab),
  week: (el) => openWeek(el.dataset.week, el.dataset.date),
  'pick-day': (el) => pickDay(el.dataset.date),
  'pick-now': () => { const n = clientNow(); S.wheels.length && setClock(Math.min(n.min, 1439)); },
  'pick-from-sheet': (el) => {
    const date = el.dataset.date;
    closeSheet();
    setTab('home', { silent: true });
    S.pick = S.pick || { date, startMin: defaultStart(date) };
    pickDay(date, { smooth: false });
    $('#ses')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  },
  'ses-day': (el) => { pickDay(el.dataset.date); $('#ses')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' }); },
  'ses-book': () => bookSession(),
  'ses-cancel': () => { S.cancelDate = S.pick.date; drawSesBody(); },
  'ses-cancel-no': () => { S.cancelDate = null; drawSesBody(); },
  'ses-cancel-yes': () => cancelSession(),
  prev: () => changeMonth(-1),
  next: () => changeMonth(1),
  today: () => { const dir = S.month < D.monthOf(S.state.today) ? 1 : -1; S.month = D.monthOf(S.state.today); drawCal(dir); },
  dibs: () => callDibs(),
  release: () => { S.sheet.confirm = true; updateSheet(weekSheetHTML()); },
  'release-no': () => { S.sheet.confirm = false; updateSheet(weekSheetHTML()); },
  'release-yes': () => releaseDibs(),
  'banner-x': () => { S.bannerOff = true; store('dibs-banner-off', '1'); render(); },
  'push-enable': () => enablePush(),
  'push-toggle': async (el) => {
    if (!S.push || el.disabled) return;
    el.setAttribute('aria-busy', 'true');
    if (S.push.subscribed) { await push.disable(); S.push = await push.status(); render(); }
    else await enablePush();
  },
  'push-test': async () => {
    try {
      const r = await push.sendTest();
      toast(r.sent ? { title: 'Test sent', body: 'It should pop up in a moment.', icon: 'sparkle', tone: 'green' } : { title: 'No device found', body: 'Turn notifications on for this device first.', icon: 'x', tone: 'red' });
    } catch (e) { toast({ title: 'Test failed', body: e.message, icon: 'x', tone: 'red' }); }
  },
  install: async () => {
    const ev = S.installEvt; if (!ev) return;
    ev.prompt(); await ev.userChoice; S.installEvt = null; render();
  },
  theme: (el) => {
    S.theme = el.dataset.theme; store('dibs-theme', S.theme);
    if (S.theme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = S.theme;
    window.dibsTheme?.sync();
    render();
  },
  'pw-open': () => { S.sheet = { type: 'password' }; openSheet(passwordSheetHTML(), { onClose: () => { S.sheet = null; } }); },
  logout: async () => {
    try { await push.disable(); } catch { /* ignore */ }
    try { await api('DELETE', '/api/session'); } catch { /* ignore */ }
    S.state = null; S.json = ''; S.known = new Set(); S.fresh = 0;
    try { navigator.clearAppBadge?.(); } catch { /* ignore */ }
    showLogin();
  },
  eye: (el) => {
    const input = el.parentElement.querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    el.innerHTML = icon(show ? 'eyeOff' : 'eye');
    el.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  },
  retry: async () => { showSplash(); try { await loadState(true); } catch (e) { e.status === 401 ? showLogin() : showOffline(e.message); } },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && ACT[el.dataset.act]) { e.preventDefault(); ACT[el.dataset.act](el); }
});
document.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'login-form') submitLogin(e.target);
  else if (e.target.id === 'pw-form') submitPassword(e.target);
});
document.addEventListener('input', (e) => {
  if (e.target.name === 'next' && e.target.form?.id === 'pw-form') {
    const s = strength(e.target.value);
    const bar = $('.meter i', e.target.form);
    bar.style.width = e.target.value ? `${Math.max(1, s) * 25}%` : '0';
    bar.style.background = ['#ff6b81', '#ff6b81', '#fbbf24', '#34d399', '#34d399'][s];
    $('#pw-hint').textContent = !e.target.value ? 'At least 10 characters. A few random words make a great one.' : ['Too weak', 'Weak', 'Okay', 'Strong', 'Excellent'][s];
  }
});

// swipe the calendar to change month
let sx = 0, sy = 0, swiping = false;
document.addEventListener('touchstart', (e) => {
  swiping = !!e.target.closest('.grid');
  if (swiping) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!swiping) return;
  swiping = false;
  const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) changeMonth(dx < 0 ? 1 : -1);
}, { passive: true });

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; render(); });
window.addEventListener('appinstalled', () => { S.installEvt = null; render(); });

/* ───────────────────────── boot ───────────────────────── */
function applyTheme() {
  if (S.theme === 'light' || S.theme === 'dark') document.documentElement.dataset.theme = S.theme;
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'refresh') refresh();
    if (e.data?.type === 'open') { const h = new URL(e.data.url).hash.replace('#', ''); if (S.mounted && TABS.includes(h)) setTab(h); refresh(); }
  });
}

async function boot() {
  applyTheme();
  initSheet();
  registerSW();
  showSplash();
  try { await loadState(true); } catch (e) {
    if (e.status === 401) showLogin(); else showOffline(e.message);
  }
  setInterval(() => { if (!document.hidden) refresh(); }, 20000);
  setInterval(tickClock, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('focus', refresh);
  window.addEventListener('online', refresh);
}
boot();
