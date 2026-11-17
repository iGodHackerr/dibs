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

/** "Sat 28 Nov" */
export const nice = (s) => {
  const [, m, d] = s.split('-').map(Number);
  return `${DOW[dow(s)]} ${d} ${MONTHS[m - 1]}`;
};
export const niceMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`;
};
