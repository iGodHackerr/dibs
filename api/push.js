import { requireUser } from './_lib/auth.js';
import { HttpError, api } from './_lib/http.js';
import { removeSubscription, saveSubscription, sendTest, subscriptionCount } from './_lib/notify.js';

export default api({
  async POST({ req, res, body }) {
    const user = await requireUser(req, res);
    switch (body.action) {
      case 'subscribe':
        await saveSubscription(user, body.subscription, req.headers['user-agent']);
        return { ok: true, devices: await subscriptionCount(user) };
      case 'unsubscribe':
        await removeSubscription(user, body.endpoint);
        return { ok: true, devices: await subscriptionCount(user) };
      case 'test': {
        const r = await sendTest(user, req);
        return { ok: true, ...r };
      }
      default:
        throw new HttpError(400, 'Unknown action.');
    }
  },
});
