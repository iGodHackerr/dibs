# Ball Dibs

A tiny installable web app (PWA) for two friends sharing one ball. Call dibs on a week, or book a 5-hour play
session on a free week with an iOS-alarm-style clock. See who has the ball on a normal calendar and get pinged
when things change. iOS-style liquid-glass design. The app icon is the Claude Code mascot.

**Logins:** `iGodHackerr` and `KingOfWord` - passwords are in the `.env` file (change them in the app under **You → Change password**).

## The rules (all enforced by the server)

| Rule | Detail |
| --- | --- |
| A dib is **one week**, **Friday → Thursday** | Friday is air-refill day, so a new week starts on Friday and every dib ends on a Thursday |
| **2 dibs per month** each | counted by the month the week *starts* in. Letting go of a dib gives the slot back |
| **Up to 4 weeks ahead** | no calling dibs further out than that |
| **No dibs until Fri 27 Nov 2026** | this week + next week are free-for-all (`DIBS_OPEN_FROM` in `.env`) |
| **No dibs = free play** | either of you can use the ball |
| You can call dibs on the *current* week | if it's unclaimed, it still ends that Thursday |

**5-hour sessions** (only on weeks where *nobody* has weekly dibs):

| Rule | Detail |
| --- | --- |
| **Pick any start time** | spin the clock (hour / minute / AM-PM) and book. It lasts 5 hours and may run past midnight |
| **One session a day**, shared | the ball is never booked twice in a day. Sessions can't overlap either |
| **No sessions on a weekly-dibs week** | and a week can't be claimed while the *other* person has an unfinished session in it (cancel it first). Your own sessions in a week you claim are folded into the dibs |
| **Up to 4 weeks ahead**, nothing in the past | "Start now" fills in the current time |
| **Cancel** | your own, any time before it starts |

Calendar colours: **green** = your dibs · **red** = the other person's dibs · striped = dibs not open yet.
Change the numbers in `api/_lib/config.js`.

## Notifications

* **Instant:** the other person is pinged when you call dibs or let go of them.
* **Instant, sessions:** when you book a session the other person is told *"iGodHackerr will start a session at 3:00 PM · Tue 17 Nov · 3:00 PM → 8:00 PM"*, and again if you cancel it.
* **Wednesday (24h before):** the person whose dibs end Thursday gets a heads-up.
* **Thursday (the day it ends):** the other person is told.

Delivered as phone push notifications *and* shown in the in-app **Activity** tab. Reminders are sent by a daily
Vercel Cron job (03:30 UTC = 09:00 India time), and the app also nudges the same check whenever it's opened,
so a missed cron run never means a missed reminder. Each message is sent once.

> **iPhone:** push only works after you add the app to your Home Screen (iOS 16.4+), then turn it on under **You → Push notifications**.

## Run it on your computer

```bash
npm install
npm run dev        # http://localhost:3000   (uses a local JSON file as the database)
npm test           # rules, API, push encryption, reminders, Redis client
FAKE_TODAY=2026-12-02 FAKE_MINUTES=855 npm run dev   # pretend it's another day / 2:15 PM (never works on Vercel)
npm run icons      # re-render the app icons (needs Python + Pillow)
```

## Put it on Vercel

1. Push this folder to a GitHub repo (`.env` is git-ignored, it will not be uploaded) and **Import** it in Vercel.
   Framework preset: **Other**. No build command needed.
2. **Storage tab → Create Database → Upstash Redis** (free) → connect it to the project.
   Vercel adds `KV_REST_API_URL` / `KV_REST_API_TOKEN` for you. This is where dibs live.
3. **Settings → Environment Variables:** open your local `.env`, copy everything, and paste it into the first
   "Key" box. Vercel splits it into separate variables. (Leave the commented `KV_` lines out.)
4. **Deploy.** Open the URL on your phone and sign in.

**Add to Home Screen**
* iPhone: Safari → Share ▢↑ → **Add to Home Screen**.
* Android: Chrome → ⋮ → **Install app** (or use the Install button under *You*). It opens full screen, edge to edge.
* **Updated the icon or look?** Phones cache the icon and manifest when the app is installed. Remove the app and add it again to see the new icon (Android can also take up to a day to update it by itself).

## Good to know

* **Forgot a changed password?** In the Upstash console delete the key `pw:<username>`. The password from `.env` works again.
* **Sign everyone out:** change `SESSION_SECRET`.
* **Android full screen:** `public/manifest.webmanifest` asks for `fullscreen`, which hides the status bar. If you'd rather see the clock and battery, change `"display_override"` to `["standalone"]` (the bar then matches the app background instead of being black).
* **Session reminders:** booking and cancelling notify instantly. There is no "it's starting now" ping, because Vercel's free cron only runs once a day.
* **Timezone** decides what "today" and "Thursday" mean: `APP_TIMEZONE` (default `Asia/Kolkata`).
* Vercel's free (Hobby) plan allows one cron run per day, which is exactly what this needs.
* Security: signed HttpOnly cookie sessions, scrypt-hashed changed passwords, login rate-limiting, CSRF header check, strict CSP.

## Layout

```
api/            serverless endpoints (session, state, dibs, password, push, notifications, cron)
api/_lib/       rules, storage, auth, push, reminders
public/         the app (index.html, css/, js/, sw.js, manifest, icons/)
scripts/        dev-server.js, gen-env.mjs (new secrets), make-icons.py
test/           node --test suites
```
