import { requireUser } from './_lib/auth.js';
import { api } from './_lib/http.js';
import { buildState, createDib, releaseDib } from './_lib/service.js';

export default api({
  // Call dibs on the week starting `weekStart` (a Friday)
  async POST({ req, res, body }) {
    const user = await requireUser(req, res);
    await createDib(user, body.weekStart, req);
    return { ok: true, state: await buildState(user, req) };
  },

  // Let go of your dibs
  async DELETE({ req, res, url, body }) {
    const user = await requireUser(req, res);
    await releaseDib(user, url.searchParams.get('weekStart') || body.weekStart, req);
    return { ok: true, state: await buildState(user, req) };
  },
});
