import { execFile } from 'child_process';
import crypto from 'crypto';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';

import { getChatgptAccount } from '@/modules/providers/index.js';
import { AppError } from '@/shared/utils.js';

/**
 * Claude account switching via the machine's cswap CLI (ui8 phase 6).
 *
 * Every cswap invocation runs against the machine-global claude profile
 * (~/.claude): cswap writes the *default* macOS Keychain item no matter what
 * CLAUDE_CONFIG_DIR says, so running it scoped would split the credential file
 * and Keychain truth between accounts. An instance that runs with its own
 * CLAUDE_CONFIG_DIR (dev on 4748) instead gets the freshly switched credential
 * mirrored into its config-dir-scoped Keychain service after a switch — the
 * same mirror scripts/macos/cloudcli-dev-start.sh performs at boot.
 */

const CSWAP_BIN = process.env.CSWAP_PATH || path.join(os.homedir(), '.local', 'bin', 'cswap');
const CSWAP_TIMEOUT_MS = 120_000;

/** Default Keychain item cswap and the claude CLI share for the active login. */
const DEFAULT_KEYCHAIN_SERVICE = 'Claude Code-credentials';

const cswapEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  delete env.CLAUDE_CONFIG_DIR;
  return env;
};

type CswapResult = { stdout: string; stderr: string };

// cswap mutates one shared credential store; serialize invocations so two
// browser tabs can't interleave a switch with a list mid-write.
let chain: Promise<unknown> = Promise.resolve();
const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
};

const runCswap = (args: string[]): Promise<CswapResult> =>
  serialize(
    () =>
      new Promise<CswapResult>((resolve, reject) => {
        execFile(
          CSWAP_BIN,
          args,
          { env: cswapEnv(), timeout: CSWAP_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
          (error, stdout, stderr) => {
            if (error) {
              // --json failures land a structured envelope on stdout; surface
              // its message. Fall back to stderr, never to the raw error (it
              // would echo the argv, harmless here but noisy).
              let message = '';
              try {
                const envelope = JSON.parse(stdout);
                message = typeof envelope?.error?.message === 'string' ? envelope.error.message : '';
              } catch {
                // Not JSON output; use stderr below.
              }
              if (!message) {
                message = stderr.trim().split('\n').filter(Boolean).pop() || 'cswap failed';
              }
              reject(new AppError(message, { code: 'CSWAP_FAILED', statusCode: 502 }));
              return;
            }
            resolve({ stdout, stderr });
          },
        );
      }),
  );

const parseJson = (stdout: string): unknown => {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new AppError('cswap returned unparseable output.', {
      code: 'CSWAP_BAD_OUTPUT',
      statusCode: 502,
    });
  }
};

/**
 * A slot number, email, or alias. Rejecting a leading '-' keeps a request body
 * from smuggling cswap flags (e.g. --force) through the target position.
 */
export const assertAccountTarget = (value: unknown): string => {
  const target = typeof value === 'string' ? value.trim() : '';
  if (!target || target.startsWith('-') || /\s/.test(target)) {
    throw new AppError('target must be a slot number or email.', {
      code: 'INVALID_ACCOUNT_TARGET',
      statusCode: 400,
    });
  }
  return target;
};

/** cswap's list plus the ChatGPT login (codex job 3) under `chatgpt`. */
export const listAccounts = async (): Promise<unknown> => {
  const [list, chatgpt] = await Promise.all([
    runCswap(['list', '--json']).then((result) => parseJson(result.stdout)),
    getChatgptAccount(),
  ]);
  return { ...(list as Record<string, unknown>), chatgpt };
};

export const getAccountStatus = async (): Promise<unknown> =>
  parseJson((await runCswap(['status', '--json'])).stdout);

export const switchAccount = async (target: string): Promise<{ result: unknown; mirrored: boolean }> => {
  const result = parseJson((await runCswap(['switch', target, '--json'])).stdout);
  const mirrored = await mirrorCredentialsToInstance();
  return { result, mirrored };
};

export const disableAccount = async (target: string): Promise<void> => {
  await runCswap(['disable', target]);
};

export const enableAccount = async (target: string): Promise<void> => {
  await runCswap(['enable', target]);
};

export const swapAccounts = async (a: string, b: string): Promise<void> => {
  await runCswap(['swap', a, b]);
};

const runSecurity = (args: string[], input?: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = execFile('/usr/bin/security', args, { timeout: 10_000 }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
    if (input !== undefined && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });

/**
 * After a switch, copy the (now switched) default Keychain credential into
 * this instance's config-dir-scoped Keychain service and .credentials.json so
 * new sessions spawned by THIS server pick up the new account without a
 * restart. No-op on the default profile (live), which reads the default item
 * directly. Best-effort: a mirror failure must not undo a completed switch,
 * so the caller reports it instead of throwing.
 */
const mirrorCredentialsToInstance = async (): Promise<boolean> => {
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  if (!configDir || process.platform !== 'darwin') {
    return true;
  }
  try {
    const account = process.env.USER || os.userInfo().username;
    const creds = (
      await runSecurity(['find-generic-password', '-s', DEFAULT_KEYCHAIN_SERVICE, '-a', account, '-w'])
    ).replace(/\n$/, '');
    if (!creds) {
      return false;
    }
    // The claude CLI scopes its Keychain service by the sha256 of the raw,
    // NFC-normalized CLAUDE_CONFIG_DIR value (first 8 hex chars).
    const digest = crypto
      .createHash('sha256')
      .update(configDir.normalize('NFC'), 'utf8')
      .digest('hex')
      .slice(0, 8);
    // Write through `security -i` (stdin) with a hex payload (-X) so the
    // credential never appears in any process argv.
    const hex = Buffer.from(creds, 'utf8').toString('hex').toUpperCase();
    await runSecurity(
      ['-i'],
      `add-generic-password -U -a "${account}" -s "${DEFAULT_KEYCHAIN_SERVICE}-${digest}" -X ${hex}\n`,
    );
    const credentialsPath = path.join(configDir, '.credentials.json');
    await fsPromises.writeFile(credentialsPath, `${creds}\n`, { mode: 0o600 });
    await fsPromises.chmod(credentialsPath, 0o600);
    return true;
  } catch (error) {
    console.error('Account switch: instance credential mirror failed:', error);
    return false;
  }
};
