// One-off helper: generates strong secrets and writes .env (refuses to overwrite).
import crypto from 'node:crypto';
import fs from 'node:fs';
import webpush from 'web-push';

if (fs.existsSync('.env')) {
  console.error('.env already exists - refusing to overwrite. Delete it first if you really want new secrets.');
  process.exit(1);
}

// Typeable on a phone: no look-alike chars (0/O, 1/l/I), 4 groups of 4 = ~92 bits of entropy.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const pick = () => ALPHABET[crypto.randomInt(ALPHABET.length)];
const group = () => Array.from({ length: 4 }, pick).join('');
const password = () => [group(), group(), group(), group()].join('-');

const vapid = webpush.generateVAPIDKeys();

const env = `# ──────────────────────────────────────────────────────────────
#  Ball Dibs - secrets.  NEVER commit this file (it is git-ignored).
#  For Vercel: Project -> Settings -> Environment Variables -> paste this whole file.
# ──────────────────────────────────────────────────────────────

# Login passwords (you can change them later inside the app, Settings -> Change password)
PASSWORD_IGODHACKERR=${password()}
PASSWORD_KINGOFWORD=${password()}

# Signs login cookies. Changing it logs everyone out.
SESSION_SECRET=${crypto.randomBytes(48).toString('hex')}

# Protects the daily reminder job (Vercel Cron sends it automatically).
CRON_SECRET=${crypto.randomBytes(32).toString('hex')}

# Web-push keys for notifications.
VAPID_PUBLIC_KEY=${vapid.publicKey}
VAPID_PRIVATE_KEY=${vapid.privateKey}

# Where you live (decides what "today" and "Friday" mean).
APP_TIMEZONE=Asia/Kolkata

# Dibs weeks run Friday -> Thursday (Friday = air refill day). This is the first Friday a dib
# can start. Today = Tue 17 Nov 2026, so this week + next week are free-for-all.
DIBS_OPEN_FROM=2026-11-27

# Database: add "Upstash Redis" from the Vercel Marketplace (Storage tab) - Vercel then
# injects these two automatically. Leave them empty locally (a local JSON file is used).
# KV_REST_API_URL=
# KV_REST_API_TOKEN=
`;
fs.writeFileSync('.env', env, { mode: 0o600 });
console.log('Wrote .env');
