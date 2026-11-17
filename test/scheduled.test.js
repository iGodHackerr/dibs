// Reminder logic, run in-process so we can move "today" around.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dibs-sched-'));
process.env.DATA_FILE = path.join(dir, 'db.json');
process.env.DIBS_OPEN_FROM = '2026-11-27';
process.env.FAKE_TODAY = '2026-11-30';

const { createDib, buildState } = await import('../api/_lib/service.js');
const { runScheduled } = await import('../api/_lib/scheduled.js');

test('holder gets a heads-up the day before the Thursday end; the other person on the day', async () => {
  await createDib('iGodHackerr', '2026-12-04'); // Fri 4 Dec -> Thu 10 Dec

  process.env.FAKE_TODAY = '2026-12-08';        // Tue: nothing yet
  assert.deepEqual(await runScheduled(), []);

  process.env.FAKE_TODAY = '2026-12-09';        // Wed = 24h before the end
  assert.deepEqual(await runScheduled(), ['ending-soon:iGodHackerr']);
  assert.deepEqual(await runScheduled(), []);   // never twice

  process.env.FAKE_TODAY = '2026-12-10';        // Thu = the day it ends
  assert.deepEqual(await runScheduled(), ['ending-today:KingOfWord']);
  assert.deepEqual(await runScheduled(), []);

  const holder = await buildState('iGodHackerr');
  assert.match(holder.notifications[0].title, /ends tomorrow/);
  const other = await buildState('KingOfWord');
  assert.match(other.notifications[0].title, /iGodHackerr's dibs ends today/);
  assert.match(other.notifications[0].body, /Friday refill/);
});

test('if the day-before run was missed, the holder is told on the last day', async () => {
  process.env.FAKE_TODAY = '2026-12-02';
  await createDib('KingOfWord', '2026-12-11'); // ends Thu 17 Dec
  process.env.FAKE_TODAY = '2026-12-17';
  assert.deepEqual((await runScheduled()).sort(), ['ending-soon:KingOfWord', 'ending-today:iGodHackerr']);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
