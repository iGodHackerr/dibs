// Local stand-in for Vercel: serves /public and runs /api/*.js handlers.   npm run dev
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
// Apply the same response headers as production (CSP etc.), so problems show up locally.
const HEADER_RULES = (JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')).headers || []).map((r) => ({
  re: r.source === '/(.*)' ? /^\/.*$/ : new RegExp('^' + r.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'),
  headers: r.headers,
}));
const applyHeaders = (res, pathname) => {
  for (const r of HEADER_RULES) if (r.re.test(pathname)) for (const h of r.headers) res.setHeader(h.key, h.value);
};
const PORT = Number(process.env.PORT || 3000);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  applyHeaders(res, url.pathname);
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/\/$/, '');
      const file = path.join(ROOT, 'api', name + '.js');
      if (name.includes('/') || name.startsWith('_') || !fs.existsSync(file)) { res.statusCode = 404; return res.end('{"error":"Not found"}'); }
      // Mimic Vercel: pre-parse JSON body onto req.body
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const raw = Buffer.concat(chunks).toString('utf8');
      try { req.body = raw ? JSON.parse(raw) : undefined; } catch { req.body = undefined; }
      const mod = await import(pathToFileURL(file).href);
      return mod.default(req, res);
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(ROOT, 'public', rel);
    if (!file.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.statusCode = 404; return res.end('Not found');
    }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    res.statusCode = 500; res.end('Server error');
  }
});

server.listen(PORT, () => console.log(`\n  Ball Dibs running ->  http://localhost:${PORT}\n`));
