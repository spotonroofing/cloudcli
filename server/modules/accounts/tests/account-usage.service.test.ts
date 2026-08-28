import assert from 'node:assert/strict';
import test from 'node:test';

import { createAccountUsageMonitor } from '../account-usage.service.js';

type WindowInput = { pct: number; resetsAt?: string };
type AccountInput = {
  number: number;
  email: string;
  fiveHour?: WindowInput;
  sevenDay?: WindowInput;
  fable?: WindowInput;
  disabled?: boolean;
  parkedUntil?: string;
};

const payload = (
  accounts: AccountInput[],
  chatgptSevenDay?: WindowInput,
) => ({
  accounts: accounts.map((account) => ({
    number: account.number,
    email: account.email,
    active: account.number === 1,
    disabled: account.disabled,
    parkedUntil: account.parkedUntil,
    usage: {
      fiveHour: account.fiveHour,
      sevenDay: account.sevenDay,
      scoped: account.fable ? [{ name: 'Fable', ...account.fable }] : [],
    },
  })),
  chatgpt: {
    email: 'chatgpt@example.com',
    usage: chatgptSevenDay ? { sevenDay: chatgptSevenDay, readAt: '2026-08-27T12:00:00.000Z' } : null,
  },
});

const defaultThresholds = {
  accountWarning: 75,
  accountUrgent: 90,
  fleetWarning: 75,
  fleetUrgent: 90,
  fleetSevenDay: 90,
};

function harness(initial: unknown, initialState: string | null = null) {
  let current = initial;
  let storedState = initialState;
  let thresholds = { ...defaultThresholds };
  const alerts: Array<{ key: string; title: string; body: string }> = [];
  const broadcasts: unknown[] = [];
  const monitor = createAccountUsageMonitor({
    readAccounts: async () => current,
    getThresholds: () => thresholds,
    readState: () => storedState,
    writeState: (value) => { storedState = value; },
    notify: (alert) => { alerts.push(alert); },
    broadcastAccounts: (value) => { broadcasts.push(value); },
    now: () => new Date('2026-08-27T12:00:00.000Z'),
    setInterval,
    clearInterval,
  });
  return {
    monitor,
    alerts,
    broadcasts,
    state: () => storedState,
    setPayload: (value: unknown) => { current = value; },
    setThresholds: (value: Partial<typeof thresholds>) => { thresholds = { ...thresholds, ...value }; },
  };
}

test('per-account thresholds gate on fresh Claude headroom and never repeat a crossing', async () => {
  const base = payload([
    { number: 1, email: 'busy@example.com', fiveHour: { pct: 70 } },
    { number: 2, email: 'fresh@example.com', fiveHour: { pct: 20 } },
  ]);
  const run = harness(base);
  await run.monitor.refresh('baseline');

  run.setPayload(payload([
    { number: 1, email: 'busy@example.com', fiveHour: { pct: 76 } },
    { number: 2, email: 'fresh@example.com', fiveHour: { pct: 20 } },
  ]));
  await run.monitor.refresh('cross-with-target');
  assert.equal(run.alerts.some((alert) => alert.title.startsWith('busy@example.com')), false);

  // The gated crossing is consumed: drying the target later cannot create a
  // late repeat while the source stays above 75%.
  run.setPayload(payload([
    { number: 1, email: 'busy@example.com', fiveHour: { pct: 76 } },
    { number: 2, email: 'fresh@example.com', fiveHour: { pct: 82 } },
  ]));
  await run.monitor.refresh('target-dried');
  assert.equal(run.alerts.some((alert) => alert.title.startsWith('busy@example.com')), false);
});

test('per-account alerts include a nearly-dry best target at 75%, 90%, and exhaustion', async () => {
  const run = harness(payload([
    { number: 1, email: 'one@example.com', fiveHour: { pct: 70 } },
    { number: 2, email: 'two@example.com', fiveHour: { pct: 82 } },
  ]));
  await run.monitor.refresh('baseline');

  for (const pct of [76, 91, 100]) {
    run.setPayload(payload([
      { number: 1, email: 'one@example.com', fiveHour: { pct } },
      { number: 2, email: 'two@example.com', fiveHour: { pct: 82 } },
    ]));
    await run.monitor.refresh(`cross-${pct}`);
    await run.monitor.refresh(`repeat-${pct}`);
  }

  const accountAlerts = run.alerts.filter((alert) => alert.title.startsWith('one@example.com'));
  assert.deepEqual(accountAlerts.map((alert) => alert.title), [
    'one@example.com 5h window at 75%',
    'one@example.com 5h window at 90%',
    'one@example.com 5h window exhausted',
  ]);
  assert.equal(accountAlerts.every((alert) => alert.body === 'Best swap target two@example.com is already at 82%.'), true);

  const afterRestart = harness(payload([
    { number: 1, email: 'one@example.com', fiveHour: { pct: 100 } },
    { number: 2, email: 'two@example.com', fiveHour: { pct: 82 } },
  ]), run.state());
  await afterRestart.monitor.refresh('restart');
  assert.equal(afterRestart.alerts.filter((alert) => alert.title.startsWith('one@example.com')).length, 0);
});

test('fleet and ChatGPT windows use their documented thresholds and wording', async () => {
  const run = harness(payload([
    { number: 1, email: 'one@example.com', fiveHour: { pct: 70 }, sevenDay: { pct: 89 }, fable: { pct: 70 } },
    { number: 2, email: 'two@example.com', fiveHour: { pct: 70 }, sevenDay: { pct: 89 }, fable: { pct: 70 } },
  ], { pct: 70 }));
  await run.monitor.refresh('baseline');

  run.setPayload(payload([
    { number: 1, email: 'one@example.com', fiveHour: { pct: 76 }, sevenDay: { pct: 91 }, fable: { pct: 76 } },
    { number: 2, email: 'two@example.com', fiveHour: { pct: 76 }, sevenDay: { pct: 91 }, fable: { pct: 76 } },
  ], { pct: 76 }));
  await run.monitor.refresh('warning');
  run.setPayload(payload([
    { number: 1, email: 'one@example.com', fiveHour: { pct: 91 }, sevenDay: { pct: 91 }, fable: { pct: 91 } },
    { number: 2, email: 'two@example.com', fiveHour: { pct: 91 }, sevenDay: { pct: 91 }, fable: { pct: 91 } },
  ], { pct: 91 }));
  await run.monitor.refresh('urgent');
  run.setPayload(payload([
    { number: 1, email: 'one@example.com', fiveHour: { pct: 91 }, sevenDay: { pct: 91 }, fable: { pct: 91 } },
    { number: 2, email: 'two@example.com', fiveHour: { pct: 91 }, sevenDay: { pct: 91 }, fable: { pct: 91 } },
  ], { pct: 100 }));
  await run.monitor.refresh('chatgpt-exhausted');

  assert.deepEqual(
    run.alerts.filter((alert) => alert.title.startsWith('Fleet')).map((alert) => alert.title),
    [
      'Fleet 5h window at 75%',
      'Fleet 7-day window at 90%',
      'Fleet Fable window at 75%',
      'Fleet 5h window at 90%',
      'Fleet Fable window at 90%',
    ],
  );
  assert.deepEqual(
    run.alerts.filter((alert) => alert.title.startsWith('ChatGPT')).map((alert) => alert.title),
    [
      'ChatGPT (chatgpt@example.com) 7-day window at 75%',
      'ChatGPT (chatgpt@example.com) 7-day window at 90%',
      'ChatGPT (chatgpt@example.com) 7-day window exhausted',
    ],
  );
});

test('threshold edits affect the next crossing and recovery excludes parked, disabled, and ChatGPT accounts', async () => {
  const resetLater = '2026-08-27T14:00:00.000Z';
  const resetSooner = '2026-08-27T13:00:00.000Z';
  const run = harness(payload([
    { number: 1, email: 'one@example.com', fiveHour: { pct: 95, resetsAt: resetLater } },
    { number: 2, email: 'parked@example.com', fiveHour: { pct: 0, resetsAt: resetSooner }, parkedUntil: '2026-09-01' },
    { number: 3, email: 'disabled@example.com', fiveHour: { pct: 0 }, disabled: true },
  ], { pct: 0 }));
  run.setThresholds({ accountWarning: 80 });
  await run.monitor.refresh('baseline');
  assert.deepEqual(run.monitor.getRecoveryStatus(), { hasHeadroom: false, earliestResetAt: resetLater });

  run.setPayload(payload([
    { number: 1, email: 'one@example.com', fiveHour: { pct: 79, resetsAt: resetLater } },
    { number: 2, email: 'parked@example.com', fiveHour: { pct: 0, resetsAt: resetSooner }, parkedUntil: '2026-09-01' },
  ], { pct: 0 }));
  await run.monitor.refresh('edited-baseline');
  run.setPayload(payload([
    { number: 1, email: 'one@example.com', fiveHour: { pct: 81, resetsAt: resetLater } },
    { number: 2, email: 'parked@example.com', fiveHour: { pct: 0, resetsAt: resetSooner }, parkedUntil: '2026-09-01' },
  ], { pct: 0 }));
  await run.monitor.refresh('edited-crossing');
  assert.equal(run.alerts.some((alert) => alert.title === 'one@example.com 5h window at 80%'), true);

  let regained = false;
  run.monitor.subscribeRecovery((status) => { regained = regained || status.hasHeadroom; });
  run.setPayload(payload([
    { number: 1, email: 'one@example.com', fiveHour: { pct: 10, resetsAt: resetLater } },
  ], { pct: 100 }));
  await run.monitor.refresh('headroom-returned');
  assert.equal(regained, true);
  assert.equal(run.broadcasts.length, 4);
});
