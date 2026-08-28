#!/usr/bin/env node

import { spawn } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const serverEntry = path.join(root, 'dist-server-dev', 'server', 'index.js');
const frontendDist = path.join(root, 'dist-dev');

const fail = (message) => {
  throw new Error(`usage-alerts dev check: ${message}`);
};

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function command(executable, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      env: options.env ?? process.env,
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error([
        `${executable} ${args.join(' ')} exited ${code ?? signal}`,
        stdout.trim(),
        stderr.trim(),
      ].filter(Boolean).join('\n')));
    });
  });
}

async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const address = listener.address();
  if (!address || typeof address === 'string') fail('could not reserve a test port');
  await new Promise((resolve) => listener.close(resolve));
  return address.port;
}

async function waitForHealth(baseUrl, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) fail(`isolated server exited ${child.exitCode} during startup`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The isolated listener is still starting.
    }
    await delay(100);
  }
  fail('isolated server did not become healthy');
}

function account(number, alias, fiveHour, options = {}) {
  const reset = new Date(Date.now() + 60 * 60_000).toISOString();
  return {
    number,
    alias,
    email: `${alias.toLowerCase()}@example.com`,
    active: number === 1,
    disabled: options.disabled === true,
    usageFetchedAt: new Date().toISOString(),
    usage: {
      fiveHour: { pct: fiveHour, resetsAt: reset },
      sevenDay: { pct: options.sevenDay ?? 89, resetsAt: reset },
      scoped: [{ name: 'Fable', pct: options.fable ?? 70, resetsAt: reset }],
    },
  };
}

function feed(values = {}) {
  const disabled = new Set(values.disabled ?? [5, 6, 7]);
  const fiveHour = values.fiveHour ?? [70, 82, 82, 82, 70, 20, 70];
  return {
    activeAccountNumber: 1,
    accounts: ['One', 'Two', 'Three', 'Four', 'Gated', 'Fresh', 'Edit'].map((alias, index) => account(
      index + 1,
      alias,
      fiveHour[index],
      {
        disabled: disabled.has(index + 1),
        sevenDay: values.sevenDay ?? 89,
        fable: values.fable ?? 70,
      },
    )),
  };
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const stopped = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    delay(5000).then(() => false),
  ]);
  if (!stopped && child.exitCode === null) {
    child.kill('SIGKILL');
    await new Promise((resolve) => child.once('exit', resolve));
  }
}

async function main() {
  await Promise.all([stat(serverEntry), stat(path.join(frontendDist, 'index.html'))]).catch(() => {
    fail('run npm run build before this check');
  });

  const directory = await mkdtemp(path.join(os.tmpdir(), 'command-center-usage-alerts-'));
  const home = path.join(directory, 'home');
  const bin = path.join(directory, 'bin');
  const parked = path.join(directory, 'parked');
  const statePath = path.join(directory, 'accounts.json');
  const cswapPath = path.join(bin, 'cswap');
  const logPath = path.join(directory, 'server.log');
  const port = await unusedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const browserSession = `usage-alerts-${process.pid}`;
  const browserNamespace = `command-center-ui15r5-${process.pid}`;
  let serverProcess = null;
  let browserOpened = false;

  const browser = (...args) => command('agent-browser', [
    '--namespace', browserNamespace,
    '--session', browserSession,
    ...args,
  ]);
  const browserEval = (source) => browser('eval', '-b', Buffer.from(source).toString('base64'));

  try {
    await Promise.all([
      mkdir(home, { recursive: true }),
      mkdir(bin, { recursive: true }),
      mkdir(parked, { recursive: true }),
    ]);
    await writeFile(statePath, `${JSON.stringify(feed())}\n`);
    await writeFile(cswapPath, `#!/bin/zsh
case "$1" in
  list) /bin/cat "$CSWAP_STUB_STATE" ;;
  status) print -r -- '{"activeAccountNumber":1}' ;;
  switch) print -r -- '{"activeAccountNumber":1,"switched":true}' ;;
  *) print -r -- '{}' ;;
esac
`);
    await chmod(cswapPath, 0o755);
    const logHandle = await open(logPath, 'w');
    const environment = {
      ...process.env,
      HOME: home,
      HOST: '127.0.0.1',
      SERVER_PORT: String(port),
      DATABASE_PATH: path.join(directory, 'auth.db'),
      COMMAND_CENTER_FRONTEND_DIST: frontendDist,
      COMMAND_CENTER_INSTANCE: 'dev-usage-check',
      CSWAP_PATH: cswapPath,
      CSWAP_PARK_DIR: parked,
      CSWAP_STUB_STATE: statePath,
    };
    delete environment.CLAUDE_CONFIG_DIR;
    serverProcess = spawn(process.execPath, [serverEntry], {
      cwd: root,
      env: environment,
      stdio: ['ignore', logHandle.fd, logHandle.fd],
    });
    await waitForHealth(baseUrl, serverProcess);

    const register = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'usage-check', password: 'usage-check-password' }),
    });
    const session = await register.json();
    if (!register.ok || typeof session.token !== 'string') fail(`registration failed: ${JSON.stringify(session)}`);
    const authenticated = async (pathname, options = {}) => {
      const response = await fetch(`${baseUrl}${pathname}`, {
        ...options,
        headers: {
          authorization: `Bearer ${session.token}`,
          'content-type': 'application/json',
          ...options.headers,
        },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) fail(`${pathname} returned ${response.status}: ${JSON.stringify(body)}`);
      return body;
    };
    await authenticated('/api/user/complete-onboarding', { method: 'POST' });

    await browser('open', baseUrl);
    browserOpened = true;
    await browser('storage', 'local', 'set', 'auth-token', session.token);
    await browser('reload');
    await browser('wait', '[data-slot="app-shell"]');
    await browser('set', 'viewport', '1440', '1000');
    await browser('set', 'media', 'dark', 'reduced-motion');
    await browserEval(`(() => {
      window.__usageAlertHistory = [];
      const collect = (node) => {
        if (!(node instanceof Element)) return;
        const toasts = [
          ...(node.matches('[data-slot="usage-alert-toast"]') ? [node] : []),
          ...node.querySelectorAll('[data-slot="usage-alert-toast"]'),
        ];
        for (const toast of toasts) window.__usageAlertHistory.push(toast.innerText);
      };
      window.__usageAlertObserver = new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) collect(node);
      });
      window.__usageAlertObserver.observe(document.body, { childList: true, subtree: true });
      return true;
    })()`);
    await browser('click', '[data-slot="account-switcher-trigger"]');
    await browser('wait', '[data-slot="accounts-panel"]');
    await browser('wait', '--text', 'updated');

    const writeFeed = async (next) => writeFile(statePath, `${JSON.stringify(next)}\n`);
    const refresh = async (next, repeat = true) => {
      await writeFeed(next);
      await authenticated('/api/accounts/switch', {
        method: 'POST',
        body: JSON.stringify({ target: '1' }),
      });
      if (repeat) {
        await authenticated('/api/accounts/switch', {
          method: 'POST',
          body: JSON.stringify({ target: '1' }),
        });
      }
    };
    const waitForAlert = async (title) => browser('wait', '--fn',
      `window.__usageAlertHistory.some((text) => text.includes(${JSON.stringify(title)}))`);

    await refresh(feed({ fiveHour: [76, 82, 82, 82, 70, 20, 70] }));
    await waitForAlert('One 5h window at 75%');
    await refresh(feed({ fiveHour: [91, 82, 82, 82, 70, 20, 70] }));
    await waitForAlert('One 5h window at 90%');
    await refresh(feed({ fiveHour: [100, 82, 82, 82, 70, 20, 70] }));
    await waitForAlert('One 5h window exhausted');

    const gatedBaseline = feed({
      fiveHour: [100, 82, 82, 82, 70, 20, 70],
      disabled: [7],
    });
    await refresh(gatedBaseline, false);
    await refresh(feed({
      fiveHour: [100, 82, 82, 82, 76, 20, 70],
      disabled: [7],
    }));
    await browserEval(`(() => {
      if (window.__usageAlertHistory.some((text) => text.includes('Gated 5h'))) {
        throw new Error('fresh-account gating emitted an alert');
      }
      return true;
    })()`);

    await browser('click', '[data-slot="settings-trigger"]');
    await browser('wait', 'input[aria-label="Account warning"]');
    await browser('fill', 'input[aria-label="Account warning"]', '72');
    await browser('press', 'Tab');
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const body = await authenticated('/api/settings/usage-alerts');
      if (body.thresholds?.accountWarning === 72) break;
      if (attempt === 39) fail('System threshold edit did not persist');
      await delay(50);
    }
    await refresh(feed({
      fiveHour: [100, 82, 82, 82, 76, 20, 70],
      disabled: [6],
    }), false);
    await refresh(feed({
      fiveHour: [100, 82, 82, 82, 76, 20, 73],
      disabled: [6],
    }));
    await waitForAlert('Edit 5h window at 72%');

    const allDisabled = [1, 2, 3, 4, 5, 6, 7];
    await refresh(feed({ fiveHour: Array(7).fill(70), disabled: allDisabled }), false);
    await refresh(feed({ fiveHour: Array(7).fill(76), disabled: allDisabled }));
    await waitForAlert('Fleet 5h window at 75%');
    await refresh(feed({ fiveHour: Array(7).fill(91), disabled: allDisabled }));
    await waitForAlert('Fleet 5h window at 90%');
    await refresh(feed({ fiveHour: Array(7).fill(91), fable: 76, disabled: allDisabled }));
    await waitForAlert('Fleet Fable window at 75%');
    await refresh(feed({ fiveHour: Array(7).fill(91), fable: 91, disabled: allDisabled }));
    await waitForAlert('Fleet Fable window at 90%');
    await refresh(feed({ fiveHour: Array(7).fill(91), fable: 91, sevenDay: 91, disabled: allDisabled }));
    await waitForAlert('Fleet 7-day window at 90%');

    await browserEval(`(() => {
      const expected = [
        'One 5h window at 75%',
        'One 5h window at 90%',
        'One 5h window exhausted',
        'Edit 5h window at 72%',
        'Fleet 5h window at 75%',
        'Fleet 5h window at 90%',
        'Fleet Fable window at 75%',
        'Fleet Fable window at 90%',
        'Fleet 7-day window at 90%',
      ];
      for (const title of expected) {
        const count = window.__usageAlertHistory.filter((text) => text.includes(title)).length;
        if (count !== 1) throw new Error(title + ' rendered ' + count + ' times');
      }
      const warning = window.__usageAlertHistory.find((text) => text.includes('One 5h window at 75%')) || '';
      if (!warning.includes('Best swap target Two is already at 82%')) {
        throw new Error('nearly-dry target wording was absent');
      }
      if (window.__usageAlertHistory.length !== expected.length) {
        throw new Error('unexpected toast count ' + window.__usageAlertHistory.length);
      }
      return { count: window.__usageAlertHistory.length };
    })()`);

    const month = new Date().toISOString().slice(0, 7);
    await writeFile(path.join(parked, '2'), `${month} two@example.com\n`);
    await refresh(feed({ fiveHour: Array(7).fill(91), fable: 91, sevenDay: 91, disabled: allDisabled }), false);
    await browser('click', '[data-slot="account-switcher-trigger"]');
    await browser('wait', '[data-account-number="2"][data-parked]');
    await browser('wait', '--text', 'parked until');
    await browser('scrollintoview', '[data-account-number="2"]');
    await browser('hover', '[data-account-number="2"]');
    await browser('wait', '--fn', `document.querySelector('[data-account-number="2"] [data-slot="account-unpark"]')?.getBoundingClientRect().width > 0`);
    await browserEval(`(() => {
      const button = document.querySelector('[data-account-number="2"] [data-slot="account-unpark"]');
      if (!(button instanceof HTMLButtonElement) || button.disabled || button.getBoundingClientRect().width === 0) {
        throw new Error('visible enabled unpark button missing');
      }
      button.click();
      return true;
    })()`);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const markerStillExists = await stat(path.join(parked, '2')).then(
        () => true,
        (error) => {
          if (error.code === 'ENOENT') return false;
          throw error;
        },
      );
      if (!markerStillExists) break;
      if (attempt === 39) fail('unpark left the runner marker behind');
      await delay(50);
    }
    const afterUnpark = await authenticated('/api/accounts');
    const parkedAccount = afterUnpark.data?.accounts?.find((candidate) => candidate.number === 2);
    if (parkedAccount?.parkedUntil) fail('unparked account stayed parked in the REST payload');
    await browser('wait', '--fn', `!document.querySelector('[data-account-number="2"][data-parked]')`);

    const immediate = feed({ fiveHour: [45, 91, 91, 91, 91, 91, 91], fable: 91, sevenDay: 91, disabled: allDisabled });
    await refresh(immediate, false);
    await browser('wait', '--fn', `document.querySelector('[data-account-number="1"]')?.innerText.includes('45%')`);
    const cadence = feed({ fiveHour: [46, 91, 91, 91, 91, 91, 91], fable: 91, sevenDay: 91, disabled: allDisabled });
    await writeFeed(cadence);
    await browser('wait', '--fn', `document.querySelector('[data-account-number="1"]')?.innerText.includes('46%')`);

    await browserEval('window.__usageAlertHistory = []');
    await browser('set', 'viewport', '390', '844');
    await refresh(feed({ fiveHour: Array(7).fill(91), fable: 91, sevenDay: 91, disabled: allDisabled }), false);
    await waitForAlert('Fleet 5h window at 90%');
    await browserEval(`(() => {
      const toast = document.querySelector('[data-slot="usage-alert-toast"]');
      if (!toast) throw new Error('phone toast missing');
      const rect = toast.getBoundingClientRect();
      if (rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight) {
        throw new Error('phone toast is outside the viewport');
      }
      if (document.documentElement.scrollWidth > innerWidth + 1) {
        throw new Error('phone layout overflows horizontally');
      }
      return { width: rect.width, viewport: [innerWidth, innerHeight] };
    })()`);

    const browserErrors = await browser('errors');
    if (browserErrors && !browserErrors.includes('No page errors')) {
      fail(`browser reported page errors:\n${browserErrors}`);
    }
    console.log('usage-alerts dev check: 9 exact threshold toasts, gating, settings edit, parking, live updates, and phone layout passed');
  } catch (error) {
    const serverLog = await readFile(logPath, 'utf8').catch(() => '');
    if (serverLog) console.error(serverLog.slice(-8000));
    throw error;
  } finally {
    if (browserOpened) await browser('close').catch(() => undefined);
    await stopChild(serverProcess);
    await rm(directory, { recursive: true, force: true });
  }
}

await main();
