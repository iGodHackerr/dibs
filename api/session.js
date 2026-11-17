import { clearSession, clientIp, failuresOf, issueSession, recordFailure, verifyPassword } from './_lib/auth.js';
import { canonicalUser } from './_lib/config.js';
import { HttpError, api } from './_lib/http.js';
import { getStore } from './_lib/store.js';

const WINDOW = 15 * 60;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default api({
  // Sign in
  async POST({ req, res, body }) {
    const ipKey = 'rl:login:ip:' + clientIp(req);
    const user = canonicalUser(body.username);
    const userKey = 'rl:login:u:' + (user || 'unknown');

    if ((await failuresOf(ipKey)) >= 8 || (await failuresOf(userKey)) >= 25) {
      throw new HttpError(429, 'Too many tries. Wait 15 minutes and try again.', { retryAfter: WINDOW });
    }

    const ok = user ? await verifyPassword(user, body.password) : false;
    if (!ok) {
      await recordFailure(ipKey, WINDOW);
      await recordFailure(userKey, WINDOW);
      await sleep(500);
      throw new HttpError(401, 'Wrong username or password.');
    }
    await getStore().del(ipKey);
    await getStore().del(userKey);
    await issueSession(res, req, user);
    return { ok: true, user };
  },

  // Sign out (this device only)
  async DELETE({ req, res }) {
    clearSession(res, req);
    return { ok: true };
  },
});
