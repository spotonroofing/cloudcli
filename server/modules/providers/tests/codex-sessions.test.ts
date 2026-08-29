import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/codex-session-synchronizer.provider.js';
import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';
import { wrapMachineMessage } from '@/shared/utils.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

test('Codex history keeps watchdog origin metadata on its user row', () => {
  const provider = new CodexSessionsProvider();
  const [row] = provider.normalizeMessage({
    uuid: 'watchdog-1',
    timestamp: '2026-08-27T10:00:00.000Z',
    message: { role: 'user', content: wrapMachineMessage('Inspect the run.', 'watchdog') },
  }, 'session-1');
  assert.equal(row.content, 'Inspect the run.');
  assert.equal(row.messageOrigin, 'watchdog');
});

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'codex-provider-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/**
 * Writes one Codex rollout transcript. `firstUserMessage` mirrors the
 * `event_msg`/`user_message` payload the runtime records for the prompt the
 * user typed; omitting it produces a transcript with no user turn.
 */
const writeCodexTranscript = async (
  homeDir: string,
  codexSessionId: string,
  workspacePath: string,
  firstUserMessage?: string,
): Promise<string> => {
  const sessionsDir = path.join(homeDir, '.codex', 'sessions', '2026', '07', '07');
  await mkdir(sessionsDir, { recursive: true });

  const lines: string[] = [
    JSON.stringify({ type: 'session_meta', payload: { id: codexSessionId, cwd: workspacePath } }),
  ];
  if (firstUserMessage !== undefined) {
    lines.push(JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: firstUserMessage } }));
  }

  const filePath = path.join(sessionsDir, `rollout-${codexSessionId}.jsonl`);
  await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
};

test('Codex synchronizer preserves the title assigned when Command Center creates a session', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-sync-app-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    await writeCodexTranscript(tempRoot, 'codex-app-1', workspacePath, 'Provider transcript title must not win');
    await withIsolatedDatabase(async () => {
      // The app allocates its own id and later maps the provider id onto it,
      // exactly as a message sent from command-center does.
      sessionsDb.createAppSession('app-1', 'codex', workspacePath, 'Fix the login redirect');
      sessionsDb.assignProviderSessionId('app-1', 'codex-app-1');

      const synchronizer = new CodexSessionSynchronizer();
      await synchronizer.synchronize();

      assert.equal(sessionsDb.getSessionById('app-1')?.custom_name, 'Fix the login redirect');
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex synchronizer skips sub-agent rollout files', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-sync-subagent-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    // Codex >=0.144 spawn_agent threads write their own rollout files into the
    // same sessions tree, marked via thread_source/source in session_meta.
    const sessionsDir = path.join(tempRoot, '.codex', 'sessions', '2026', '07', '07');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      path.join(sessionsDir, 'rollout-codex-subagent-1.jsonl'),
      `${JSON.stringify({
        type: 'session_meta',
        payload: {
          id: 'codex-subagent-1',
          cwd: workspacePath,
          thread_source: 'subagent',
          parent_thread_id: 'codex-parent-1',
          source: { subagent: { thread_spawn: { parent_thread_id: 'codex-parent-1', depth: 1 } } },
        },
      })}\n`,
      'utf8'
    );
    await writeCodexTranscript(tempRoot, 'codex-parent-1', workspacePath);

    await withIsolatedDatabase(async () => {
      const synchronizer = new CodexSessionSynchronizer();
      const processed = await synchronizer.synchronize();

      assert.equal(processed, 1);
      assert.ok(sessionsDb.getSessionById('codex-parent-1'));
      assert.equal(sessionsDb.getSessionById('codex-subagent-1'), null);
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex synchronizer leaves indexed sessions untitled when no name is available', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-sync-indexed-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    // A CLI-created session has no app row; its first user message must NOT be
    // used as the title, preserving the existing indexing behavior.
    await writeCodexTranscript(tempRoot, 'codex-indexed-1', workspacePath, 'This prompt should be ignored');
    await withIsolatedDatabase(async () => {
      const synchronizer = new CodexSessionSynchronizer();
      await synchronizer.synchronize();

      assert.equal(sessionsDb.getSessionById('codex-indexed-1')?.custom_name, 'Untitled Codex Session');
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex history row ids remain stable when rollout rows append', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-stable-history-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const providerSessionId = 'codex-stable-1';
    const transcriptPath = await writeCodexTranscript(
      tempRoot,
      providerSessionId,
      workspacePath,
      'First prompt',
    );

    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-stable-1', 'codex', workspacePath);
      sessionsDb.assignProviderSessionId('app-stable-1', providerSessionId);
      await new CodexSessionSynchronizer().synchronize();

      const provider = new CodexSessionsProvider();
      const before = await provider.fetchHistory('app-stable-1');
      await appendFile(transcriptPath, `${JSON.stringify({
        timestamp: '2026-08-27T12:00:00.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Appended answer' }],
        },
      })}\n`, 'utf8');
      const after = await provider.fetchHistory('app-stable-1');
      const repeated = await provider.fetchHistory('app-stable-1');

      assert.equal(before.messages.length, 1);
      assert.equal(after.messages.length, 2);
      assert.equal(after.messages[0].id, before.messages[0].id);
      assert.deepEqual(
        repeated.messages.map((message) => message.id),
        after.messages.map((message) => message.id),
      );
      assert.ok(after.messages.every((message) => message.id.startsWith('codex-rollout-app-stable-1-')));
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex history preserves wrapped exec tool calls and results', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-exec-history-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const providerSessionId = 'codex-exec-1';
    const transcriptPath = await writeCodexTranscript(tempRoot, providerSessionId, workspacePath);
    const wrappedCalls = [
      {
        callId: 'shell-command-1',
        input: 'const cmds = ["echo one", "echo two"]; await Promise.all(cmds.map(command => tools.shell_command({ command })));',
        expectedToolName: 'Bash',
        expectedToolInput: JSON.stringify({ command: 'echo one\necho two' }),
      },
      {
        callId: 'json-shell-command-1',
        input: 'const r = await tools.shell_command({"command":"Get-Content -Raw README.md","workdir":"C:\\\\workspace","timeout_ms":10000}); text(r)',
        expectedToolName: 'Bash',
        expectedToolInput: JSON.stringify({ command: 'Get-Content -Raw README.md' }),
      },
      {
        callId: 'exec-command-1',
        input: 'await tools.exec_command({"command":"echo current"});',
        expectedToolName: 'Bash',
        expectedToolInput: JSON.stringify({ command: 'echo current' }),
      },
      { callId: 'apply-patch-1', input: 'await tools.apply_patch("*** Begin Patch\\n*** End Patch");' },
      { callId: 'web-run-1', input: 'await tools.web__run({ search_query: [{ q: "Codex" }] });' },
      { callId: 'update-plan-1', input: 'await tools.update_plan({ plan: [] });' },
      { callId: 'unknown-1', input: 'await tools.unknown_wrapper({ value: true });' },
    ];
    const transcriptLines = [
      JSON.stringify({ type: 'session_meta', payload: { id: providerSessionId, cwd: workspacePath } }),
    ];
    for (const call of wrappedCalls) {
      transcriptLines.push(
        JSON.stringify({
          type: 'response_item',
          payload: { type: 'custom_tool_call', name: 'exec', call_id: call.callId, input: call.input },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: { type: 'custom_tool_call_output', call_id: call.callId, output: `result:${call.callId}` },
        }),
      );
    }
    await writeFile(transcriptPath, `${transcriptLines.join('\n')}\n`, 'utf8');

    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-exec-1', 'codex', workspacePath);
      sessionsDb.assignProviderSessionId('app-exec-1', providerSessionId);
      await new CodexSessionSynchronizer().synchronize();

      const history = await new CodexSessionsProvider().fetchHistory('app-exec-1');
      const repeatedHistory = await new CodexSessionsProvider().fetchHistory('app-exec-1');
      const toolUses = history.messages.filter((message) => message.kind === 'tool_use');
      const toolResults = history.messages.filter((message) => message.kind === 'tool_result');
      const toolUsesById = new Map(toolUses.map((message) => [message.toolId, message]));
      const toolResultsById = new Map(toolResults.map((message) => [message.toolId, message]));

      assert.equal(toolUses.length, wrappedCalls.length);
      assert.equal(toolResults.length, wrappedCalls.length);
      assert.deepEqual(
        repeatedHistory.messages.map((message) => message.id),
        history.messages.map((message) => message.id),
      );
      for (const call of wrappedCalls) {
        const toolUse = toolUsesById.get(call.callId);
        assert.ok(toolUse);
        assert.equal(toolUse.toolName, call.expectedToolName || 'exec');
        assert.equal(toolUse.toolInput, call.expectedToolInput || call.input);
        assert.equal(toolUse.toolResult?.content, `result:${call.callId}`);
        assert.equal(toolResultsById.get(call.callId)?.content, `result:${call.callId}`);
      }
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex history keeps one live Bash row across a yielded exec command', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-yielded-exec-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const providerSessionId = 'codex-yielded-exec-1';
    const transcriptPath = await writeCodexTranscript(tempRoot, providerSessionId, workspacePath);
    const initialCallId = 'long-command-1';
    const continuationCallId = 'long-command-wait-1';
    const outerWaitCallId = 'long-command-outer-wait-1';
    const outputEnvelope = (result: { session_id?: number; exit_code?: number; output: string }) => ([
      { type: 'input_text', text: 'Script completed\nWall time 1.0 seconds\nOutput:\n' },
      { type: 'input_text', text: result.output },
      ...(result.session_id === undefined
        ? []
        : [{ type: 'input_text', text: `session_id=${result.session_id}` }]),
      ...(result.exit_code === undefined
        ? []
        : [{ type: 'input_text', text: `exit=${result.exit_code}` }]),
    ]);
    await appendFile(transcriptPath, [
      JSON.stringify({
        timestamp: '2026-08-29T04:00:00.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: initialCallId,
          input: 'const r = await tools.exec_command({cmd:"printf start\\n; sleep 30",yield_time_ms:1000}); text(JSON.stringify(r));',
        },
      }),
      JSON.stringify({
        timestamp: '2026-08-29T04:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: initialCallId,
          output: outputEnvelope({ session_id: 51532, output: 'start\n' }),
        },
      }),
    ].join('\n') + '\n');

    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-yielded-exec-1', 'codex', workspacePath);
      sessionsDb.assignProviderSessionId('app-yielded-exec-1', providerSessionId);
      await new CodexSessionSynchronizer().synchronize();

      const provider = new CodexSessionsProvider();
      const running = await provider.fetchHistory('app-yielded-exec-1');
      const runningUses = running.messages.filter((message) => message.kind === 'tool_use');
      assert.equal(runningUses.length, 1);
      assert.equal(runningUses[0]?.toolName, 'Bash');
      assert.equal(runningUses[0]?.toolResult, undefined);

      await appendFile(transcriptPath, [
        JSON.stringify({
          timestamp: '2026-08-29T04:00:30.000Z',
          type: 'response_item',
          payload: {
            type: 'custom_tool_call',
            name: 'exec',
            call_id: continuationCallId,
            input: 'const r = await tools.write_stdin({session_id:51532,chars:"",yield_time_ms:30000}); text(JSON.stringify(r));',
          },
        }),
        JSON.stringify({
          timestamp: '2026-08-29T04:00:30.100Z',
          type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: continuationCallId,
          output: [{
            type: 'input_text',
            text: 'Script running with cell ID 138\nWall time 11.0 seconds\nOutput:\n',
          }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-08-29T04:00:30.200Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: outerWaitCallId,
          input: 'const r = await tools.wait({cell_id:"138",yield_time_ms:30000}); text(r.output);',
        },
      }),
      JSON.stringify({
        timestamp: '2026-08-29T04:00:30.300Z',
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: outerWaitCallId,
          output: outputEnvelope({ exit_code: 0, output: 'end\n' }),
        },
      }),
      ].join('\n') + '\n');

      const completed = await provider.fetchHistory('app-yielded-exec-1');
      const completedUses = completed.messages.filter((message) => message.kind === 'tool_use');
      assert.equal(completedUses.length, 1);
      assert.equal(completedUses[0]?.id, runningUses[0]?.id);
      assert.equal(completedUses[0]?.toolResult?.content, 'start\nend\n');
      assert.equal(completed.messages.filter((message) => message.kind === 'tool_result').length, 1);
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
