import { requireUser } from './_lib/auth.js';
import { api } from './_lib/http.js';
import { markSeen } from './_lib/notify.js';

export default api({
  // Mark the activity feed as read
  async POST({ req, res }) {
    const user = await requireUser(req, res);
    await markSeen(user);
    return { ok: true };
  },
});
