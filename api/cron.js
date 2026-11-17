// Daily job (see vercel.json). Vercel sends "Authorization: Bearer $CRON_SECRET".
import crypto from 'node:crypto';
import { HttpError, api } from './_lib/http.js';
import { runScheduled } from './_lib/scheduled.js';

const same = (a, b) => {
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
};

export default api({
  async GET({ req }) {
    const secret = process.env.CRON_SECRET;
    const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!secret || !same(secret, given)) throw new HttpError(401, 'Unauthorized');
    return { ok: true, sent: await runScheduled(req) };
  },
}, { csrf: false });
