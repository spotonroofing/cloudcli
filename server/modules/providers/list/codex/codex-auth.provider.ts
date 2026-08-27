import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import spawn from 'cross-spawn';

import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';
import { readObjectRecord, readOptionalString } from '@/shared/utils.js';

type CodexCredentialsStatus = {
  authenticated: boolean;
  email: string | null;
  method: string | null;
  error?: string;
};

/** The claims the app reads off a Codex id token; never the token itself. */
export type CodexIdTokenClaims = {
  email?: string;
  /** ChatGPT plan slug (`plus`, `pro`, `prolite`, ...). */
  plan?: string;
  /** Token expiry, unix seconds. */
  exp?: number;
};

export type CodexLogin = {
  /** True when auth.json carries an id or access token. */
  loggedIn: boolean;
  email: string | null;
  plan: string | null;
  /** Id token expiry, unix seconds, when readable. */
  tokenExpiresAt: number | null;
};

const PLAN_CLAIM = 'https://api.openai.com/auth.chatgpt_plan_type';

/**
 * Decodes the payload of a Codex id token (a JWT). Returns only the claims
 * the app shows; the caller must never surface the token itself.
 */
export function decodeCodexIdToken(idToken: string): CodexIdTokenClaims {
  try {
    const parts = idToken.split('.');
    if (parts.length >= 2) {
      const payload = readObjectRecord(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))) ?? {};
      const exp = Number(payload.exp);
      return {
        email: readOptionalString(payload.email) ?? readOptionalString(payload.user),
        plan: readOptionalString(payload[PLAN_CLAIM]),
        exp: Number.isFinite(exp) ? exp : undefined,
      };
    }
  } catch {
    // Not a readable JWT payload; the caller falls back to a generic marker.
  }
  return {};
}

/**
 * Reads the ChatGPT login Codex holds in auth.json: whether a token exists,
 * and the email and plan decoded from the id token. A missing or unreadable
 * file is simply logged out.
 */
export async function readCodexLogin(
  authPath = path.join(os.homedir(), '.codex', 'auth.json'),
): Promise<CodexLogin> {
  try {
    const auth = readObjectRecord(JSON.parse(await readFile(authPath, 'utf8'))) ?? {};
    const tokens = readObjectRecord(auth.tokens) ?? {};
    const idToken = readOptionalString(tokens.id_token);
    const accessToken = readOptionalString(tokens.access_token);
    if (!idToken && !accessToken) {
      return { loggedIn: false, email: null, plan: null, tokenExpiresAt: null };
    }
    const claims = idToken ? decodeCodexIdToken(idToken) : {};
    return {
      loggedIn: true,
      email: claims.email ?? null,
      plan: claims.plan ?? null,
      tokenExpiresAt: claims.exp ?? null,
    };
  } catch {
    return { loggedIn: false, email: null, plan: null, tokenExpiresAt: null };
  }
}

export class CodexProviderAuth implements IProviderAuth {
  /**
   * Checks whether Codex is available to the server runtime.
   */
  private checkInstalled(): boolean {
    try {
      spawn.sync('codex', ['--version'], { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns Codex SDK availability and credential status.
   */
  async getStatus(): Promise<ProviderAuthStatus> {
    const installed = this.checkInstalled();
    const credentials = await this.checkCredentials();

    return {
      installed,
      provider: 'codex',
      authenticated: credentials.authenticated,
      email: credentials.email,
      method: credentials.method,
      error: credentials.authenticated ? undefined : credentials.error || 'Not authenticated',
    };
  }

  /**
   * Reads Codex auth.json and checks OAuth tokens or an API key fallback.
   */
  private async checkCredentials(): Promise<CodexCredentialsStatus> {
    try {
      const authPath = path.join(os.homedir(), '.codex', 'auth.json');
      const content = await readFile(authPath, 'utf8');
      const auth = readObjectRecord(JSON.parse(content)) ?? {};
      const tokens = readObjectRecord(auth.tokens) ?? {};
      const idToken = readOptionalString(tokens.id_token);
      const accessToken = readOptionalString(tokens.access_token);

      if (idToken || accessToken) {
        return {
          authenticated: true,
          email: idToken ? this.readEmailFromIdToken(idToken) : 'Authenticated',
          method: 'credentials_file',
        };
      }

      if (readOptionalString(auth.OPENAI_API_KEY)) {
        return { authenticated: true, email: 'API Key Auth', method: 'api_key' };
      }

      return { authenticated: false, email: null, method: null, error: 'No valid tokens found' };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return {
        authenticated: false,
        email: null,
        method: null,
        error: code === 'ENOENT' ? 'Codex not configured' : error instanceof Error ? error.message : 'Failed to read Codex auth',
      };
    }
  }

  /**
   * Extracts the user email from a Codex id_token when a readable JWT payload exists.
   */
  private readEmailFromIdToken(idToken: string): string {
    return decodeCodexIdToken(idToken).email ?? 'Authenticated';
  }
}
