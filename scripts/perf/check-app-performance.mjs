#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LONG_TASK_BUDGET_MS = 50;
const CHAT_SWITCH_BUDGET_MS = 150;
const HEAP_GROWTH_BUDGET_PERCENT = 20;
const MEMORY_HEAP_GROWTH_BUDGET_PERCENT = 25;
const TRANSCRIPT_DOM_ROW_BUDGET = 120;
const JOB_DOM_ROW_BUDGET = 100;
const DEFAULT_MEMORY_IDLE_MS = 10 * 60 * 1000;
const CPU_THROTTLE_RATE = 4;

function readArgs(argv) {
  const options = {
    agentSession: process.env.PERF_AGENT_BROWSER_SESSION ?? 'ui17-perf',
    memoryAgentSession: process.env.PERF_MEMORY_AGENT_BROWSER_SESSION ?? null,
    devOrigin: process.env.PERF_DEV_ORIGIN ?? 'http://127.0.0.1:4748',
    mode: 'verify',
    outDir: process.env.PERF_OUT_DIR ?? resolve('tmp/perf'),
    memoryIdleMs: DEFAULT_MEMORY_IDLE_MS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--agent-session') options.agentSession = argv[++index];
    else if (flag === '--memory-agent-session') options.memoryAgentSession = argv[++index];
    else if (flag === '--dev-origin') options.devOrigin = argv[++index];
    else if (flag === '--mode') options.mode = argv[++index];
    else if (flag === '--out-dir') options.outDir = resolve(argv[++index]);
    else if (flag === '--memory-idle-ms') options.memoryIdleMs = Number(argv[++index]);
    else if (flag === '--help') {
      console.log('usage: node scripts/perf/check-app-performance.mjs [--agent-session name] [--memory-agent-session clean-name] [--dev-origin url] [--mode baseline|verify] [--out-dir path] [--memory-idle-ms milliseconds]');
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }
  if (!['baseline', 'verify'].includes(options.mode)) {
    throw new Error('--mode must be baseline or verify');
  }
  if (!Number.isFinite(options.memoryIdleMs) || options.memoryIdleMs < 0) {
    throw new Error('--memory-idle-ms must be a non-negative number');
  }
  options.memoryAgentSession ??= options.agentSession;
  return options;
}

function agentBrowser(session, ...args) {
  return execFileSync('agent-browser', ['--session', session, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

class CdpConnection {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async open() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolveOpen, reject) => {
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const { resolve: resolvePending, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolvePending(message.result);
        return;
      }
      const listeners = this.listeners.get(message.method);
      if (listeners) {
        for (const listener of listeners) listener(message.params ?? {});
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  close() {
    this.socket.close();
  }
}

async function pageSocketUrl(browserCdpUrl, devOrigin) {
  const browserUrl = new URL(browserCdpUrl);
  const targets = await (await fetch(`http://${browserUrl.host}/json/list`)).json();
  const candidates = targets.filter((target) => target.type === 'page' && target.url.startsWith(devOrigin));
  if (candidates.length === 0) {
    throw new Error(`no page on ${devOrigin} exists in the agent-browser session`);
  }
  const visible = candidates.find((target) => !target.url.includes('/login')) ?? candidates[0];
  return visible.webSocketDebuggerUrl;
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  }
  return response.result?.value;
}

function metricMap(response) {
  return Object.fromEntries((response.metrics ?? []).map(({ name, value }) => [name, value]));
}

function parseReactReport(raw) {
  try {
    const parsed = JSON.parse(raw);
    const report = parsed?.data?.report ?? '';
    const totals = report.match(/# (\d+) renders \((\d+) mounts \+ (\d+) re-renders\)/);
    const components = [];
    let inTable = false;
    for (const line of report.split('\n')) {
      if (line.startsWith('| Component ')) {
        inTable = true;
        continue;
      }
      if (!inTable || line.startsWith('| ---')) continue;
      if (!line.startsWith('|')) break;
      const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
      if (cells.length < 6) continue;
      components.push({
        component: cells[0],
        instances: Number(cells[1]),
        mounts: Number(cells[2]),
        rerenders: Number(cells[3]),
        domChanges: cells[6] ?? '',
      });
    }
    return {
      totalRenders: Number(totals?.[1] ?? 0),
      mounts: Number(totals?.[2] ?? 0),
      rerenders: Number(totals?.[3] ?? 0),
      components: components.slice(0, 20),
      report,
    };
  } catch (error) {
    return { totalRenders: 0, mounts: 0, rerenders: 0, components: [], error: String(error), report: raw };
  }
}

function startReactCapture(session) {
  try {
    agentBrowser(session, 'react', 'renders', 'start');
    return true;
  } catch {
    return false;
  }
}

function stopReactCapture(session, active) {
  if (!active) return null;
  try {
    return parseReactReport(agentBrowser(session, 'react', 'renders', 'stop', '--json'));
  } catch (error) {
    return { totalRenders: 0, mounts: 0, rerenders: 0, components: [], error: String(error) };
  }
}

async function resetLongTasks(cdp) {
  await evaluate(cdp, `(() => {
    window.__ccPerfLongTasks = [];
    window.__ccPerfLongTaskObserver?.disconnect?.();
    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      window.__ccPerfLongTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__ccPerfLongTasks.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name });
        }
      });
      window.__ccPerfLongTaskObserver.observe({ type: 'longtask', buffered: false });
    }
    return true;
  })()`);
}

async function collectLongTasks(cdp) {
  return evaluate(cdp, `(() => {
    window.__ccPerfLongTaskObserver?.takeRecords?.().forEach((entry) => {
      window.__ccPerfLongTasks.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name });
    });
    return window.__ccPerfLongTasks ?? [];
  })()`);
}

async function runTrace(cdp, name, outDir, action) {
  const traceEvents = [];
  const removeTraceListener = cdp.on('Tracing.dataCollected', ({ value }) => traceEvents.push(...value));
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline,blink.user_timing,v8.execute',
    options: 'sampling-frequency=10000',
    transferMode: 'ReportEvents',
  });
  await resetLongTasks(cdp);
  const before = metricMap(await cdp.send('Performance.getMetrics'));
  const value = await action();
  const after = metricMap(await cdp.send('Performance.getMetrics'));
  const longTasks = await collectLongTasks(cdp);
  const completed = new Promise((resolveComplete) => {
    const removeCompleteListener = cdp.on('Tracing.tracingComplete', () => {
      removeCompleteListener();
      resolveComplete();
    });
  });
  await cdp.send('Tracing.end');
  await completed;
  removeTraceListener();
  const tracePath = resolve(outDir, `${name}.trace.json`);
  writeFileSync(tracePath, JSON.stringify({ traceEvents }));
  return {
    value,
    longTasks,
    longTaskCount: longTasks.filter((task) => task.duration > LONG_TASK_BUDGET_MS).length,
    maxLongTaskMs: longTasks.reduce((maximum, task) => Math.max(maximum, task.duration), 0),
    mainThreadMs: Math.max(0, ((after.TaskDuration ?? 0) - (before.TaskDuration ?? 0)) * 1000),
    scriptMs: Math.max(0, ((after.ScriptDuration ?? 0) - (before.ScriptDuration ?? 0)) * 1000),
    layoutMs: Math.max(0, ((after.LayoutDuration ?? 0) - (before.LayoutDuration ?? 0)) * 1000),
    tracePath,
  };
}

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

const MEMORY_INSTRUMENTATION_SOURCE = `(() => {
  if (window.__ccMemoryInstrumentation) return;
  const nativeSetInterval = window.setInterval.bind(window);
  const nativeClearInterval = window.clearInterval.bind(window);
  const nativeCreateObjectUrl = URL.createObjectURL.bind(URL);
  const nativeRevokeObjectUrl = URL.revokeObjectURL.bind(URL);
  const liveIntervals = new Set();
  const liveIntervalStacks = new Map();
  const liveObjectUrls = new Set();

  window.setInterval = (...args) => {
    const id = nativeSetInterval(...args);
    liveIntervals.add(id);
    liveIntervalStacks.set(id, new Error('interval owner').stack ?? 'unknown');
    return id;
  };
  window.clearInterval = (id) => {
    liveIntervals.delete(id);
    liveIntervalStacks.delete(id);
    return nativeClearInterval(id);
  };
  URL.createObjectURL = (value) => {
    const url = nativeCreateObjectUrl(value);
    liveObjectUrls.add(url);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    liveObjectUrls.delete(url);
    return nativeRevokeObjectUrl(url);
  };
  window.__ccMemoryInstrumentation = {
    liveIntervals,
    liveIntervalStacks,
    liveObjectUrls,
  };
})()`;

async function installMemoryInstrumentation(cdp) {
  await cdp.send('Page.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Memory.enable').catch(() => undefined);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: MEMORY_INSTRUMENTATION_SOURCE,
  });
  const loaded = new Promise((resolveLoad) => {
    const remove = cdp.on('Page.loadEventFired', () => {
      remove();
      resolveLoad();
    });
  });
  await cdp.send('Page.reload', { ignoreCache: true });
  await loaded;
}

async function waitForRealisticState(cdp) {
  const deadline = Date.now() + 45_000;
  let state = null;
  while (Date.now() < deadline) {
    state = await evaluate(cdp, `(() => {
      const transcriptPanes = [...document.querySelectorAll('[data-slot="message-scroller"] [role="log"]')]
        .map((log) => ({
          rows: log.querySelectorAll('.chat-message').length,
          characters: log.textContent?.length ?? 0,
        }));
      return {
        url: location.href,
        viewport: [innerWidth, innerHeight],
        jobRows: document.querySelectorAll('[data-slot="jobs-sidebar-row"]').length,
        jobHistoryRows: Number(document.querySelector('[data-slot="jobs-sidebar"]')?.getAttribute('data-history-total') ?? 0),
        taskRows: document.querySelectorAll('[data-slot="jobs-sidebar-task"]').length,
        chatRows: document.querySelectorAll('[data-slot="chat-row"]').length,
        messageRows: document.querySelectorAll('.chat-message').length,
        transcriptPanes,
        transcriptCharacters: transcriptPanes.reduce((total, pane) => total + pane.characters, 0),
        loadedTranscriptPanes: transcriptPanes.filter((pane) => pane.rows > 0 && pane.characters >= 1_000).length,
      };
    })()`);
    if (
      state.jobRows >= 20
      && state.jobHistoryRows >= 20
      && state.chatRows >= 2
      && state.messageRows >= 1
      && state.transcriptCharacters >= 20_000
      && state.transcriptPanes.length === 2
      && state.loadedTranscriptPanes >= 2
    ) {
      return state;
    }
    await wait(250);
  }
  throw new Error(`realistic state required; observed ${JSON.stringify(state)}`);
}

async function detachedNodeCount(cdp) {
  try {
    const result = await cdp.send('DOM.getDetachedDomNodes', {
      performSearch: true,
      enableShadowDOM: true,
    });
    return result.detachedNodes?.length ?? 0;
  } catch {
    return null;
  }
}

async function memorySnapshot(cdp, stage) {
  await cdp.send('HeapProfiler.collectGarbage');
  const [heap, dom, detachedNodes, page] = await Promise.all([
    cdp.send('Runtime.getHeapUsage'),
    cdp.send('Memory.getDOMCounters'),
    detachedNodeCount(cdp),
    evaluate(cdp, `(() => {
      const instrumentation = window.__ccMemoryInstrumentation;
      const transcriptRows = [...document.querySelectorAll('[data-slot="message-scroller"] [role="log"]')]
        .map((log) => log.querySelectorAll('.chat-message').length);
      return {
        liveIntervals: instrumentation?.liveIntervals?.size ?? null,
        liveIntervalStacks: [...(instrumentation?.liveIntervalStacks?.values?.() ?? [])],
        liveObjectUrls: instrumentation?.liveObjectUrls?.size ?? null,
        transcriptRows,
        maxTranscriptRows: Math.max(0, ...transcriptRows),
        jobRows: document.querySelectorAll('[data-slot="jobs-sidebar-row"]').length,
        jobHistoryRows: Number(document.querySelector('[data-slot="jobs-sidebar"]')?.getAttribute('data-history-total') ?? 0),
        taskRows: document.querySelectorAll('[data-slot="jobs-sidebar-task"]').length,
        openJobDrawers: document.querySelectorAll('[data-slot="jobs-sidebar-drawer"]').length,
        memorySurfaces: document.querySelectorAll('[data-slot="memory-surface"]').length,
      };
    })()`),
  ]);
  return {
    stage,
    heapBytes: heap.usedSize,
    backingStorageBytes: heap.backingStorageSize,
    domNodes: dom.nodes,
    documents: dom.documents,
    listeners: dom.jsEventListeners,
    detachedNodes,
    ...page,
  };
}

async function observeStreamingIdle(cdp, milliseconds) {
  return evaluate(cdp, `(async () => {
    const token = localStorage.getItem('auth-token');
    const response = await fetch('/api/providers/sessions/running', {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    });
    const body = await response.json().catch(() => null);
    const runningSessions = body?.data?.sessions ?? body?.sessions ?? [];
    const visibleLogs = [...document.querySelectorAll('[data-slot="message-scroller"] [role="log"]')]
      .filter((log) => log.getBoundingClientRect().width > 0 && log.getBoundingClientRect().height > 0);
    const workerLog = visibleLogs[1] ?? visibleLogs[0] ?? null;
    let mutationRecords = 0;
    const beforeCharacters = workerLog?.textContent?.length ?? 0;
    const observer = workerLog ? new MutationObserver((records) => { mutationRecords += records.length; }) : null;
    observer?.observe(workerLog, { childList: true, characterData: true, subtree: true });
    await new Promise((resolve) => setTimeout(resolve, ${milliseconds}));
    observer?.disconnect();
    return {
      milliseconds: ${milliseconds},
      runningSessions: runningSessions.length,
      mutationRecords,
      beforeCharacters,
      afterCharacters: workerLog?.textContent?.length ?? 0,
    };
  })()`, true);
}

async function cycleDrawersAndMemory(cdp, cycles) {
  return evaluate(cdp, `(async () => {
    const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    let drawerCycles = 0;
    let memoryCycles = 0;
    for (let index = 0; index < ${cycles}; index += 1) {
      const rows = [...document.querySelectorAll('[data-slot="jobs-sidebar-row"][data-drawer]')];
      const row = rows[index % rows.length];
      if (!row) throw new Error('a jobs drawer row is required');
      row.click();
      await pause(80);
      row.click();
      await pause(80);
      drawerCycles += 1;

      const trigger = document.querySelector('[data-slot="memory-viewer-trigger"]');
      if (!trigger) throw new Error('the Memory trigger is required');
      trigger.click();
      const openDeadline = performance.now() + 5000;
      while (!document.querySelector('[data-slot="memory-surface"]') && performance.now() < openDeadline) {
        await pause(20);
      }
      if (!document.querySelector('[data-slot="memory-surface"]')) throw new Error('Memory did not open');
      trigger.click();
      const closeDeadline = performance.now() + 5000;
      while (document.querySelector('[data-slot="memory-surface"]') && performance.now() < closeDeadline) {
        await pause(20);
      }
      if (document.querySelector('[data-slot="memory-surface"]')) throw new Error('Memory did not close');
      memoryCycles += 1;
    }
    return { drawerCycles, memoryCycles };
  })()`, true);
}

async function memoryScenario(cdp, idleMilliseconds) {
  await cdp.send('HeapProfiler.enable');
  const load = await memorySnapshot(cdp, 'load');
  const switches = await evaluate(cdp, switchExpression(30, true), true);
  const afterSwitches = await memorySnapshot(cdp, 'after-30-switches');
  const idle = await observeStreamingIdle(cdp, idleMilliseconds);
  const afterIdle = await memorySnapshot(cdp, 'after-streaming-idle');
  const drawerCycles = await cycleDrawersAndMemory(cdp, 20);
  const afterDrawers = await memorySnapshot(cdp, 'after-drawers-and-memory');
  const knownIntervalOwners = new Set([
    ...load.liveIntervalStacks,
    ...afterSwitches.liveIntervalStacks,
    ...afterIdle.liveIntervalStacks,
  ]);
  const surfaceIntervalLeakStacks = afterDrawers.liveIntervalStacks.filter(
    (stack) => !knownIntervalOwners.has(stack),
  );
  const growthPercent = load.heapBytes === 0
    ? 0
    : ((afterDrawers.heapBytes - load.heapBytes) / load.heapBytes) * 100;
  return {
    load,
    afterSwitches,
    afterIdle,
    afterDrawers,
    switches: switches.length,
    idle,
    drawerCycles,
    growthPercent,
    detachedGrowth: load.detachedNodes === null || afterDrawers.detachedNodes === null
      ? null
      : afterDrawers.detachedNodes - load.detachedNodes,
    intervalGrowthAfterUnmount: afterDrawers.liveIntervals === null || afterIdle.liveIntervals === null
      ? null
      : afterDrawers.liveIntervals - afterIdle.liveIntervals,
    surfaceIntervalLeakStacks,
    surfaceIntervalLeaks: surfaceIntervalLeakStacks.length,
  };
}

async function findRect(cdp, expression) {
  const rect = await evaluate(cdp, `(() => {
    const element = ${expression};
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })()`);
  if (!rect || rect.width <= 0 || rect.height <= 0) throw new Error(`interaction target missing: ${expression}`);
  return rect;
}

async function sweepAndScroll(cdp, expression, milliseconds) {
  const rect = await findRect(cdp, expression);
  const startedAt = Date.now();
  let step = 0;
  while (Date.now() - startedAt < milliseconds) {
    const progress = (step % 30) / 29;
    const x = rect.x + Math.max(4, Math.min(rect.width - 4, rect.width * (0.15 + progress * 0.7)));
    const y = rect.y + Math.max(4, Math.min(rect.height - 4, rect.height * (0.1 + ((step * 7) % 30) / 37.5)));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    if (step % 3 === 0) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x,
        y,
        deltaX: 0,
        deltaY: Math.floor(step / 15) % 2 === 0 ? 110 : -110,
      });
    }
    step += 1;
    await wait(70);
  }
  return { pointerSamples: step, target: rect };
}

const switchExpression = (switches, restoreOriginal) => `(async () => {
  const originalPath = location.pathname;
  const visibleRows = () => [...document.querySelectorAll('[data-slot="chat-row"][href]')]
    .filter((row) => row.getBoundingClientRect().height > 0);
  const originalKey = originalPath.split('/').filter(Boolean).at(-1);
  const alternate = visibleRows().find((row) => row.dataset.bounceKey !== originalKey);
  const original = visibleRows().find((row) => row.dataset.bounceKey === originalKey);
  if (!alternate || !original) throw new Error('two visible chat rows are required');
  const keys = [alternate.dataset.bounceKey, original.dataset.bounceKey];
  const results = [];
  for (let index = 0; index < ${switches}; index += 1) {
    const key = keys[index % 2];
    const row = visibleRows().find((candidate) => candidate.dataset.bounceKey === key);
    if (!row) throw new Error('chat row disappeared: ' + key);
    const plannerLog = document.querySelectorAll('[data-slot="message-scroller"] [role="log"]')[0];
    const beforeText = plannerLog?.textContent ?? '';
    const beforeChildren = plannerLog?.childElementCount ?? -1;
    const dotSamples = [];
    const sampleDot = () => {
      const dot = document.querySelector('[data-slot="bounce-indicator"]');
      if (dot) dotSamples.push({ at: performance.now(), transform: dot.style.transform, boxY: dot.getBoundingClientRect().y });
    };
    sampleDot();
    const startedAt = performance.now();
    row.click();
    const deadline = startedAt + 8000;
    while (performance.now() < deadline) {
      const log = document.querySelectorAll('[data-slot="message-scroller"] [role="log"]')[0];
      const routeLanded = location.pathname.endsWith('/' + key);
      const transcriptChanged = Boolean(log) && (log.textContent !== beforeText || log.childElementCount !== beforeChildren);
      if (routeLanded && transcriptChanged) break;
      await new Promise(requestAnimationFrame);
    }
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const firstPaintMs = performance.now() - startedAt;
    // Transcript paint and selection travel are separate evidence: a fast
    // paint must not end sampling before the roughly 300ms spring finishes.
    const sampleDeadline = startedAt + 400;
    while (performance.now() < sampleDeadline) {
      await new Promise(requestAnimationFrame);
      sampleDot();
    }
    results.push({
      key,
      firstPaintMs,
      dotSamples,
      finalTransform: document.querySelector('[data-slot="bounce-indicator"]')?.style.transform ?? null,
    });
    await new Promise((resolve) => setTimeout(resolve, 220));
  }
  if (${restoreOriginal ? 'true' : 'false'} && location.pathname !== originalPath) {
    const row = visibleRows().find((candidate) => candidate.dataset.bounceKey === originalKey);
    row?.click();
    const deadline = performance.now() + 8000;
    while (location.pathname !== originalPath && performance.now() < deadline) await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  }
  return results;
})()`;

async function heapSwitches(cdp) {
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const before = await cdp.send('Runtime.getHeapUsage');
  const samples = await evaluate(cdp, switchExpression(30, true), true);
  await cdp.send('HeapProfiler.collectGarbage');
  const after = await cdp.send('Runtime.getHeapUsage');
  const growthPercent = before.usedSize === 0 ? 0 : ((after.usedSize - before.usedSize) / before.usedSize) * 100;
  return { beforeBytes: before.usedSize, afterBytes: after.usedSize, growthPercent, switches: samples.length };
}

async function animationAudit(cdp) {
  return evaluate(cdp, `(async () => {
    const animated = () => [...document.querySelectorAll('*')].map((element) => {
      const style = getComputedStyle(element);
      const names = style.animationName.split(',').map((name) => name.trim()).filter((name) => name !== 'none');
      if (names.length === 0) return null;
      const rect = element.getBoundingClientRect();
      const offscreen = rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth;
      return {
        slot: element.getAttribute('data-slot'),
        names,
        playState: style.animationPlayState,
        offscreen,
      };
    }).filter(Boolean);
    const offscreenRunning = animated().filter((item) => item.offscreen && item.playState.split(',').some((state) => state.trim() !== 'paused'));
    const ownHidden = Object.prototype.hasOwnProperty.call(document, 'hidden');
    const priorHidden = document.hidden;
    let hiddenRunning = [];
    try {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise(requestAnimationFrame);
      hiddenRunning = animated().filter((item) => item.playState.split(',').some((state) => state.trim() !== 'paused'));
    } finally {
      if (ownHidden) Object.defineProperty(document, 'hidden', { configurable: true, value: priorHidden });
      else delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    }
    const layoutProperties = new Set(['block-size','bottom','height','inset','inset-block','inset-inline','left','margin','max-height','max-width','min-height','min-width','padding','right','top','width']);
    const layoutAnimations = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of rules) {
        const nested = rule.cssRules ? [...rule.cssRules] : [];
        for (const candidate of [rule, ...nested]) {
          if (candidate.type !== CSSRule.KEYFRAMES_RULE) continue;
          const properties = new Set();
          for (const frame of candidate.cssRules) {
            for (const property of frame.style) properties.add(property);
          }
          const offenders = [...properties].filter((property) => layoutProperties.has(property));
          if (offenders.length > 0) layoutAnimations.push({ name: candidate.name, properties: offenders });
        }
      }
    }
    return { totalAnimated: animated().length, offscreenRunning, hiddenRunning, layoutAnimations };
  })()`, true);
}

function scenarioSummary(result) {
  return {
    longTaskCount: result.longTaskCount,
    maxLongTaskMs: Number(result.maxLongTaskMs.toFixed(1)),
    mainThreadMs: Number(result.mainThreadMs.toFixed(1)),
    scriptMs: Number(result.scriptMs.toFixed(1)),
    layoutMs: Number(result.layoutMs.toFixed(1)),
    react: result.react ? {
      totalRenders: result.react.totalRenders,
      mounts: result.react.mounts,
      rerenders: result.react.rerenders,
      components: result.react.components,
      error: result.react.error,
    } : null,
    tracePath: result.tracePath,
  };
}

async function main() {
  const options = readArgs(process.argv.slice(2));
  mkdirSync(options.outDir, { recursive: true });
  const browserCdpUrl = agentBrowser(options.agentSession, 'get', 'cdp-url').split('\n').at(-1).trim();
  const pageUrl = await pageSocketUrl(browserCdpUrl, options.devOrigin);
  const cdp = new CdpConnection(pageUrl);
  await cdp.open();
  await cdp.send('Runtime.enable');
  await cdp.send('Performance.enable');
  await installMemoryInstrumentation(cdp);
  const state = await waitForRealisticState(cdp);

  const separateMemorySession = options.memoryAgentSession !== options.agentSession;
  let memoryCdp = cdp;
  let memoryState = state;
  if (separateMemorySession) {
    const memoryBrowserCdpUrl = agentBrowser(options.memoryAgentSession, 'get', 'cdp-url').split('\n').at(-1).trim();
    const memoryPageUrl = await pageSocketUrl(memoryBrowserCdpUrl, options.devOrigin);
    memoryCdp = new CdpConnection(memoryPageUrl);
    await memoryCdp.open();
    await memoryCdp.send('Runtime.enable');
    await installMemoryInstrumentation(memoryCdp);
    memoryState = await waitForRealisticState(memoryCdp);
    const observerPresent = await evaluate(memoryCdp, 'Boolean(window.__REACT_DEVTOOLS_GLOBAL_HOOK__)');
    if (observerPresent) {
      throw new Error('--memory-agent-session must be a clean agent-browser session without React DevTools');
    }
  }

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE_RATE });
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  if (separateMemorySession) {
    await memoryCdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE_RATE });
    await memoryCdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  }
  await cdp.send('Page.bringToFront');

  const runScenario = async (name, action) => {
    const result = await runTrace(cdp, name, options.outDir, action);
    // React DevTools' render instrumentation walks the committed fiber tree
    // and is intentionally kept out of the timing trace. Repeat the scenario
    // under the profiler so timing and render-count evidence do not distort
    // one another.
    const reactActive = startReactCapture(options.agentSession);
    await action();
    result.react = stopReactCapture(options.agentSession, reactActive);
    return result;
  };

  console.log(`UI17 performance check: ${CPU_THROTTLE_RATE}x CPU, ${state.jobRows} jobs, ${state.taskRows} tasks, ${state.messageRows} transcript rows`);
  console.log(`memory scenario: ${options.memoryAgentSession}, 30 switches, ${Math.round(options.memoryIdleMs / 1000)}s streaming idle, 20 jobs/Memory cycles`);
  const memory = await memoryScenario(memoryCdp, options.memoryIdleMs);
  const idle = await runScenario('idle', () => wait(5000));
  const switches = await runScenario('chat-switch', () => evaluate(cdp, switchExpression(3, true), true));
  const jobs = await runScenario('jobs-sweep', () => sweepAndScroll(cdp, `document.querySelector('[data-slot="jobs-sidebar"]')`, 5000));
  const sidebar = await runScenario('sidebar-scroll', () => sweepAndScroll(cdp, `(() => {
    let element = document.querySelector('[data-slot="chat-row"]');
    while (element && element !== document.body) {
      const style = getComputedStyle(element);
      if (element.scrollHeight > element.clientHeight && /(auto|scroll)/.test(style.overflowY)) return element;
      element = element.parentElement;
    }
    return null;
  })()`, 5000));
  const heap = await heapSwitches(cdp);
  const animations = await animationAudit(cdp);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  if (separateMemorySession) {
    await memoryCdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    memoryCdp.close();
  }
  cdp.close();

  const switchTimes = switches.value.map((sample) => sample.firstPaintMs);
  const switchMax = Math.max(...switchTimes);
  const dotDistinctSamples = switches.value.map((sample) => new Set(sample.dotSamples.map((item) => item.transform)).size);
  const dotMidFlight = dotDistinctSamples.every((count) => count >= 3);
  const budgets = [
    { name: 'idle long task', actual: idle.maxLongTaskMs, limit: LONG_TASK_BUDGET_MS, pass: idle.maxLongTaskMs <= LONG_TASK_BUDGET_MS },
    { name: 'chat switch first paint', actual: switchMax, limit: CHAT_SWITCH_BUDGET_MS, pass: switchMax < CHAT_SWITCH_BUDGET_MS },
    { name: 'jobs sweep long task', actual: jobs.maxLongTaskMs, limit: LONG_TASK_BUDGET_MS, pass: jobs.maxLongTaskMs <= LONG_TASK_BUDGET_MS },
    { name: 'sidebar scroll long task', actual: sidebar.maxLongTaskMs, limit: LONG_TASK_BUDGET_MS, pass: sidebar.maxLongTaskMs <= LONG_TASK_BUDGET_MS },
    { name: 'heap growth after 30 switches', actual: heap.growthPercent, limit: HEAP_GROWTH_BUDGET_PERCENT, pass: heap.growthPercent <= HEAP_GROWTH_BUDGET_PERCENT },
    { name: 'selection dot transform samples', actual: Math.min(...dotDistinctSamples), limit: 3, pass: dotMidFlight, comparison: '>=' },
    { name: 'offscreen animations running', actual: animations.offscreenRunning.length, limit: 0, pass: animations.offscreenRunning.length === 0 },
    { name: 'hidden-tab animations running', actual: animations.hiddenRunning.length, limit: 0, pass: animations.hiddenRunning.length === 0 },
    { name: 'layout-affecting keyframes', actual: animations.layoutAnimations.length, limit: 0, pass: animations.layoutAnimations.length === 0 },
    { name: 'memory heap growth for full scenario', actual: memory.growthPercent, limit: MEMORY_HEAP_GROWTH_BUDGET_PERCENT, pass: memory.growthPercent <= MEMORY_HEAP_GROWTH_BUDGET_PERCENT },
    { name: 'memory detached-node growth', actual: memory.detachedGrowth ?? Number.POSITIVE_INFINITY, limit: 0, pass: memory.detachedGrowth !== null && memory.detachedGrowth <= 0 },
    { name: 'memory intervals retained by closed surfaces', actual: memory.surfaceIntervalLeaks, limit: 0, pass: memory.surfaceIntervalLeaks === 0 },
    { name: 'memory transcript DOM rows per pane', actual: memory.afterDrawers.maxTranscriptRows, limit: TRANSCRIPT_DOM_ROW_BUDGET, pass: memory.afterDrawers.maxTranscriptRows <= TRANSCRIPT_DOM_ROW_BUDGET },
    { name: 'memory jobs DOM rows', actual: memory.afterDrawers.jobRows, limit: JOB_DOM_ROW_BUDGET, pass: memory.afterDrawers.jobRows <= JOB_DOM_ROW_BUDGET },
    { name: 'memory closed drawer task rows', actual: memory.afterDrawers.taskRows, limit: 0, pass: memory.afterDrawers.taskRows === 0 },
  ];
  const result = {
    recordedAt: new Date().toISOString(),
    mode: options.mode,
    cpuThrottleRate: CPU_THROTTLE_RATE,
    state,
    memoryState,
    scenarios: {
      idle: scenarioSummary(idle),
      chatSwitch: { ...scenarioSummary(switches), firstPaintMs: switchTimes.map((time) => Number(time.toFixed(1))), dotDistinctSamples },
      jobsSweep: scenarioSummary(jobs),
      sidebarScroll: scenarioSummary(sidebar),
    },
    heap: { ...heap, growthPercent: Number(heap.growthPercent.toFixed(1)) },
    memory: { ...memory, growthPercent: Number(memory.growthPercent.toFixed(1)) },
    animations,
    budgets,
  };
  const resultPath = resolve(options.outDir, `${options.mode}.json`);
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  for (const budget of budgets) {
    const comparison = budget.comparison ?? '<=';
    console.log(`${budget.pass ? 'PASS' : 'FAIL'} ${budget.name}: ${Number(budget.actual.toFixed?.(1) ?? budget.actual)} ${comparison} ${budget.limit}`);
  }
  for (const [name, scenario] of Object.entries(result.scenarios)) {
    console.log(`${name}: ${scenario.mainThreadMs}ms main thread, ${scenario.longTaskCount} long tasks, ${scenario.react?.totalRenders ?? 0} profiler renders`);
  }
  console.log(`results: ${resultPath}`);
  if (options.mode === 'verify' && budgets.some((budget) => !budget.pass)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack ?? error);
  // A failed setup can leave a CDP websocket open. Exit explicitly so an
  // unattended verification never lingers after reporting its error.
  process.exit(1);
});
