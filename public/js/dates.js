// Mirrors the server's week maths. A dibs week runs FRIDAY (refill day) -> THURSDAY.
const DAY = 86400000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (s, n) => fmt(parse(s) + n * DAY);
export const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / DAY);
export const dow = (s) => new Date(parse(s)).getUTCDay();
export const weekStartOf = (s) => addDays(s, -((dow(s) + 2) % 7));
export const weekEndOf = (start) => addDays(start, 6);
export const monthOf = (s) => s.slice(0, 7);
export const nice = (s) => { const [, m, d] = s.split('-').map(Number); return `${DOW[dow(s)]} ${d} ${MON[m - 1]}`; };
export const dayNum = (s) => Number(s.slice(8));
export const monthName = (ym) => MONTH[Number(ym.slice(5)) - 1];
export const year = (ym) => ym.slice(0, 4);

export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** Every date shown in a normal Sunday-first month grid (a multiple of 7, includes neighbours' days). */
export function monthGrid(ym) {
  const first = `${ym}-01`;
  const lead = dow(first); // Sunday = 0
  const [y, m] = ym.split('-').map(Number);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const total = Math.ceil((lead + dim) / 7) * 7;
  const start = addDays(first, -lead);
  return Array.from({ length: total }, (_, i) => addDays(start, i));
}

export function timeAgo(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
