// Central rules & settings. Change a number here, redeploy, done.

export const USERS = ['iGodHackerr', 'KingOfWord'];

export const PER_MONTH = 2;        // dibs each person may hold per calendar month
export const MAX_WEEKS_AHEAD = 4;  // how far into the future dibs can be called
export const SESSION_DAYS = 90;    // how long a login lasts
export const MIN_PASSWORD = 10;

export const timezone = () => process.env.APP_TIMEZONE || 'Asia/Kolkata';
// First Friday on which dibs may start. Weeks that begin before it are free-for-all.
export const openFrom = () => process.env.DIBS_OPEN_FROM || '2026-11-27';

export const canonicalUser = (name) =>
  USERS.find((u) => u.toLowerCase() === String(name || '').trim().toLowerCase()) || null;

export const otherUser = (u) => USERS.find((x) => x !== u);

export const envPasswordFor = (u) => process.env['PASSWORD_' + u.toUpperCase()] || '';
