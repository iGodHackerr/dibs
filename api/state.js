import { requireUser } from './_lib/auth.js';
import { api } from './_lib/http.js';
import { maybeRunScheduled } from './_lib/scheduled.js';
import { buildState } from './_lib/service.js';

export default api({
  async GET({ req, res }) {
    const user = await requireUser(req, res);
    await maybeRunScheduled(req);
    return buildState(user, req);
  },
});
