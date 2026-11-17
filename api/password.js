import { clientIp, failuresOf, issueSession, recordFailure, requireUser, setPassword, verifyPassword } from './_lib/auth.js';
import { MIN_PASSWORD } from './_lib/config.js';
import { HttpError, api } from './_lib/http.js';
import { getStore } from './_lib/store.js';

export default api({
  async POST({ req, res, body }) {
    const user = await requireUser(req, res);
    const key = 'rl:pw:' + user;
    if ((await failuresOf(key)) >= 6) throw new HttpError(429, 'Too many wrong attempts. Try again in 15 minutes.', { retryAfter: 900 });

    const { current, next } = body;
    if (!(await verifyPassword(user, current))) {
      await recordFailure(key, 900);
      throw new HttpError(403, 'Your current password is not right.');
    }
    if (typeof next !== 'string' || next.length < MIN_PASSWORD) throw new HttpError(400, `Use at least ${MIN_PASSWORD} characters.`);
    if (next.length > 128) throw new HttpError(400, 'That password is too long (128 max).');
    if (next === current) throw new HttpError(400, 'Pick something different from your current password.');

    await getStore().del(key);
    await setPassword(user, next);   // also signs out every other device
    await issueSession(res, req, user); // ...but keeps this one signed in
    return { ok: true };
  },
});
