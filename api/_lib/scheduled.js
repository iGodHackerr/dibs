// "Dibs ending" reminders. Vercel Cron runs this once a day; the app also nudges it (throttled) so a
// missed cron run never means a missed reminder. Every message is sent at most once (SET NX guard).
import { otherUser } from './config.js';
import { addDays, nice } from './dates.js';
import { notify } from './notify.js';
import { loadDibs, today } from './service.js';
import { getStore } from './store.js';

const once = async (key) => !!(await getStore().set('sent:' + key, '1', { nx: true, ex: 60 * 60 * 24 * 30 }));

export async function runScheduled(req) {
  const now = today();
  const dibs = await loadDibs();
  const sent = [];

  for (const dib of Object.values(dibs)) {
    if (dib.weekEnd < now) continue;
    const holder = dib.user;
    const other = otherUser(holder);
    const dayBefore = addDays(dib.weekEnd, -1);

    // Holder: heads-up ~24h before the dib ends (the day before; catch up on the last day if missed).
    if ((now === dayBefore || now === dib.weekEnd) && (await once(`ending-soon:${dib.id}:${holder}`))) {
      const tomorrow = now === dayBefore;
      await notify(holder, {
        type: 'dibs-ending-soon',
        title: tomorrow ? '⏳ Your dibs ends tomorrow' : '⏳ Your dibs ends today',
        body: `Your dibs on the ball ends ${tomorrow ? 'tomorrow' : 'today'} (${nice(dib.weekEnd)}). Friday is air refill day, then the next week starts.`,
      }, req);
      sent.push(`ending-soon:${holder}`);
    }

    // Other person: on the day it ends.
    if (now === dib.weekEnd && (await once(`ending-today:${dib.id}:${other}`))) {
      const next = dibs[addDays(dib.weekEnd, 1)];
      const tail = next
        ? next.user === other ? 'Your own dibs starts right after the Friday refill.' : `${holder} has dibs again next week.`
        : 'After the Friday refill the ball is free play.';
      await notify(other, {
        type: 'dibs-ending-today',
        title: `🔔 ${holder}'s dibs ends today`,
        body: tail,
      }, req);
      sent.push(`ending-today:${other}`);
    }
  }
  return sent;
}

/** Cheap enough to call on every state fetch: runs at most once every 10 minutes. */
export async function maybeRunScheduled(req) {
  try {
    if (await getStore().set('sched:throttle', '1', { nx: true, ex: 600 })) await runScheduled(req);
  } catch (e) {
    console.error('scheduled run failed', e);
  }
}
