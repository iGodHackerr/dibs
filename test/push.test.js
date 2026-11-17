// Server-side push, end to end: we play the role of a phone's push service. A real subscriber keypair
// is generated, our notify() sends to it, and we decrypt the payload and verify the VAPID signature.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import webpush from 'web-push';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dibs-push-'));
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // the fake push service below uses a throw-away self-signed cert
execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1', '-subj', '/CN=localhost',
  '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], { stdio: 'ignore' });
const tls = { key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) };
process.env.DATA_FILE = path.join(dir, 'db.json');
const vapid = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
process.env.VAPID_PRIVATE_KEY = vapid.privateKey;

const { notify } = await import('../api/_lib/notify.js');
const { getStore } = await import('../api/_lib/store.js');

// the "phone": a P-256 key + 16-byte auth secret, exactly what PushManager.subscribe() hands back
const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
const authSecret = crypto.randomBytes(16);
const b64u = (b) => Buffer.from(b).toString('base64url');

let server, port;
const received = [];
before(async () => {
  server = https.createServer(tls, (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { received.push({ headers: req.headers, body: Buffer.concat(chunks) }); res.statusCode = 201; res.end(); });
  });
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
});
after(() => { server.closeAllConnections?.(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

// RFC 8291 (aes128gcm) decryption on the receiving side
function decrypt(body) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const cipher = body.subarray(21 + idlen);
  const hkdf = (ikm, salt_, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt_, info, len));
  const shared = ecdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic]);
  const ikm = hkdf(shared, authSecret, keyInfo, 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString()); // strip 0x02 delimiter + padding
}

test('notify() stores an in-app note and delivers a decryptable, VAPID-signed push', async () => {
  const store = getStore();
  const endpoint = `https://localhost:${port}/push/abc`;
  await store.hset('push:KingOfWord', 'dev1', JSON.stringify({ endpoint, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(authSecret) }, createdAt: Date.now() }));

  const { entry, push } = await notify('KingOfWord', { type: 'dibs-called', title: '✋ iGodHackerr called dibs', body: 'The ball is theirs Fri 4 Dec → Thu 10 Dec.' }, { headers: { host: 'ball-dibs.vercel.app' } });
  assert.deepEqual(push, { sent: 1, failed: 0 });
  assert.equal(received.length, 1);

  // payload decrypts to what we sent
  const msg = decrypt(received[0].body);
  assert.equal(msg.title, '✋ iGodHackerr called dibs');
  assert.equal(msg.body, 'The ball is theirs Fri 4 Dec → Thu 10 Dec.');
  assert.equal(msg.url, '/#activity');
  assert.equal(msg.id, entry.id);

  // VAPID: JWT signed by our private key, audience = the push service, subject = this site (no personal data)
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(received[0].headers.authorization);
  assert.ok(m, 'has a vapid Authorization header');
  assert.equal(m[2], vapid.publicKey);
  const [h, p, sig] = m[1].split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  assert.equal(claims.sub, 'https://ball-dibs.vercel.app');
  assert.equal(claims.aud, `https://localhost:${port}`);
  const pub = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'), Buffer.from(vapid.publicKey, 'base64url')]), format: 'der', type: 'spki' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), 'JWT signature verifies');

  // and the in-app feed has it
  const notes = (await store.lrange('notes:KingOfWord', 0, 5)).map((x) => JSON.parse(x));
  assert.equal(notes[0].id, entry.id);
});

test('dead subscriptions (410 Gone) are cleaned up', async () => {
  const store = getStore();
  const dead = https.createServer(tls, (req, res) => { req.resume(); res.statusCode = 410; res.end(); });
  await new Promise((r) => dead.listen(0, r));
  const k = crypto.createECDH('prime256v1'); k.generateKeys();
  await store.hset('push:iGodHackerr', 'gone', JSON.stringify({ endpoint: `https://localhost:${dead.address().port}/x`, keys: { p256dh: b64u(k.getPublicKey()), auth: b64u(crypto.randomBytes(16)) }, createdAt: 1 }));
  const { push } = await notify('iGodHackerr', { type: 'test', title: 't', body: 'b' }, {});
  assert.deepEqual(push, { sent: 0, failed: 1 });
  assert.equal(await store.hget('push:iGodHackerr', 'gone'), null);
  dead.closeAllConnections?.(); dead.close();
});
