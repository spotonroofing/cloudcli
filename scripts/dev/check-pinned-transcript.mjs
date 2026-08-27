#!/usr/bin/env node
// Regression check (ui13 job 15): a transcript pinned to its live edge must stay
// there through background updates. Drives the dev app in the verification
// Chrome over CDP, appends synthetic turns to a session's JSONL (the dev
// watcher indexes them and every pane showing that session refetches its
// tail), and samples every open transcript's distance from the bottom. Any
// pane that starts pinned and drifts away for longer than the re-pin window
// without a user scroll fails the check.
//
// usage: node scripts/dev/check-pinned-transcript.mjs <jsonl> <sessionId> <cwd> [seconds] [cdpPort]
//   The page under test must already be open in the CDP Chrome (port 9500 by
//   default, the ~/browser-profiles/cloudcli instance) on the dev origin.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const [file, sessionId, cwd, secondsArg = '40', portArg = '9500'] = process.argv.slice(2);
if (!file || !sessionId || !cwd) {
  console.error('usage: check-pinned-transcript.mjs <jsonl> <sessionId> <cwd> [seconds] [cdpPort]');
  process.exit(2);
}
const seconds = Number(secondsArg);
const port = Number(portArg);
/** A pane may sit off the bottom while a smooth re-pin animates; longer is a failure. */
const REPIN_WINDOW_MS = 1500;
const PINNED_TOLERANCE_PX = 8;

let parent = null;
/**
 * `lines` > 1 lands one tall assistant message: a re-pin over ~600px animates
 * longer than a fixed guard timer, which is exactly how the follow engine
 * used to disengage (ui13 job 15). The check always leads with one.
 */
const appendTurn = (lines = 1) => {
  const n = Date.now();
  const stamp = () => ({
    parentUuid: parent,
    isSidechain: false,
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    userType: 'external',
    entrypoint: 'sdk-ts',
    cwd,
    sessionId,
    version: '2.1.241',
    gitBranch: 'main',
  });
  const user = { ...stamp(), type: 'user', promptId: randomUUID(), message: { role: 'user', content: `Background turn ${n}: anything new on the export?` } };
  fs.appendFileSync(file, `${JSON.stringify(user)}\n`);
  parent = user.uuid;
  const assistant = {
    ...stamp(),
    type: 'assistant',
    requestId: `req_bg${n}`,
    message: {
      model: 'claude-fable-5', id: `msg_bg${n}`, type: 'message', role: 'assistant',
      content: [{
        type: 'text',
        text: Array.from({ length: lines }, (_, i) => `Background reply ${n} line ${i + 1}: still quiet, nothing new landed in the export folder.`).join('\n'),
      }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 2, cache_creation_input_tokens: 10, cache_read_input_tokens: 500, output_tokens: 20 },
    },
  };
  fs.appendFileSync(file, `${JSON.stringify(assistant)}\n`);
  parent = assistant.uuid;
};

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const devPages = targets.filter((t) => t.type === 'page' && /127\.0\.0\.1:47\d\d/.test(t.url));
// A shared verification browser can have several dev tabs. Prefer the tab
// already displaying the requested session so the append check never samples
// an unrelated transcript merely because CDP returned that target first.
const page = devPages.find((t) => t.url.includes(`/session/${encodeURIComponent(sessionId)}`))
  ?? devPages[0];
if (!page) {
  console.error('no dev app page found in the CDP browser');
  process.exit(2);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 1;
const pending = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(String(event.data));
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  }
};
const send = (method, params) => new Promise((resolve) => {
  const id = nextId++;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = (expression) => send('Runtime.evaluate', { expression, returnByValue: true })
  .then((result) => result?.result?.value);

// ResizeObserver delivery is suspended for a background tab in headless
// Chrome. Make the chosen session target active before sampling the follow
// engine, especially when the shared verification browser has another tab.
await send('Page.bringToFront', {});
// The follow engine re-pins with a smooth scroll unless the OS asks for
// reduced motion; the smooth path is the one under test, so pin the media
// feature for the life of this CDP session (it resets on detach).
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
await new Promise((r) => setTimeout(r, 300));

const SAMPLE = `JSON.stringify([...document.querySelectorAll('[data-slot=message-scroller] > section')].map((v, i) => ({
  i, rows: v.querySelectorAll('.chat-message').length,
  gap: Math.round(v.scrollHeight - v.clientHeight - v.scrollTop),
  scrollable: v.scrollHeight > v.clientHeight,
})))`;

const initial = JSON.parse(await evaluate(SAMPLE));
const watched = initial.filter((p) => p.rows > 0 && p.scrollable && p.gap <= PINNED_TOLERANCE_PX);
console.log(`watching ${watched.length} pinned pane(s) of ${initial.length}; appending one tall turn then a small turn every 700ms for ${seconds}s`);
if (watched.length === 0) {
  console.error('no pinned, scrollable transcript on the page — open the session first');
  process.exit(2);
}

const driftSince = new Map();
const failures = [];
let maxRows = new Map(watched.map((p) => [p.i, p.rows]));
const deadline = Date.now() + seconds * 1000;
let lastAppend = 0;
let appended = 0;
while (Date.now() < deadline) {
  if (Date.now() - lastAppend >= 700) {
    appendTurn(appended === 0 ? 120 : 1);
    appended += 1;
    lastAppend = Date.now();
  }
  const sample = JSON.parse(await evaluate(SAMPLE));
  for (const { i } of watched) {
    const pane = sample[i];
    if (!pane) continue;
    maxRows.set(i, Math.max(maxRows.get(i), pane.rows));
    if (pane.gap > PINNED_TOLERANCE_PX) {
      const since = driftSince.get(i) ?? Date.now();
      driftSince.set(i, since);
      if (Date.now() - since > REPIN_WINDOW_MS && !failures.some((f) => f.i === i)) {
        failures.push({ i, gap: pane.gap, rows: pane.rows });
        console.log(`FAIL pane ${i}: ${pane.gap}px off the bottom for >${REPIN_WINDOW_MS}ms (rows ${pane.rows})`);
      }
    } else {
      driftSince.delete(i);
    }
  }
  await new Promise((r) => setTimeout(r, 120));
}

// Second stage: a large landing straight into the DOM of each watched pane
// (a 2000px block, then more growth 450ms later, while the re-pin is still
// animating). The watcher path above lands rows in batches that the app also
// pins with an instant scroll; this stage exercises the follow engine's
// smooth re-pin on its own, the path a big streamed tool result takes while
// the turn keeps streaming, where a re-pin animation longer than the engine's
// guard used to read as the reader leaving the live edge and follow stayed
// off for the rest of the turn.
const PROBE = (index, height) => `(() => {
  const log = document.querySelectorAll('[data-slot=message-scroller] > section')[${index}]?.querySelector('[role=log]');
  if (!log) return 'missing';
  const block = document.createElement('div');
  block.dataset.pinProbe = '1';
  block.style.height = '${height}px';
  log.appendChild(block);
  return 'ok';
})()`;
for (const { i } of watched) {
  await evaluate(PROBE(i, 2000));
  await new Promise((r) => setTimeout(r, 450));
  await evaluate(PROBE(i, 120));
  await new Promise((r) => setTimeout(r, REPIN_WINDOW_MS));
  await evaluate(PROBE(i, 120));
  await new Promise((r) => setTimeout(r, REPIN_WINDOW_MS));
  const pane = JSON.parse(await evaluate(SAMPLE))[i];
  if (pane.gap > PINNED_TOLERANCE_PX && !failures.some((f) => f.i === i)) {
    failures.push({ i, gap: pane.gap, rows: pane.rows });
    console.log(`FAIL pane ${i}: ${pane.gap}px off the bottom ${REPIN_WINDOW_MS}ms after a large landing`);
  }
  await evaluate(`document.querySelectorAll('[data-pin-probe]').forEach((e) => e.remove()); 'cleaned'`);
}
ws.close();

const grew = watched.filter((p) => maxRows.get(p.i) > p.rows);
for (const p of watched) {
  console.log(`pane ${p.i}: rows ${p.rows} -> ${maxRows.get(p.i)}, ${failures.some((f) => f.i === p.i) ? 'LEFT THE BOTTOM' : 'stayed pinned'}`);
}
if (grew.length === 0) {
  console.log('FAIL: no watched pane received the appended rows (watcher latency is ~6s; run longer or check the session)');
  process.exit(1);
}
if (failures.length > 0) process.exit(1);
console.log('PASS: every pinned pane stayed at the live edge through background updates');
