import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * Memory-write attribution (ui16 job 3): Claude and Codex workers plus the
 * planner write memory at the same time through their native transcript
 * command shapes. Persisted and live rows must land only on their writer.
 */

const PROJECT_PATH = '/workspace/demo';
const PLANNER_SESSION = 'planner-session';
const CLAUDE_WORKER_SESSION = 'claude-worker-session';
const CODEX_WORKER_SESSION = 'codex-worker-session';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function transcriptLine(entry: Record<string, unknown>): string {
  return `${JSON.stringify({ sessionId: 'x', cwd: PROJECT_PATH, timestamp: new Date().toISOString(), ...entry })}\n`;
}

function toolUse(id: string, name: string, input: Record<string, unknown>): string {
  return transcriptLine({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
}

function toolResult(id: string, isError = false): string {
  return transcriptLine({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: isError }] },
  });
}

function codexCommand(command: string): string {
  const classic = JSON.stringify({
    timestamp: new Date().toISOString(),
    type: 'response_item',
    payload: {
      type: 'function_call',
      name: 'shell_command',
      arguments: JSON.stringify({ command }),
      call_id: 'codex-shell-1',
    },
  });
  const current = JSON.stringify({
    timestamp: new Date().toISOString(),
    type: 'response_item',
    payload: {
      type: 'custom_tool_call',
      name: 'exec',
      input: `const result = await tools.exec_command({ "cmd": ${JSON.stringify(command)} }); text(result.output);`,
      call_id: 'codex-exec-1',
    },
  });
  return `${classic}\n${current}\n`;
}

class FakeConnection {
  readyState = 1;
  frames: Array<Record<string, unknown>> = [];

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }
}

test('Claude, Codex, and planner memory writes land live and persisted on their own sessions', async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'memory-attribution-'));
  const memoryRoot = path.join(tempDirectory, 'planner');
  const claudeProjectsRoot = path.join(tempDirectory, 'claude', 'projects');
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousMemoryRoot = process.env.PLANNER_MEMORY_ROOT;
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  process.env.PLANNER_MEMORY_ROOT = memoryRoot;

  const projectMemory = path.join(memoryRoot, 'demo');
  await mkdir(path.join(projectMemory, 'lessons'), { recursive: true });
  await mkdir(path.join(projectMemory, 'sessions'), { recursive: true });
  await mkdir(path.join(memoryRoot, '_global'), { recursive: true });
  await writeFile(path.join(projectMemory, 'PROJECT.md'), '# Demo\n\n- existing fact\n');
  await writeFile(path.join(projectMemory, 'sessions', 'summary.md'), '# Summary\n\n- job 1 done\n');

  const { closeConnection, initializeDatabase, memoryUpdatesDb, projectsDb, sessionsDb } = await import('@/modules/database/index.js');
  const { chatRunRegistry, connectedClients } = await import('@/modules/websocket/index.js');
  const memory = await import('@/modules/memory/memory.service.js');

  closeConnection();
  await initializeDatabase();
  try {
    assert.equal(memory.PLANNER_MEMORY_ROOT, memoryRoot);
    projectsDb.createProjectPath(PROJECT_PATH);
    sessionsDb.createSession(PLANNER_SESSION, 'claude', PROJECT_PATH, 'Planner', undefined, undefined, null, 'planner');
    sessionsDb.createSession(CLAUDE_WORKER_SESSION, 'claude', PROJECT_PATH, 'Claude worker', undefined, undefined, null, 'dispatch');
    sessionsDb.createSession(CODEX_WORKER_SESSION, 'codex', PROJECT_PATH, 'Codex worker', undefined, undefined, null, 'direct');

    const live = new FakeConnection();
    connectedClients.add(live as never);

    await memory.snapshotMemoryFiles();

    const transcriptDir = path.join(claudeProjectsRoot, '-workspace-demo');
    await mkdir(transcriptDir, { recursive: true });
    const plannerTranscript = path.join(transcriptDir, `${PLANNER_SESSION}.jsonl`);
    const workerTranscript = path.join(transcriptDir, `${CLAUDE_WORKER_SESSION}.jsonl`);
    const codexRollout = path.join(tempDirectory, `${CODEX_WORKER_SESSION}.jsonl`);

    // Planner: a Write-tool edit on PROJECT.md, confirmed by its result.
    const projectMd = path.join(projectMemory, 'PROJECT.md');
    await writeFile(projectMd, '# Demo\n\n- existing fact\n- planner added this\n');
    await writeFile(plannerTranscript, toolUse('t-write', 'Write', { file_path: projectMd, content: 'updated' }) + toolResult('t-write'));

    // Claude worker: a Bash append, confirmed by its tool result.
    const lessonPath = path.join(projectMemory, 'lessons', 'new-lesson.md');
    const summaryPath = path.join(projectMemory, 'sessions', 'summary.md');
    await writeFile(lessonPath, 'A worker lesson.\n');
    await appendFile(summaryPath, '\n## Job 2\n\n- worker appended this\n');
    await writeFile(
      workerTranscript,
      toolUse('t-bash', 'Bash', { command: `cat >> ${summaryPath} <<'EOF'\n## Job 2\n- worker appended this\nEOF` })
        + toolResult('t-bash'),
    );

    // Codex worker: the shell-command rollout item contains a heredoc write.
    await writeFile(codexRollout, codexCommand(`cat > ${lessonPath} <<'EOF'\nA worker lesson.\nEOF`));

    await Promise.all([
      memory.handleSessionTranscriptEvent('claude', claudeProjectsRoot, plannerTranscript, PLANNER_SESSION),
      memory.handleSessionTranscriptEvent('claude', claudeProjectsRoot, workerTranscript, CLAUDE_WORKER_SESSION),
      memory.handleSessionTranscriptEvent('codex', tempDirectory, codexRollout, CODEX_WORKER_SESSION),
    ]);

    // The planner-repo watcher sees every changed file, in any order.
    memory.handlePlannerRepoFileEvent(summaryPath);
    memory.handlePlannerRepoFileEvent(lessonPath);
    memory.handlePlannerRepoFileEvent(projectMd);

    await sleep(3_200);

    const plannerRows = memoryUpdatesDb.listBySession(PLANNER_SESSION);
    const claudeWorkerRows = memoryUpdatesDb.listBySession(CLAUDE_WORKER_SESSION);
    const codexWorkerRows = memoryUpdatesDb.listBySession(CODEX_WORKER_SESSION);
    assert.equal(plannerRows.length, 1);
    assert.equal(claudeWorkerRows.length, 1);
    assert.equal(codexWorkerRows.length, 1);
    assert.deepEqual(JSON.parse(plannerRows[0].files_json), ['PROJECT.md']);
    assert.deepEqual(JSON.parse(claudeWorkerRows[0].files_json), ['sessions/summary.md']);
    assert.deepEqual(JSON.parse(codexWorkerRows[0].files_json), ['lessons/new-lesson.md']);
    assert.ok((plannerRows[0].duration_ms ?? 0) >= 2_400);
    assert.ok((claudeWorkerRows[0].duration_ms ?? 0) >= 2_400);
    assert.ok((codexWorkerRows[0].duration_ms ?? 0) >= 2_400);

    const plannerDiffs = JSON.parse(plannerRows[0].diffs_json ?? '{}') as Record<string, string[]>;
    const claudeWorkerDiffs = JSON.parse(claudeWorkerRows[0].diffs_json ?? '{}') as Record<string, string[]>;
    const codexWorkerDiffs = JSON.parse(codexWorkerRows[0].diffs_json ?? '{}') as Record<string, string[]>;
    assert.deepEqual(plannerDiffs['PROJECT.md'], ['+ - planner added this']);
    assert.deepEqual(claudeWorkerDiffs['sessions/summary.md'], ['+ ## Job 2', '+ - worker appended this']);
    // A new file's lines are its added lines.
    assert.deepEqual(codexWorkerDiffs['lessons/new-lesson.md'], ['+ A worker lesson.']);

    const liveMemoryRows = live.frames.filter((frame) => frame.kind === 'memory_update');
    assert.deepEqual(
      liveMemoryRows.map((frame) => [frame.sessionId, frame.memoryFiles]).sort(),
      [
        [CLAUDE_WORKER_SESSION, ['sessions/summary.md']],
        [CODEX_WORKER_SESSION, ['lessons/new-lesson.md']],
        [PLANNER_SESSION, ['PROJECT.md']],
      ].sort(),
    );

    // A further write to the same file inside the claim window is a new
    // change, not the watcher echoing the first one: it reports again.
    await appendFile(lessonPath, 'A second worker line.\n');
    memory.handlePlannerRepoFileEvent(lessonPath);
    await sleep(3_200);
    const codexRowsAfter = memoryUpdatesDb.listBySession(CODEX_WORKER_SESSION);
    assert.equal(codexRowsAfter.length, 2);
    assert.deepEqual(JSON.parse(codexRowsAfter[1].files_json), ['lessons/new-lesson.md']);
    assert.deepEqual(
      (JSON.parse(codexRowsAfter[1].diffs_json ?? '{}') as Record<string, string[]>)['lessons/new-lesson.md'],
      ['+ A second worker line.'],
    );
    assert.equal(memoryUpdatesDb.listBySession(PLANNER_SESSION).length, 1);
    // Both headless workers were just observed by their transcript watchers,
    // so the unclaimed path refuses to guess between them.
    assert.equal(memory.pickSoleRunningWorkerSession(PROJECT_PATH), null);

    const plannerRun = chatRunRegistry.startRun({
      appSessionId: PLANNER_SESSION,
      provider: 'claude',
      providerSessionId: null,
      userId: null,
    });
    const codexRun = chatRunRegistry.startRun({
      appSessionId: CODEX_WORKER_SESSION,
      provider: 'codex',
      providerSessionId: null,
      userId: null,
    });
    assert.ok(plannerRun);
    assert.ok(codexRun);
    assert.equal(memory.pickSoleRunningWorkerSession(PROJECT_PATH, Date.now() + 31_000), CODEX_WORKER_SESSION);

    const claudeRun = chatRunRegistry.startRun({
      appSessionId: CLAUDE_WORKER_SESSION,
      provider: 'claude',
      providerSessionId: null,
      userId: null,
    });
    assert.ok(claudeRun);
    assert.equal(memory.pickSoleRunningWorkerSession(PROJECT_PATH), null);
    chatRunRegistry.completeRun(CODEX_WORKER_SESSION, { exitCode: 0 });
    assert.equal(memory.pickSoleRunningWorkerSession(PROJECT_PATH), CLAUDE_WORKER_SESSION);
    chatRunRegistry.completeRun(CLAUDE_WORKER_SESSION, { exitCode: 0 });
    assert.equal(memory.pickSoleRunningWorkerSession(PROJECT_PATH), null);
  } finally {
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousMemoryRoot === undefined) delete process.env.PLANNER_MEMORY_ROOT;
    else process.env.PLANNER_MEMORY_ROOT = previousMemoryRoot;
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('diffExcerpt lists added then removed lines and caps the excerpt', async () => {
  const { diffExcerpt } = await import('@/modules/memory/memory.service.js');
  assert.deepEqual(diffExcerpt('a\nb\n', 'a\nc\n'), ['+ c', '- b']);
  assert.deepEqual(diffExcerpt('', 'one\n\ntwo\n'), ['+ one', '+ two']);
  const many = diffExcerpt('', Array.from({ length: 10 }, (_, index) => `line ${index}`).join('\n'));
  assert.equal(many.length, 6);
  assert.equal(many[5], '5 more lines');
});

test('the Claude.ai export import skips when the file is absent and renames it when present', async () => {
  const { importClaudeAiExportIfPresent } = await import('@/modules/memory/memory.service.js');
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'memory-import-'));
  try {
    const calls: string[] = [];
    const runEdit = async (instruction: string) => {
      calls.push(instruction);
      return { content: '', changed: true };
    };
    assert.equal(await importClaudeAiExportIfPresent(tempDirectory, runEdit), false);
    assert.equal(calls.length, 0);

    await writeFile(path.join(tempDirectory, 'claude-ai-memory-export.md'), '- Willem likes plain language\n');
    assert.equal(await importClaudeAiExportIfPresent(tempDirectory, runEdit), true);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /claude-ai-memory-export\.imported/);
    const { existsSync } = await import('node:fs');
    assert.equal(existsSync(path.join(tempDirectory, 'claude-ai-memory-export.md')), false);
    assert.equal(existsSync(path.join(tempDirectory, 'claude-ai-memory-export.imported')), true);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
