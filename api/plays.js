import { requireUser } from './_lib/auth.js';
import { api } from './_lib/http.js';
import { buildState, cancelSession, createSession } from './_lib/service.js';

// Play sessions: one 5-hour session per day, only on weeks where nobody has weekly dibs.
export default api({
  // Book a session: { date: 'YYYY-MM-DD', start: 'HH:MM' }
  async POST({ req, res, body }) {
    const user = await requireUser(req, res);
    await createSession(user, body.date, body.start, req);
    return { ok: true, state: await buildState(user, req) };
  },

  // Cancel one of your sessions that hasn't started: ?date=YYYY-MM-DD
  async DELETE({ req, res, url, body }) {
    const user = await requireUser(req, res);
    await cancelSession(user, url.searchParams.get('date') || body.date, req);
    return { ok: true, state: await buildState(user, req) };
  },
});
