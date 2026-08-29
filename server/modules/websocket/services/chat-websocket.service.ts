import path from 'node:path';

import type { WebSocket } from 'ws';

import { messageVersionsDb, sessionsDb } from '@/modules/database/index.js';
import { providerModelsService, scheduleSessionShortLabel } from '@/modules/providers/index.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import {
  getGlobalImageAssetsDir,
  isImageAttachmentDescriptor,
  normalizeAttachmentDescriptors,
  type ChatAttachmentDescriptor,
} from '@/shared/image-attachments.js';
import type {
  AnyRecord,
  AuthenticatedWebSocketRequest,
  LLMProvider,
  ProviderPermissionDecision,
  ProviderRuntimeWriter,
} from '@/shared/types.js';
import {
  NEW_SESSION_PLACEHOLDER_TITLE,
  buildSessionTitleFromMessage,
  createNormalizedMessage,
  parseIncomingJsonObject,
} from '@/shared/utils.js';
import { commandDisplayText, parseCommandMessage } from '@/shared/command-message.js';

/**
 * Trust boundary for client-supplied image attachments: chat.send options come
 * straight from the browser, and the provider runtimes read the referenced
 * files off disk (Claude base64-encodes them into the prompt). Only images
 * that live directly inside the global runtime upload store,
 * where POST /api/assets/images puts them) are allowed through — anything
 * else (absolute paths elsewhere, traversal, subdirectories) is dropped.
 *
 * Exported for tests; `assetsRootOverride` exists only for them.
 */
export function filterAttachmentsToUploadStore(
  attachments: unknown,
  assetsRootOverride?: string,
): ChatAttachmentDescriptor[] {
  const assetsRoot = path.resolve(assetsRootOverride ?? getGlobalImageAssetsDir());

  return normalizeAttachmentDescriptors(attachments).filter((descriptor) => {
    // Relative paths are anchored in the store; absolute ones must already be in it.
    const resolved = path.resolve(assetsRoot, descriptor.path);
    const relative = path.relative(assetsRoot, resolved);
    const isDirectChild =
      relative.length > 0 &&
      !relative.startsWith('..') &&
      !path.isAbsolute(relative) &&
      !relative.includes(path.sep) &&
      !relative.includes('/');

    if (!isDirectChild) {
      console.warn(`[Chat] Dropping attachment outside the upload store: ${descriptor.path}`);
    }
    return isDirectChild;
  });
}

/** Backward-compatible image filter consumed by existing websocket tests. */
export function filterImagesToUploadStore(
  images: unknown,
  assetsRootOverride?: string,
): ChatAttachmentDescriptor[] {
  return filterAttachmentsToUploadStore(images, assetsRootOverride);
}

/** Application boundary for dispatching provider runs and approvals. */
type ProviderRuntimeGateway = {
  hasRuntime(provider: string): boolean;
  run(
    provider: LLMProvider,
    command: string,
    options: AnyRecord,
    writer: ProviderRuntimeWriter,
  ): Promise<unknown>;
  abort(provider: LLMProvider, sessionId: string): Promise<boolean>;
  resolveToolApproval(requestId: string, payload: ProviderPermissionDecision): void;
  getPendingApprovalsForSession(sessionId: string): unknown[];
};

type ChatWebSocketDependencies = {
  /** Central dispatcher for every provider SDK/CLI runtime. */
  runtime: ProviderRuntimeGateway;
  /**
   * Fired the moment a planner session's /handoff turn starts. The watchdog
   * reserves the successor row and announces it, so the new chat appears and
   * the pane switches to its loader while /handoff is still running (ui17 job
   * 17). Returns the reserved session id, or null when no row was reserved.
   */
  onPlannerHandoffTurnStart?: (input: { sessionId: string; projectPath: string }) => string | null;
  /**
   * Fired after a planner session's /handoff turn ends. A clean turn boots the
   * reserved successor (through the watchdog's fresh-boot path); an errored or
   * aborted one leaves the reserved row in place carrying the reason. Injected
   * at wiring time to avoid a module cycle through the websocket barrel.
   */
  onPlannerHandoffTurnComplete?: (input: {
    sessionId: string;
    projectPath: string;
    successorSessionId: string | null;
    failureReason: string | null;
  }) => void;
  /**
   * Model and effort a booted planner or direct worker session starts with
   * (sticky to the project's previous row of that role, else the Models
   * default). Injected for the same cycle reason as the handoff hook.
   */
  resolveBootSelection?: (input: {
    role: 'planner' | 'worker';
    provider: LLMProvider;
    projectPath: string;
    sessionId: string;
  }) => { model: string; effort: string };
  /** Project-scoped planner MCP allowlist from the System settings store. */
  resolvePlannerMcpServers?: (projectPath: string) => string[];
  /** Pauses an out-of-process dispatch chain that owns this worker session. */
  pauseDispatchSession?: (sessionId: string) => Promise<boolean>;
  /** Accounts module short-polls cached usage only while this socket shows that surface. */
  setAccountUsageVisible?: (client: WebSocket, visible: boolean) => void;
  /** Accounts module supplies all-dry recovery and a signal when headroom returns. */
  accountLimitRecovery?: {
    refresh(reason: string): Promise<{ hasHeadroom: boolean; earliestResetAt: string | null }>;
    subscribe(listener: (status: { hasHeadroom: boolean; earliestResetAt: string | null }) => void): () => void;
  };
};

type PendingLimitRetry = {
  sessionId: string;
  userId: string | number | null;
  data: AnyRecord;
  ws: WebSocket;
  dependencies: ChatWebSocketDependencies;
  retryAt: number;
  notice: string;
  timer: ReturnType<typeof setTimeout> | null;
};

const pendingLimitRetries = new Map<string, PendingLimitRetry>();
let stopRecoverySubscription: (() => void) | null = null;
const MAX_TIMER_DELAY_MS = 2_147_000_000;

/** Interactive-limit tests and the chat send path share the runner's conservative failure classifier. */
export function isSessionLimitFailure(contents: unknown[]): boolean {
  const pattern = /hit your (?:session|usage|spend)?\s*limit|session limit|usage[_ -]?limit|spend limit|out of usage credits|rate[_ -]?limit/i;
  return contents.some((content) => typeof content === 'string' && pattern.test(content));
}

const retryTime = (resetAt: string | null): number => {
  const parsed = resetAt ? Date.parse(resetAt) : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(Date.now() + 1000, parsed) : Date.now() + 30 * 60_000;
};

const formatRetryTime = (timestamp: number): string => new Date(timestamp).toLocaleTimeString('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

async function retryPendingLimitTurn(pending: PendingLimitRetry): Promise<void> {
  if (pendingLimitRetries.get(pending.sessionId) !== pending) return;
  if (chatRunRegistry.isProcessing(pending.sessionId)) {
    pending.timer = setTimeout(() => { void retryPendingLimitTurn(pending); }, 5000);
    pending.timer.unref?.();
    return;
  }
  if (pending.timer) clearTimeout(pending.timer);
  pendingLimitRetries.delete(pending.sessionId);
  await handleChatSend(pending.ws, pending.userId, pending.data, pending.dependencies);
}

function armPendingLimitTimer(pending: PendingLimitRetry): void {
  const remaining = pending.retryAt - Date.now();
  if (remaining <= 0) {
    void retryPendingLimitTurn(pending);
    return;
  }
  pending.timer = setTimeout(() => {
    if (pending.retryAt - Date.now() > 0) armPendingLimitTimer(pending);
    else void retryPendingLimitTurn(pending);
  }, Math.min(remaining, MAX_TIMER_DELAY_MS));
  pending.timer.unref?.();
}

function scheduleLimitRetry(
  run: NonNullable<ReturnType<typeof chatRunRegistry.getRun>>,
  ws: WebSocket,
  userId: string | number | null,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies,
  earliestResetAt: string | null,
): void {
  if (pendingLimitRetries.has(run.appSessionId)) return;
  const retryAt = retryTime(earliestResetAt);
  const notice = `waiting for a session window, resumes ~${formatRetryTime(retryAt)}`;
  const pending: PendingLimitRetry = {
    sessionId: run.appSessionId,
    userId,
    data: { ...data, options: recordOptions(data.options) },
    ws,
    dependencies,
    retryAt,
    notice,
    timer: null,
  };
  pendingLimitRetries.set(run.appSessionId, pending);
  armPendingLimitTimer(pending);

  // The status keeps the client-side processing map occupied, so its queued
  // stack cannot auto-pop while this failed turn is waiting. The machine row
  // is the quiet transcript explanation requested by the usage-alert design.
  run.writer.send(createNormalizedMessage({
    id: `limit_wait_status_${run.appSessionId}_${retryAt}`,
    kind: 'status',
    text: 'waiting_for_session_window',
    canInterrupt: false,
    provider: run.provider,
    sessionId: run.appSessionId,
  }));
  run.writer.send(createNormalizedMessage({
    id: `limit_wait_${run.appSessionId}_${retryAt}`,
    kind: 'text',
    role: 'user',
    messageOrigin: 'watchdog',
    content: notice,
    provider: run.provider,
    sessionId: run.appSessionId,
  }));

  if (!stopRecoverySubscription && dependencies.accountLimitRecovery) {
    stopRecoverySubscription = dependencies.accountLimitRecovery.subscribe((status) => {
      if (!status.hasHeadroom) return;
      for (const queued of pendingLimitRetries.values()) {
        void retryPendingLimitTurn(queued);
      }
    });
  }
}

function recordOptions(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as AnyRecord) }
    : {};
}

/**
 * Extracts the authenticated request user id in the formats currently produced
 * by platform and OSS auth code paths.
 */
function readRequestUserId(
  request: AuthenticatedWebSocketRequest | undefined
): string | number | null {
  const user = request?.user;
  if (!user) {
    return null;
  }

  if (typeof user.id === 'string' || typeof user.id === 'number') {
    return user.id;
  }

  if (typeof user.userId === 'string' || typeof user.userId === 'number') {
    return user.userId;
  }

  return null;
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WS_OPEN_STATE) {
    ws.send(JSON.stringify(payload));
  }
}

/**
 * Reports a protocol-level failure to the requesting client.
 *
 * Protocol errors deliberately use their own `kind` (instead of the provider
 * `error` message kind) so the frontend can distinguish "your request was
 * invalid" from "the model run produced an error" without inspecting text.
 */
function sendProtocolError(
  ws: WebSocket,
  code: string,
  error: string,
  sessionId?: string
): void {
  sendJson(ws, {
    kind: 'protocol_error',
    code,
    error,
    sessionId: sessionId ?? null,
    timestamp: new Date().toISOString(),
  });
}

function readRequiredSessionId(data: AnyRecord): string | null {
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId.trim() : '';
  return sessionId.length > 0 ? sessionId : null;
}

/**
 * Handles `chat.send`: resolves the session row (provider, project path, and
 * provider-native id all come from the database — never from the client),
 * registers the run, and dispatches to the provider runtime.
 */
async function handleChatSend(
  ws: WebSocket,
  userId: string | number | null,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies
): Promise<void> {
  const sessionId = readRequiredSessionId(data);
  if (!sessionId) {
    sendProtocolError(ws, 'SESSION_ID_REQUIRED', 'chat.send requires a sessionId.');
    return;
  }

  const session = sessionsDb.getSessionById(sessionId);
  if (!session) {
    sendProtocolError(
      ws,
      'SESSION_NOT_FOUND',
      `Session "${sessionId}" was not found. Create it via POST /api/providers/sessions first.`,
      sessionId
    );
    return;
  }

  const provider = session.provider as LLMProvider;
  if (!dependencies.runtime.hasRuntime(provider)) {
    sendProtocolError(ws, 'UNSUPPORTED_PROVIDER', `Provider "${provider}" is not available.`, sessionId);
    return;
  }

  const run = chatRunRegistry.startRun({
    appSessionId: sessionId,
    provider,
    providerSessionId: session.provider_session_id,
    userId,
  });

  if (!run) {
    sendProtocolError(
      ws,
      'RUN_IN_PROGRESS',
      `Session "${sessionId}" already has a run in progress.`,
      sessionId
    );
    return;
  }

  const clientOptions = (data.options ?? {}) as AnyRecord;
  const command = typeof data.content === 'string' ? data.content : '';
  // Composer-sent slash commands arrive as a tagged wrapper plus the expanded
  // body; titles and the handoff hook key off the parsed command, never the
  // raw expansion.
  const parsedCommand = parseCommandMessage(command);
  const commandTitleText = parsedCommand ? commandDisplayText(parsedCommand) : '';

  // Handoff follow-through (ui17 job 17): the Handoff button and a typed
  // /handoff always spawn the successor, and they spawn it now — the row and
  // its loading pane are on screen before /handoff has written a word. The
  // boot into that row waits for this turn to end cleanly.
  const isPlannerHandoffTurn =
    parsedCommand?.name === '/handoff'
    && session.origin === 'planner'
    && Boolean(session.project_path)
    && clientOptions.bootPrompt !== true;
  const handoffSuccessorId = isPlannerHandoffTurn
    ? dependencies.onPlannerHandoffTurnStart?.({
      sessionId,
      projectPath: session.project_path as string,
    }) ?? null
    : null;

  // Boot sessions carry a placeholder title until the first real user-typed
  // message arrives; auto-sent boot prompts flag themselves and never title.
  if (
    session.custom_name === NEW_SESSION_PLACEHOLDER_TITLE
    && clientOptions.bootPrompt !== true
    && command.trim()
  ) {
    const titleSource = commandTitleText || command;
    const typedTitle = buildSessionTitleFromMessage(titleSource);
    sessionsDb.updateSessionCustomName(sessionId, typedTitle);
    scheduleSessionShortLabel({
      sessionId,
      provider,
      message: titleSource,
      currentTitle: typedTitle,
    });
  }

  // Stamp boot-started sessions so the client hides exactly those prologues —
  // a session whose first message was typed never gets its first turn hidden.
  if (clientOptions.bootPrompt === true) {
    sessionsDb.markSessionBooted(sessionId);
    // A planner or direct worker boot runs with the project's sticky
    // selection, not whatever the composer happened to hold.
    if ((session.origin === 'planner' || session.origin === 'direct') && dependencies.resolveBootSelection) {
      const selection = dependencies.resolveBootSelection({
        role: session.origin === 'planner' ? 'planner' : 'worker',
        provider,
        projectPath: session.project_path ?? '',
        sessionId,
      });
      if (selection.model) {
        clientOptions.model = selection.model;
      }
      clientOptions.effort = selection.effort;
    }
  }

  if (session.origin === 'planner') {
    clientOptions.mcpPolicy = 'planner';
    clientOptions.allowedMcpServers = dependencies.resolvePlannerMcpServers?.(session.project_path ?? '') ?? [];
  } else if (session.origin === 'dispatch' || session.origin === 'maintenance') {
    clientOptions.mcpPolicy = 'none';
    // Chains always run at the standard tier, even if a browser sent a stale
    // fast-mode option or the host's Codex config defaults to fast.
    clientOptions.fastMode = false;
  }

  // Record what this turn runs with so reopening the session later restores
  // the same model, reasoning effort, and interactive fast-tier choice.
  if (typeof clientOptions.model === 'string' && clientOptions.model.trim()) {
    providerModelsService.setSessionModel(provider, sessionId, clientOptions.model);
  }
  if (typeof clientOptions.effort === 'string' && clientOptions.effort.trim()) {
    providerModelsService.setSessionEffort(provider, sessionId, clientOptions.effort);
  }
  if (provider === 'codex' && typeof clientOptions.fastMode === 'boolean') {
    providerModelsService.setSessionFastMode(provider, sessionId, clientOptions.fastMode);
  }

  // Edit-and-resend (ui9 B3): the send carries which prior exchange it
  // replaces. Record the version rows before dispatch so they exist even if
  // the run dies; the transcript itself is never touched.
  const edit = clientOptions.edit as AnyRecord | undefined;
  if (
    edit
    && typeof edit.groupId === 'string' && edit.groupId.trim()
    && typeof edit.anchorUserMessageId === 'string' && edit.anchorUserMessageId.trim()
    && typeof edit.anchorPromptText === 'string'
  ) {
    try {
      messageVersionsDb.recordResend({
        sessionId,
        groupId: edit.groupId,
        anchorUserMessageId: edit.anchorUserMessageId,
        anchorPromptText: edit.anchorPromptText,
        promptText: command,
      });
    } catch (error) {
      console.error('[Chat] Failed to record message version', { sessionId, error });
    }
  }

  const attachmentCandidates = [
    ...normalizeAttachmentDescriptors(clientOptions.images),
    ...normalizeAttachmentDescriptors(clientOptions.files),
    ...normalizeAttachmentDescriptors(clientOptions.attachments),
  ];
  const verifiedAttachments = filterAttachmentsToUploadStore(attachmentCandidates);
  const uniqueAttachments = verifiedAttachments.filter(
    (descriptor, index, all) => all.findIndex((candidate) => candidate.path === descriptor.path) === index,
  );

  // The provider runtimes receive the stable app session id. When their
  // CLI/SDK needs the provider-native id for resume, they resolve it from the
  // session row themselves (sessionsService.resolveProviderSessionId).
  // Brand-new sessions have no provider id yet, so the runtime starts fresh
  // and announces one, which the gateway writer captures and maps back to the
  // app session id.
  const runtimeOptions: AnyRecord = {
    ...clientOptions,
    // Attachments are re-validated server-side: only direct children of the
    // global upload store may reach provider runtimes or their file tools.
    attachments: uniqueAttachments,
    images: uniqueAttachments.filter(isImageAttachmentDescriptor),
    files: uniqueAttachments.filter((descriptor) => !isImageAttachmentDescriptor(descriptor)),
    sessionId,
    cwd: clientOptions.cwd ?? session.project_path ?? undefined,
    projectPath: session.project_path ?? clientOptions.projectPath,
  };
  // Version bookkeeping is Command Center-side only; runtimes never see it.
  delete runtimeOptions.edit;

  let runtimeThrew = false;
  try {
    await dependencies.runtime.run(provider, command, runtimeOptions, run.writer);
  } catch (error) {
    runtimeThrew = true;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Chat] Provider runtime "${provider}" failed`, { sessionId, error: message });
  } finally {
    // Safety net: a runtime that crashed (or resolved) without emitting its
    // terminal `complete` would otherwise leave the session stuck in
    // "processing" forever on every connected client. Scoped to THIS run —
    // a queued message can start the session's next run before this promise
    // settles, and the session-keyed completeRun would kill that new run.
    chatRunRegistry.completeRunIfCurrent(run, { exitCode: 1 });

    // Persist the boot turn's outcome so a refresh (or restart) reopens an
    // aborted or errored boot as a failed boot, never as a plain chat.
    if (clientOptions.bootPrompt === true) {
      const failed = runtimeThrew || run.sawError || run.aborted;
      sessionsDb.setSessionBootState(sessionId, failed ? 'failed' : 'ready');
    }

    const limitErrors = run.events
      .filter((event) => event.kind === 'error')
      .map((event) => event.content);
    if (
      provider === 'claude'
      && !run.aborted
      && isSessionLimitFailure(limitErrors)
      && dependencies.accountLimitRecovery
    ) {
      try {
        const recovery = await dependencies.accountLimitRecovery.refresh('interactive-limit');
        if (!recovery.hasHeadroom) {
          scheduleLimitRetry(run, ws, userId, data, dependencies, recovery.earliestResetAt);
        }
      } catch (error) {
        console.error('[Chat] Could not read account headroom after a session limit:', error);
      }
    }

    // Handoff follow-through (ui11 phase 3, always-on since ui17 job 17): a
    // clean turn boots the reserved successor; an aborted or errored one keeps
    // the placeholder row on screen with the reason, never a silent roll back.
    if (isPlannerHandoffTurn) {
      const aborted = run.aborted;
      const failed = runtimeThrew || run.sawError || aborted;
      dependencies.onPlannerHandoffTurnComplete?.({
        sessionId,
        projectPath: session.project_path as string,
        successorSessionId: handoffSuccessorId,
        failureReason: failed
          ? (aborted
            ? 'The handoff turn was stopped before it finished, so the new planner was not started.'
            : 'The handoff turn ended with an error, so the new planner was not started.')
          : null,
      });
    }
  }
}

/**
 * Handles `chat.abort`: cancels the run for one app session and emits the
 * terminal `complete` on its behalf (runtimes skip their own complete for
 * aborted runs, and the registry drops any duplicate).
 */
async function handleChatAbort(
  ws: WebSocket,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies
): Promise<void> {
  const sessionId = readRequiredSessionId(data);
  if (!sessionId) {
    sendProtocolError(ws, 'SESSION_ID_REQUIRED', 'chat.abort requires a sessionId.');
    return;
  }

  const run = chatRunRegistry.getRun(sessionId);
  if (!run || run.status !== 'running') {
    if (dependencies.pauseDispatchSession && await dependencies.pauseDispatchSession(sessionId)) {
      return;
    }
    sendProtocolError(ws, 'NO_ACTIVE_RUN', `Session "${sessionId}" has no active run.`, sessionId);
    return;
  }

  const success = await dependencies.runtime.abort(run.provider, sessionId);

  chatRunRegistry.completeRun(sessionId, {
    exitCode: success ? 0 : 1,
    aborted: true,
  });
}

/**
 * Handles `chat.subscribe`: for each requested session, reports whether a run
 * is processing, re-attaches the live stream to this socket, replays missed
 * events (seq > lastSeq), and includes pending permission requests.
 *
 * This single message replaces the old `check-session-status`,
 * `get-pending-permissions`, and Claude-only writer reconnect flows.
 */
function handleChatSubscribe(
  ws: WebSocket,
  data: AnyRecord,
  dependencies: ChatWebSocketDependencies
): void {
  const targets = Array.isArray(data.sessions) ? data.sessions : [];

  for (const target of targets) {
    if (!target || typeof target !== 'object') {
      continue;
    }

    const sessionId = typeof (target as AnyRecord).sessionId === 'string'
      ? ((target as AnyRecord).sessionId as string).trim()
      : '';
    if (!sessionId) {
      continue;
    }

    const lastSeqRaw = (target as AnyRecord).lastSeq;
    const lastSeq = typeof lastSeqRaw === 'number' && Number.isFinite(lastSeqRaw)
      ? Math.max(0, Math.floor(lastSeqRaw))
      : 0;

    const run = chatRunRegistry.getRun(sessionId);
    const waiting = pendingLimitRetries.get(sessionId);
    const runIsProcessing = chatRunRegistry.isProcessing(sessionId);
    const isProcessing = runIsProcessing || Boolean(waiting);

    // Live run events are broadcast to every connected chat client, so a
    // fresh socket (page refresh, second device) starts receiving the
    // still-running stream the moment it connects; subscribe only needs to
    // replay what this socket missed.

    // Pending approvals are tracked under the app session id inside the
    // Claude runtime, so they can be looked up directly.
    const pendingPermissions = dependencies.runtime.getPendingApprovalsForSession(sessionId);

    sendJson(ws, {
      kind: 'chat_subscribed',
      sessionId,
      isProcessing,
      lastSeq: run?.lastSeq ?? 0,
      pendingPermissions,
      timestamp: new Date().toISOString(),
    });

    if (waiting) {
      sendJson(ws, createNormalizedMessage({
        id: `limit_wait_status_${sessionId}_${waiting.retryAt}`,
        kind: 'status',
        text: 'waiting_for_session_window',
        canInterrupt: false,
        provider: 'claude',
        sessionId,
      }));
      sendJson(ws, createNormalizedMessage({
        id: `limit_wait_${sessionId}_${waiting.retryAt}`,
        kind: 'text',
        role: 'user',
        messageOrigin: 'watchdog',
        content: waiting.notice,
        provider: 'claude',
        sessionId,
      }));
    }

    // Replay only for RUNNING runs, strictly after the ack. Completed runs
    // are fully persisted to the provider transcript and served over REST —
    // replaying them (e.g. after a page reload where the client's lastSeq is
    // 0) would duplicate messages the history fetch already returned.
    if (runIsProcessing) {
      for (const event of chatRunRegistry.replayEvents(sessionId, lastSeq)) {
        sendJson(ws, event);
      }
    }
  }
}

/**
 * Handles `chat.permission-response`: forwards a tool-approval decision to the
 * pending approval resolver (Claude is the only provider with interactive
 * approvals today, but the message is intentionally provider-neutral).
 */
function handlePermissionResponse(data: AnyRecord, dependencies: ChatWebSocketDependencies): void {
  if (typeof data.requestId !== 'string' || data.requestId.length === 0) {
    return;
  }

  dependencies.runtime.resolveToolApproval(data.requestId, {
    allow: Boolean(data.allow),
    updatedInput: data.updatedInput,
    message: typeof data.message === 'string' ? data.message : undefined,
    rememberEntry: data.rememberEntry,
  });
}

/**
 * Handles authenticated chat websocket messages used by the main chat panel.
 *
 * Inbound protocol (client to server):
 * - `chat.send`                { sessionId, content, options? }
 * - `chat.abort`               { sessionId }
 * - `chat.subscribe`           { sessions: [{ sessionId, lastSeq? }] }
 * - `chat.permission-response` { requestId, allow, updatedInput?, message?, rememberEntry? }
 * - `accounts.subscribe` / `accounts.unsubscribe` toggle the cache-backed usage cadence
 *
 * Outbound protocol (server to client): every frame is `kind`-based — either
 * a provider `NormalizedMessage` (with `seq`) or a gateway event
 * (`chat_subscribed`, `session_upserted`, `loading_progress`,
 * `protocol_error`).
 */
export function handleChatConnection(
  ws: WebSocket,
  request: AuthenticatedWebSocketRequest,
  dependencies: ChatWebSocketDependencies
): void {
  console.log('[INFO] Chat WebSocket connected');
  connectedClients.add(ws);

  const userId = readRequestUserId(request);

  ws.on('message', async (rawMessage) => {
    try {
      const parsed = parseIncomingJsonObject(rawMessage);
      if (!parsed) {
        throw new Error('Invalid websocket payload');
      }

      const data = parsed as AnyRecord;
      const messageType = typeof data.type === 'string' ? data.type : '';

      switch (messageType) {
        case 'chat.send':
          await handleChatSend(ws, userId, data, dependencies);
          return;
        case 'chat.abort':
          await handleChatAbort(ws, data, dependencies);
          return;
        case 'chat.subscribe':
          handleChatSubscribe(ws, data, dependencies);
          return;
        case 'chat.permission-response':
          handlePermissionResponse(data, dependencies);
          return;
        case 'accounts.subscribe':
          dependencies.setAccountUsageVisible?.(ws, true);
          return;
        case 'accounts.unsubscribe':
          dependencies.setAccountUsageVisible?.(ws, false);
          return;
        default:
          sendProtocolError(ws, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type "${messageType}".`);
          return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ERROR] Chat WebSocket error:', message);
      sendProtocolError(ws, 'INTERNAL_ERROR', message);
    }
  });

  ws.on('close', () => {
    console.log('[INFO] Chat client disconnected');
    dependencies.setAccountUsageVisible?.(ws, false);
    connectedClients.delete(ws);
  });
}
