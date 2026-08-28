#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LONG_TASK_BUDGET_MS = 50;
const CHAT_SWITCH_BUDGET_MS = 150;
const HEAP_GROWTH_BUDGET_PERCENT = 20;
const CPU_THROTTLE_RATE = 4;

function readArgs(argv) {
  const options = {
    agentSession: process.env.PERF_AGENT_BROWSER_SESSION ?? 'ui17-perf',
    devOrigin: process.env.PERF_DEV_ORIGIN ?? 'http://127.0.0.1:4748',
    mode: 'verify',
    outDir: process.env.PERF_OUT_DIR ?? resolve('tmp/perf'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--agent-session') options.agentSession = argv[++index];
    else if (flag === '--dev-origin') options.devOrigin = argv[++index];
    else if (flag === '--mode') options.mode = argv[++index];
    else if (flag === '--out-dir') options.outDir = resolve(argv[++index]);
    else if (flag === '--help') {
      console.log('usage: node scripts/perf/check-app-performance.mjs [--agent-session name] [--dev-origin url] [--mode baseline|verify] [--out-dir path]');
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }
  if (!['baseline', 'verify'].includes(options.mode)) {
    throw new Error('--mode must be baseline or verify');
  }
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
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE_RATE });
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await cdp.send('Page.bringToFront');
  const state = await evaluate(cdp, `({
    url: location.href,
    viewport: [innerWidth, innerHeight],
    jobRows: document.querySelectorAll('[data-slot="jobs-sidebar-row"]').length,
    taskRows: document.querySelectorAll('[data-slot="jobs-sidebar-task"]').length,
    chatRows: document.querySelectorAll('[data-slot="chat-row"]').length,
    messageRows: document.querySelectorAll('.chat-message').length,
  })`);
  if (state.jobRows < 20 || state.chatRows < 2 || state.messageRows < 1) {
    throw new Error(`realistic state required; observed ${JSON.stringify(state)}`);
  }

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
  ];
  const result = {
    recordedAt: new Date().toISOString(),
    mode: options.mode,
    cpuThrottleRate: CPU_THROTTLE_RATE,
    state,
    scenarios: {
      idle: scenarioSummary(idle),
      chatSwitch: { ...scenarioSummary(switches), firstPaintMs: switchTimes.map((time) => Number(time.toFixed(1))), dotDistinctSamples },
      jobsSweep: scenarioSummary(jobs),
      sidebarScroll: scenarioSummary(sidebar),
    },
    heap: { ...heap, growthPercent: Number(heap.growthPercent.toFixed(1)) },
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
  process.exitCode = 1;
});
