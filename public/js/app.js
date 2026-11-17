import { api } from './api.js';
import * as D from './dates.js';
import { ball, dropFilled, icon } from './icons.js';
import * as push from './push.js';
import { closeSheet, confetti, esc, initSheet, openSheet, reducedMotion, sheetOpen, toast, updateSheet } from './ui.js';

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
  root.innerHTML = `<div class="center splash"><div class="box">${ball()}<p>${esc(msg)}</p></div></div>`;
}

function showOffline(msg) {
  S.mounted = false;
  root.innerHTML = `<div class="center splash"><div class="box">${ball()}<p>${esc(msg || "Can't reach the server.")}</p><div style="margin-top:18px"><button class="btn sm" data-act="retry">Try again</button></div></div></div>`;
}

function showLogin(msg = '') {
  S.mounted = false;
  const last = store('dibs-user') || '';
  root.innerHTML = `
  <div class="center"><div class="login">
    <div class="logo">${ball()}<i class="shadow"></i></div>
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
  try { await api('POST', '/api/notifications'); S.state.unread = 0; S.json = JSON.stringify(S.state); render(); } catch { /* try next time */ }
}

/* ───────────────────────── data ───────────────────────── */
async function loadState(first = false) {
  const st = await api('GET', '/api/state');
  const json = JSON.stringify(st);
  const changed = json !== S.json;
  S.json = json;
  S.state = st;

  if (first || !S.mounted) {
    S.month = D.monthOf(st.today);
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
  $('#v-home').innerHTML = homeHTML();
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

function heroHTML() {
  const st = S.state;
  const cur = D.weekStartOf(st.today);
  const end = D.weekEndOf(cur);
  const info = weekInfo(cur);
  let kind = 'free', title = 'Free play', sub;
  if (info.status === 'mine') { kind = 'mine'; title = 'You have dibs'; sub = `The ball is all yours until ${D.nice(end)}.`; }
  else if (info.status === 'theirs') { kind = 'theirs'; title = `${esc(info.owner)} has dibs`; sub = `The ball is with them until ${D.nice(end)}.`; }
  else sub = cur < cfg().openFrom ? `Anyone can use the ball. Dibs open on ${D.nice(cfg().openFrom)}.` : 'Nobody has dibs, so anyone can use the ball.';

  const idx = D.diffDays(cur, st.today);
  const left = 7 - idx;
  const labels = ['F', 'S', 'S', 'M', 'T', 'W', 'T'];
  const days = labels.map((l, i) => `<div class="day ${i < idx ? 'done' : i === idx ? 'now' : ''} ${i === 0 ? 'fri' : ''}"><i></i><span>${l}</span></div>`).join('');
  const refill = idx === 0 ? 'Refill day' : `Refill in ${plural(left, 'day')}`;

  const next = st.dibs.find((d) => d.weekStart > cur);
  let nextLine;
  if (next) {
    const mine = next.user === st.me;
    nextLine = `<span>Next up</span><span class="chip ${mine ? 'mine' : 'theirs'}">${mine ? 'You' : esc(next.user)}</span><span>${D.nice(next.weekStart)} → ${D.nice(next.weekEnd)}</span>`;
  } else if (st.today < cfg().openFrom) {
    nextLine = `<span>${icon('lock', 'width="16" height="16"')}</span><span>Dibs open from <b>${D.nice(cfg().openFrom)}</b></span>`;
  } else {
    nextLine = '<span>No upcoming dibs yet. Tap a week below to claim it.</span>';
  }

  return `
  <section class="hero glass ${kind}" aria-live="polite">
    <i class="glow"></i>
    <div class="hero-top">
      <div class="ballbox">${ball()}<i class="shadow"></i></div>
      <div class="hero-text">
        <div class="eyebrow">This week</div>
        <h2>${title}</h2>
        <p>${sub}</p>
      </div>
    </div>
    <div class="strip">
      <div class="strip-head"><span>${D.nice(cur)} → ${D.nice(end)}</span><span><b>${refill}</b></span></div>
      <div class="days">${days}</div>
    </div>
    <div class="next">${nextLine}</div>
  </section>`;
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
    const label = `${D.nice(date)}. ${owned ? (info.status === 'mine' ? 'You have dibs' : `${info.owner} has dibs`) : info.status === 'locked' ? 'Free for everyone, dibs not open yet' : 'No dibs'}`;
    return `<button class="${cls.join(' ')}" data-act="week" data-week="${ws}" style="--r:${Math.floor(i / 7)}" aria-label="${esc(label)}"><span class="n">${D.dayNum(date)}</span><span class="tag">${owned && rs ? esc(tagFor(info.owner)) : ''}</span></button>`;
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
function openWeek(ws) {
  S.selected = ws;
  S.sheet = { type: 'week', ws, confirm: false, busy: false, error: '' };
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

  let actions = '';
  if (confirm) {
    actions = `<p class="tip">Let go of dibs for ${D.nice(ws)} → ${D.nice(we)}? ${esc(st.other)} will be told.</p>
      <div class="confirm"><button class="btn ghost" data-act="release-no">Keep dibs</button><button class="btn danger" data-act="release-yes" ${busy ? 'disabled' : ''}>${busy ? '<span class="spinner"></span>' : 'Let go'}</button></div>`;
  } else if (info.canBook) {
    const left = limit - used - 1;
    actions = `<button class="btn go" data-act="dibs" ${busy ? 'disabled' : ''}>${busy ? '<span class="spinner"></span>' : `${icon('ball')}<span>${ws <= st.today ? 'Call dibs for the rest of this week' : 'Call dibs'}</span>`}</button>
      <p class="tip">Uses 1 of your ${limit} ${D.monthName(month)} dibs${left > 0 ? ` (${left} left after this)` : ' (none left after this)'}. You can let go any time.</p>`;
  } else if (info.canRelease) {
    actions = `<button class="btn danger" data-act="release">Let go of my dibs</button>`;
  }

  return `
  <h3>${D.nice(ws)} → ${D.nice(we)}</h3>
  <p class="sub">${when}</p>
  <div class="stack">
    <div class="verdict ${tone}"><div class="ico">${icon(ic)}</div><div><b>${esc(head)}</b><p>${esc(text)}</p></div></div>
    ${kv}
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
    S.state = res.state; S.json = JSON.stringify(res.state);
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
    S.state = res.state; S.json = JSON.stringify(res.state);
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
  test: ['sparkle', 'green'],
};

function activityHTML() {
  const notes = S.state.notifications;
  const list = notes.length
    ? `<div class="group glass">${notes.map((n, i) => {
      const [ic, tone] = NOTE[n.type] || NOTE.test;
      return `<div class="note ${i < S.fresh ? 'unread' : ''}" style="--i:${i}"><div class="ico ${tone}">${icon(ic)}</div><div class="t"><b>${esc(n.title)}</b><p>${esc(n.body)}</p></div><time>${D.timeAgo(n.ts)}</time></div>`;
    }).join('')}</div>`
    : `<div class="group glass empty">${ball()}<b>All quiet</b><span>When ${esc(S.state.other)} calls dibs or a dib is about to end, you'll see it here.</span></div>`;
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
  week: (el) => openWeek(el.dataset.week),
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
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('focus', refresh);
  window.addEventListener('online', refresh);
}
boot();
