#!/usr/bin/env node
// Regression check (ui18 job 6): the live indicator row is always the last row,
// flush above the composer, and the pane never traps its reader.
//
// ui17 job 19 fixed a Claude session whose short tool rows collapsed the loaded
// window; its check tolerated up to one viewport of blank below the last row,
// which is why Willem hit the same trap again on 2026-08-29 with a Codex
// session (ui18 unit 1, gpt-5.6-sol) whose last row was a live "Thinking"
// indicator: rows at the top of the pane, about 400px of dead pane between the
// indicator and the composer, and a wheel that did nothing until a refresh.
//
// The three laws asserted here, at every sample and at both viewports:
//
//   1. Nothing below the indicator occupies visible space. The only thing under
//      it is the composer-clearance spacer, which is exactly the composer's own
//      height and hides behind it.
//   2. The indicator's bottom edge sits at the composer's top edge minus the
//      transcript row gap (0.75rem on the phone, 1rem from sm up).
//   3. A wheel moves scrollTop, unless the whole transcript is already on
//      screen. A pane with rows above its top edge and no scroll range is the
//      trap: the reader cannot reach them, and the fill loop that would grow
//      the loaded window is driven by scroll events the pane cannot fire.
//
// usage: node scripts/dev/check-live-indicator-flush.mjs <rollout> <sessionId> [WxH] [cdpPort]
//   The dev app must already be open in the CDP Chrome (port 9500 by default)
//   with the worker pane on that session. `make-codex-pane-fixture.mjs` builds
//   the rollout and registers the session.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const [file, sessionId, viewportArg = '1440x1000', portArg = '9500'] = process.argv.slice(2);
if (!file || !sessionId) {
  console.error('usage: check-live-indicator-flush.mjs <rollout> <sessionId> [WxH] [cdpPort]');
  process.exit(2);
}
const [width, height] = viewportArg.split('x').map(Number);
const port = Number(portArg);

/** Tailwind's `space-y-3` / `sm:space-y-4` between transcript rows. */
const ROW_GAP_PX = width >= 640 ? 16 : 12;
/** Sub-pixel layout and a scrollbar rounding are not a gap. */
const FLUSH_TOLERANCE_PX = 3;
/** Rows written to the rollout take about this long to reach the pane. */
const WATCHER_LATENCY_MS = 9_000;
/** How many short tool rows to stream; the shape that collapses a window. */
const STREAMED_ROWS = 60;

const turnId = randomUUID();
const appendEvent = (payload) => {
  fs.appendFileSync(file, `${JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload })}\n`);
};

/** One short Codex tool row: a call and its output, the pair that groups. */
const appendToolRow = (index) => {
  const callId = `call_j6_${Date.now()}_${index}`;
  appendEvent({
    type: 'custom_tool_call',
    id: `ctc_j6_${Date.now()}_${index}`,
    status: 'completed',
    call_id: callId,
    name: 'exec',
    input: JSON.stringify({ cmd: `echo row ${index}`, workdir: process.cwd(), yield_time_ms: 1000 }),
    internal_chat_message_metadata_passthrough: { turn_id: turnId },
  });
  appendEvent({
    type: 'custom_tool_call_output',
    id: `ctco_j6_${Date.now()}_${index}`,
    call_id: callId,
    output: [{ type: 'input_text', text: `Script completed\nWall time 0.1 seconds\nOutput:\nrow ${index}` }],
    internal_chat_message_metadata_passthrough: { turn_id: turnId },
  });
};

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === 'page' && /127\.0\.0\.1:47\d\d/.test(t.url));
if (!page) {
  console.error('no dev app page found in the CDP browser');
  process.exit(2);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let failed = false;
try {
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 1;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message.result);
      pending.delete(message.id);
    }
  };
  const send = (method, params) => new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = (expression) => send('Runtime.evaluate', { expression, returnByValue: true })
    .then((result) => result?.result?.value);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  await send('Page.bringToFront', {});
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 0, mobile: width < 640,
  });
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });
  await wait(1_500);

  // Every measurement in one eval: React must not get a chance to re-render
  // between the reads, or the geometry describes two different frames.
  const SAMPLE = `(() => {
    const pane = [...document.querySelectorAll('[data-slot=message-scroller]')]
      .find((node) => node.dataset.sessionId === ${JSON.stringify(sessionId)});
    if (!pane) return JSON.stringify({ missing: 'pane' });
    const viewport = pane.querySelector(':scope > section');
    const log = viewport.querySelector('[role=log]');
    const indicator = log.querySelector('[data-testid=activity-indicator]');
    const spacer = log.querySelector('[data-slot=composer-clearance]');
    const chatPane = pane.closest('[data-slot=chat-pane]');
    const composer = chatPane.querySelector('[data-slot=composer-area]');
    if (!indicator) return JSON.stringify({ missing: 'indicator' });
    if (!composer) return JSON.stringify({ missing: 'composer' });
    const box = (node) => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
    const indicatorBox = box(indicator);
    const composerBox = box(composer);
    const logBox = box(log);
    const rows = log.querySelectorAll('.chat-message');
    const paneBox = viewport.getBoundingClientRect();
    const first = rows[0];
    return JSON.stringify({
      rows: rows.length,
      // True when the transcript's first row starts inside the pane: there is
      // nothing above the top edge for a wheel to reach.
      wholeTranscriptVisible: Boolean(first) && first.getBoundingClientRect().top >= paneBox.top - 1,
      // The follow engine smooth-scrolls to the live edge as rows land; the
      // resting place of the indicator is only meaningful once it arrives.
      atLiveEdge: viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 2,
      scrollTop: Math.round(viewport.scrollTop),
      scrollHeight: viewport.scrollHeight,
      clientHeight: viewport.clientHeight,
      slack: viewport.scrollHeight - viewport.clientHeight,
      // Everything under the indicator inside the scrolled content. The spacer
      // is allowed to be there and only there, because it is exactly the
      // composer's height and lives behind it.
      belowIndicator: Math.round(logBox.bottom - indicatorBox.bottom),
      spacerHeight: spacer ? Math.round(box(spacer).height) : null,
      flushGap: Math.round(composerBox.top - indicatorBox.bottom),
      indicatorBottom: Math.round(indicatorBox.bottom),
      composerTop: Math.round(composerBox.top),
      x: Math.round(paneBox.left + paneBox.width / 2),
      y: Math.round(paneBox.top + paneBox.height / 2),
    });
  })()`;

  const read = async () => {
    const value = JSON.parse(await evaluate(SAMPLE));
    if (value.missing) {
      console.error(`the pane check cannot run: no ${value.missing} for session ${sessionId}`);
      process.exit(2);
    }
    return value;
  };

  // The transcript keeps re-laying-out for a while after any append; a law
  // measured to the pixel waits for the geometry to stop moving first.
  const quiesce = async (label) => {
    let stable = 0;
    let last = -1;
    for (let attempt = 0; attempt < 30 && stable < 3; attempt += 1) {
      const pane = await read();
      if (pane.scrollHeight === last) stable += 1;
      else { stable = 0; last = pane.scrollHeight; }
      await wait(600);
    }
    const pane = await read();
    console.log(`${label}: ${pane.rows} rows, ${pane.scrollHeight}px of content in a ${pane.clientHeight}px pane`);
    return pane;
  };

  const violations = [];
  const judge = (label, pane) => {
    // Law 1: only the composer-clearance spacer sits under the indicator.
    if (pane.spacerHeight === null) {
      violations.push(`${label}: no composer-clearance spacer in the transcript`);
    } else if (Math.abs(pane.belowIndicator - pane.spacerHeight) > FLUSH_TOLERANCE_PX) {
      violations.push(
        `${label}: ${pane.belowIndicator - pane.spacerHeight}px of content below the indicator that is not the spacer`,
      );
    }
    // Law 2: the indicator sits one row gap above the composer.
    if (Math.abs(pane.flushGap - ROW_GAP_PX) > FLUSH_TOLERANCE_PX) {
      violations.push(
        `${label}: the indicator sits ${pane.flushGap}px above the composer, not ${ROW_GAP_PX}px`
        + ` (indicator bottom ${pane.indicatorBottom}, composer top ${pane.composerTop})`,
      );
    }
  };

  // Chrome delivers only part of one large wheel delta, so a reader gesture is
  // dispatched as real notches the way a trackpad sends them.
  const wheel = async (pane, deltaY) => {
    const step = deltaY < 0 ? -120 : 120;
    for (let sent = 0; Math.abs(sent) < Math.abs(deltaY); sent += step) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: pane.x, y: pane.y, deltaX: 0, deltaY: step, pointerType: 'mouse',
      });
      await wait(40);
    }
    await wait(700);
  };

  // Law 3: a wheel up moves scrollTop, or the whole transcript is on screen.
  // Scrolling is the reader's only way back through a transcript, and an
  // unscrollable pane can never fire the scroll event that would grow the
  // loaded window - so a pane with rows above its top edge and no scroll range
  // is a reader with no way out.
  const wheelMoves = async (label) => {
    const before = await read();
    await wheel(before, -600);
    const after = await read();
    const moved = Math.abs(after.scrollTop - before.scrollTop);
    if (moved < 1 && !after.wholeTranscriptVisible) {
      violations.push(`${label}: a 600px wheel up left scrollTop at ${before.scrollTop} (slack ${before.slack}px) with rows above the pane - the pane is locked`);
    } else if (moved < 1) {
      console.log(`${label}: no scroll range, and the whole transcript is on screen`);
    } else {
      console.log(`${label}: a wheel up moved scrollTop ${before.scrollTop} -> ${after.scrollTop}`);
    }
    // Back to the live edge so the next stage measures the pinned pane.
    await wheel(after, 4_000);
  };

  console.log(`viewport ${width}x${height}, row gap ${ROW_GAP_PX}px, session ${sessionId}`);
  const settled = await quiesce('opened');
  judge('opened', settled);
  console.log(
    `opened: indicator bottom ${settled.indicatorBottom}, composer top ${settled.composerTop},`
    + ` gap ${settled.flushGap}px, ${settled.belowIndicator}px below the indicator`
    + ` (spacer ${settled.spacerHeight}px), scrollTop ${settled.scrollTop}, slack ${settled.slack}px`,
  );
  await wheelMoves('opened');

  console.log(`streaming ${STREAMED_ROWS} short tool rows into the live transcript`);
  for (let row = 0; row < STREAMED_ROWS; row += 1) {
    appendToolRow(row);
    if (row % 10 === 9) {
      // Judge the resting pane, not a frame of the engine's own smooth re-pin:
      // mid-animation the last row is legitimately still under the composer.
      let pane = await read();
      for (let attempt = 0; attempt < 8 && !pane.atLiveEdge; attempt += 1) {
        await wait(400);
        pane = await read();
      }
      judge(`row ${row}`, pane);
    }
    await wait(120);
  }
  await wait(WATCHER_LATENCY_MS);
  const streamed = await quiesce('streamed');
  judge('streamed', streamed);
  console.log(
    `streamed: indicator bottom ${streamed.indicatorBottom}, composer top ${streamed.composerTop},`
    + ` gap ${streamed.flushGap}px, ${streamed.belowIndicator}px below the indicator`
    + ` (spacer ${streamed.spacerHeight}px), scrollTop ${streamed.scrollTop}, slack ${streamed.slack}px`,
  );
  await wheelMoves('streamed');

  if (violations.length > 0) {
    failed = true;
    console.log(`FAIL: ${violations.length} violation(s)`);
    for (const violation of violations.slice(0, 8)) console.log(`  ${violation}`);
  } else {
    console.log('PASS: the indicator stayed flush above the composer, nothing else sat below it, and the wheel always moved the pane');
  }
} finally {
  ws.close();
}
process.exit(failed ? 1 : 0);
