// Small helpers so every endpoint behaves the same: JSON in/out, errors, CSRF guard.
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function json(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  let b = req.body;
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') {
    try { b = JSON.parse(b); } catch { b = {}; }
  }
  return b && typeof b === 'object' ? b : {};
}

// Browsers can't send a custom header cross-site without a CORS preflight (which we never allow),
// so requiring it blocks CSRF. We also check Origin when present.
function assertSameOrigin(req) {
  if (req.headers['x-requested-with'] !== 'dibs') throw new HttpError(403, 'Bad request');
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch { /* handled below */ }
    if (host !== req.headers.host) throw new HttpError(403, 'Bad origin');
  }
}

/** api({ GET: fn, POST: fn }) -> (req, res) handler. fn gets { req, res, url, body } and returns JSON. */
export function api(methods, { csrf = true } = {}) {
  return async function handler(req, res) {
    try {
      const fn = methods[req.method];
      if (!fn) {
        res.setHeader('Allow', Object.keys(methods).join(', '));
        throw new HttpError(405, 'Method not allowed');
      }
      if (csrf && req.method !== 'GET' && req.method !== 'HEAD') assertSameOrigin(req);
      const url = new URL(req.url, 'http://local');
      const out = await fn({ req, res, url, body: parseBody(req) });
      if (out !== undefined && !res.writableEnded) json(res, 200, out);
    } catch (e) {
      if (e instanceof HttpError) {
        json(res, e.status, { error: e.message, ...e.extra }, e.extra.retryAfter ? { 'Retry-After': String(e.extra.retryAfter) } : {});
      } else {
        console.error(e);
        json(res, 500, { error: 'Something went wrong on our side. Try again in a moment.' });
      }
    }
  };
}
