#!/usr/bin/env node
// Regression check (ui17 job 19): a transcript never traps its reader.
//
// Two laws, both driven against the dev app in the verification Chrome over
// CDP, against a real session whose JSONL this script appends to (the dev
// watcher indexes the appends and the pane refetches its tail):
//
//   A. Scrolling up releases follow. After a real wheel up, rows landing in
//      the transcript must leave scrollTop exactly where the reader left it.
//   B. No runaway space and no lock. Streaming a turn of 60 short tool rows
//      must never leave more than one viewport of empty space below the last
//      row, and the pane must stay scrollable and wheel-movable throughout.
//      Willem's 2026-08-29 screenshot: a run of Bash rows collapsed into one
//      tool group left the loaded window shorter than the pane, so the rows
//      sat at the top with ~600px of dead space below and a wheel that did
//      nothing until a page refresh.
//
// Stage A runs first, on a quiet transcript: stage B's appends set the tail
// reconciliation churning for a while afterwards, and a hold measured to the
// pixel cannot tell that reflow from a repin.
//
// usage: node scripts/dev/check-worker-pane-truth.mjs <jsonl> <sessionId> <cwd> [cdpPort]
//   The page under test must already be open in the CDP Chrome (port 9500 by
//   default) on the dev origin, showing that session.
//
// The session needs a transcript several viewports tall, or stage A has no
// room to depart into. A fixture is 40 user/assistant pairs whose assistant
// turns carry ten paragraphs of text, written to
// ~/.claude-dev/projects/<encoded-cwd>/<session-id>.jsonl, then flipped to
// `origin='planner'` in ~/.cloudcli-dev/auth.db so /api/projects lists it.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const [file, sessionId, cwd, portArg = '9500'] = process.argv.slice(2);
if (!file || !sessionId || !cwd) {
  console.error('usage: check-worker-pane-truth.mjs <jsonl> <sessionId> <cwd> [cdpPort]');
  process.exit(2);
}
const port = Number(portArg);

/** Rows arriving through the dev watcher take about this long to reach a pane. */
const WATCHER_LATENCY_MS = 9_000;
/** A wheel-up of this many pixels is the reader's departure. */
const SCROLL_UP_PX = 800;
/** Sub-pixel scroll offsets and a scrollbar-driven rounding are not a repin. */
const HELD_TOLERANCE_PX = 4;

let parent = null;
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

/** One short tool row: the shape that collapses into a tool group. */
const appendToolRow = (index) => {
  const toolId = `toolu_j19_${Date.now()}_${index}`;
  const assistant = {
    ...stamp(),
    type: 'assistant',
    requestId: `req_j19_${index}`,
    message: {
      model: 'claude-fable-5',
      id: `msg_j19_${Date.now()}_${index}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'tool_use', id: toolId, name: 'Bash', input: { command: `echo row ${index}` } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 2, cache_creation_input_tokens: 8, cache_read_input_tokens: 4_000, output_tokens: 14 },
    },
  };
  fs.appendFileSync(file, `${JSON.stringify(assistant)}\n`);
  parent = assistant.uuid;
  const result = {
    ...stamp(),
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolId, content: `row ${index}` }],
    },
    toolUseResult: { stdout: `row ${index}`, stderr: '', interrupted: false },
  };
  fs.appendFileSync(file, `${JSON.stringify(result)}\n`);
  parent = result.uuid;
};

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const devPages = targets.filter((t) => t.type === 'page' && /127\.0\.0\.1:47\d\d/.test(t.url));
const page = devPages.find((t) => t.url.includes(`/session/${encodeURIComponent(sessionId)}`)) ?? devPages[0];
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
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });
  await wait(300);

  // `blank` is the space between the bottom of the last rendered row and the
  // bottom of the scrollable content: the spacer plus anything else below it.
  // One viewport is the ceiling; ~600px under a 900px pane was the bug.
  const SAMPLE = `JSON.stringify([...document.querySelectorAll('[data-slot=message-scroller] > section')].map((viewport, i) => {
    const rows = viewport.querySelectorAll('.chat-message');
    const last = rows[rows.length - 1];
    const log = viewport.querySelector('[role=log]');
    const blank = last && log
      ? Math.round(viewport.scrollHeight - (last.getBoundingClientRect().bottom - viewport.getBoundingClientRect().top + viewport.scrollTop))
      : null;
    const box = viewport.getBoundingClientRect();
    return {
      i,
      rows: rows.length,
      blank,
      scrollTop: Math.round(viewport.scrollTop),
      scrollHeight: viewport.scrollHeight,
      clientHeight: viewport.clientHeight,
      scrollable: viewport.scrollHeight > viewport.clientHeight,
      x: Math.round(box.left + box.width / 2),
      y: Math.round(box.top + box.height / 2),
    };
  }))`;

  const initial = JSON.parse(await evaluate(SAMPLE));
  const target = initial.find((pane) => pane.rows > 0 && pane.scrollable);
  if (!target) {
    console.error('no scrollable transcript with rows on the page - open the session first');
    process.exit(2);
  }
  const index = target.i;
  console.log(`pane ${index}: ${target.rows} rows, ${target.clientHeight}px viewport, ${target.blank}px blank below the last row`);

  // Chrome animates a single large wheel delta and delivers only part of it,
  // so a departure is dispatched as real 100px notches, the way a trackpad
  // does it.
  const wheel = async (deltaY) => {
    const pane = JSON.parse(await evaluate(SAMPLE))[index];
    const step = deltaY < 0 ? -100 : 100;
    for (let sent = 0; Math.abs(sent) < Math.abs(deltaY); sent += step) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: pane.x,
        y: pane.y,
        deltaX: 0,
        deltaY: step,
        pointerType: 'mouse',
      });
      await wait(40);
    }
  };

  // The watcher's tail reconciliation keeps re-laying-out the transcript for a
  // while after the last append. Stage A measures a hold to the pixel, so it
  // waits for the geometry to stop moving first.
  const quiesce = async (label) => {
    let stable = 0;
    let lastHeight = -1;
    for (let attempt = 0; attempt < 40 && stable < 4; attempt += 1) {
      const pane = JSON.parse(await evaluate(SAMPLE))[index];
      if (pane.scrollHeight === lastHeight) stable += 1;
      else { stable = 0; lastHeight = pane.scrollHeight; }
      await wait(700);
    }
    console.log(`${label}: transcript settled at ${lastHeight}px of content`);
  };
  await quiesce('stage A');

  // Stage A: a real wheel up, then rows landing straight into the transcript.
  //
  // The rows go into the DOM rather than the JSONL on purpose. A watcher
  // append also reconciles the whole tail, which legitimately re-lays-out the
  // transcript, so it cannot tell a repin from a reflow. A row appended to the
  // live log is exactly the resize the follow engine watches, and nothing else
  // moves - so scrollTop must not budge at all.
  console.log(`stage A: wheeling up ${SCROLL_UP_PX}px, then landing three rows into the live transcript`);
  const gapOf = (pane) => pane.scrollHeight - pane.scrollTop - pane.clientHeight;
  const INJECT = (height) => `(() => {
    const log = document.querySelectorAll('[data-slot=message-scroller] > section')[${index}]?.querySelector('[role=log]');
    if (!log) return 'missing';
    const row = document.createElement('div');
    row.dataset.j19Row = '1';
    row.style.height = '${height}px';
    log.appendChild(row);
    return 'ok';
  })()`;
  const CLEAN = `document.querySelectorAll('[data-j19-row]').forEach((node) => node.remove()); 'cleaned'`;
  const INJECTED_PX = 3 * 64;

  // The session's periodic tail reconciliation re-lays-out the transcript on
  // its own schedule. That is not a repin, but it destroys the reader's
  // position, so an attempt it lands in cannot measure the hold: the whole
  // departure is re-established and the attempt run again.
  let holdMeasured = false;
  for (let attempt = 0; attempt < 5 && !holdMeasured; attempt += 1) {
    await evaluate(CLEAN);
    await wheel(6_000);
    await wait(1_500);
    const atEdge = JSON.parse(await evaluate(SAMPLE))[index];
    const edgeGap = gapOf(atEdge);
    if (edgeGap > 56) {
      console.log(`stage A: attempt ${attempt + 1} could not return to the live edge (${edgeGap}px gap); retrying`);
      await wait(3_000);
      continue;
    }

    // Distance from the live edge, not a scrollTop delta: reaching the top
    // silently loads an older page, and the scroll restore raises scrollTop to
    // hold the reader's anchor, so only the gap measures "scrolled up".
    // Chrome also coalesces wheel notches into one smooth animation, so the
    // departure is wheeled until it is really SCROLL_UP_PX deep.
    let departed = atEdge;
    for (let notch = 0; notch < 15; notch += 1) {
      departed = JSON.parse(await evaluate(SAMPLE))[index];
      if (gapOf(departed) >= SCROLL_UP_PX) break;
      await wheel(-(SCROLL_UP_PX - gapOf(departed)));
      await wait(500);
    }
    await wait(1_000);
    departed = JSON.parse(await evaluate(SAMPLE))[index];
    if (gapOf(departed) < SCROLL_UP_PX) {
      console.log(`stage A: attempt ${attempt + 1} only reached ${gapOf(departed)}px above the edge; retrying`);
      await wait(3_000);
      continue;
    }

    for (let row = 0; row < 3; row += 1) {
      await evaluate(INJECT(64));
      await wait(120);
    }
    await wait(500);
    const held = JSON.parse(await evaluate(SAMPLE))[index];
    const grew = held.scrollHeight - departed.scrollHeight;
    const drift = Math.abs(held.scrollTop - departed.scrollTop);
    await evaluate(CLEAN);
    if (Math.abs(grew - INJECTED_PX) > 40) {
      console.log(`stage A: attempt ${attempt + 1} overlapped a tail reconciliation (content moved ${grew}px, not ${INJECTED_PX}px); retrying`);
      await wait(3_000);
      continue;
    }
    holdMeasured = true;
    console.log(`stage A: the reader sat ${gapOf(departed)}px above the live edge; three rows added ${grew}px, scrollTop ${departed.scrollTop} -> ${held.scrollTop} (${drift}px drift)`);
    if (drift > HELD_TOLERANCE_PX) {
      console.log(`FAIL: the pane repinned ${drift}px while the reader was scrolled up`);
      failed = true;
    }
  }
  if (!holdMeasured) {
    console.log('FAIL: never found a quiet window with an 800px departure to measure the hold in');
    failed = true;
  }

  // Stage B: stream 60 short tool rows and watch the geometry the whole time.
  console.log('stage B: streaming 60 short tool rows');
  const violations = [];
  let worstBlank = target.blank ?? 0;
  let rowsSeen = target.rows;
  let unscrollableSamples = 0;
  for (let row = 0; row < 60; row += 1) {
    appendToolRow(row);
    if (row % 5 === 4) {
      const pane = JSON.parse(await evaluate(SAMPLE))[index];
      if (!pane) continue;
      rowsSeen = Math.max(rowsSeen, pane.rows);
      if (pane.blank != null) {
        worstBlank = Math.max(worstBlank, pane.blank);
        if (pane.blank > pane.clientHeight) {
          violations.push({ row, blank: pane.blank, clientHeight: pane.clientHeight });
        }
      }
      if (!pane.scrollable) {
        // A tail reconciliation can collapse the loaded window for a moment;
        // the fill loop must refill it. Only a collapse that outlives that
        // is the reader-trapping bug.
        await wait(2_000);
        const recovered = JSON.parse(await evaluate(SAMPLE))[index];
        if (!recovered.scrollable) unscrollableSamples += 1;
      }
    }
    await wait(120);
  }
  await wait(WATCHER_LATENCY_MS);
  const settled = JSON.parse(await evaluate(SAMPLE))[index];
  rowsSeen = Math.max(rowsSeen, settled.rows);
  if (settled.blank != null) worstBlank = Math.max(worstBlank, settled.blank);
  if (settled.blank != null && settled.blank > settled.clientHeight) {
    violations.push({ row: 'settled', blank: settled.blank, clientHeight: settled.clientHeight });
  }
  if (!settled.scrollable) {
    await wait(2_000);
    const recovered = JSON.parse(await evaluate(SAMPLE))[index];
    if (!recovered.scrollable) unscrollableSamples += 1;
  }
  const streamedLanded = await evaluate(`JSON.stringify(!![...document.querySelectorAll('[data-slot=message-scroller] > section')][${index}]?.innerText.includes('echo row 59'))`);
  console.log(`stage B: rows ${target.rows} -> ${rowsSeen}, newest streamed row present ${streamedLanded}, worst blank ${worstBlank}px against a ${settled.clientHeight}px viewport, ${unscrollableSamples} unscrollable samples`);
  if (streamedLanded !== 'true') {
    console.log('FAIL: the streamed rows never reached the pane (watcher latency, or the wrong session)');
    failed = true;
  }
  if (violations.length > 0) {
    console.log(`FAIL: ${violations.length} sample(s) left more than one viewport of blank below the last row`, violations.slice(0, 3));
    failed = true;
  }
  if (unscrollableSamples > 0) {
    console.log(`FAIL: the pane stayed unscrollable ${unscrollableSamples} time(s) - a wheel there does nothing`);
    failed = true;
  }

  if (!failed) {
    console.log('PASS: no runaway blank space, the pane stayed movable, and rows landing under a scrolled-up reader left scrollTop alone');
  }
} finally {
  ws.close();
}
process.exit(failed ? 1 : 0);
