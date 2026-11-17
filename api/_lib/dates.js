// Date math on plain "YYYY-MM-DD" strings (UTC under the hood, so no DST surprises).
// A dibs week runs FRIDAY -> THURSDAY. Friday is air-refill day (the ball gets pumped up, a fresh
// week starts), so every dib ends on a Thursday.

const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
export const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);

export const isISODate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fmt(parse(s)) === s;

export const addDays = (s, n) => fmt(parse(s) + n * DAY);
export const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / DAY);
export const dow = (s) => new Date(parse(s)).getUTCDay(); // 0 = Sunday

export const isWeekStart = (s) => dow(s) === 5;                       // Friday
export const weekStartOf = (s) => addDays(s, -((dow(s) + 2) % 7));  // back to Friday (Fri=0 ... Thu=6)
export const weekEndOf = (start) => addDays(start, 6);              // Thursday
export const monthOf = (s) => s.slice(0, 7);

/** Today's date in the given IANA timezone, as YYYY-MM-DD. */
export const todayIn = (tz) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Date + wall-clock time right now in the given IANA timezone: { date: 'YYYY-MM-DD', secs: seconds since local midnight }. */
export function nowIn(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, secs: Number(g('hour')) * 3600 + Number(g('minute')) * 60 + Number(g('second')) };
}

/** Whole days since 1970-01-01 (for comparing moments across days: dayIdx * 1440 + minute-of-day). */
export const dayIdx = (s) => Math.round(parse(s) / DAY);

/** "15:00" <-> minutes since midnight */
export const parseHM = (s) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(s));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const toHM = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/** minutes since midnight -> "3:05 PM" */
export const clock12 = (min) => {
  const h = Math.floor(min / 60) % 24;
  return `${h % 12 || 12}:${String(min % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/** "Sat 28 Nov" */
export const nice = (s) => {
  const [, m, d] = s.split('-').map(Number);
  return `${DOW[dow(s)]} ${d} ${MONTHS[m - 1]}`;
};
export const niceMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`;
};
