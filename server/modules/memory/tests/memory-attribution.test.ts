import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * Memory-write attribution (ui14 job 3): two sessions on one project write
 * memory at the same time — the planner through the Edit tool, the worker
 * through Bash (a heredoc and an append, the way workers actually write
 * lessons and summaries). Each memory-updated row must land only on the
 * session that wrote it, carrying an excerpt of the real file change.
 */

const PROJECT_PATH = '/workspace/demo';
const PLANNER_SESSION = 'planner-session';
const WORKER_SESSION = 'worker-session';

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

test('concurrent planner and worker memory writes land on their own sessions', async () => {
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
  const memory = await import('@/modules/memory/memory.service.js');

  closeConnection();
  await initializeDatabase();
  try {
    assert.equal(memory.PLANNER_MEMORY_ROOT, memoryRoot);
    projectsDb.createProjectPath(PROJECT_PATH);
    sessionsDb.createSession(PLANNER_SESSION, 'claude', PROJECT_PATH, 'Planner', undefined, undefined, null, 'planner');
    sessionsDb.createSession(WORKER_SESSION, 'claude', PROJECT_PATH, 'Worker', undefined, undefined, null, 'dispatch');

    await memory.snapshotMemoryFiles();

    const transcriptDir = path.join(claudeProjectsRoot, '-workspace-demo');
    await mkdir(transcriptDir, { recursive: true });
    const plannerTranscript = path.join(transcriptDir, `${PLANNER_SESSION}.jsonl`);
    const workerTranscript = path.join(transcriptDir, `${WORKER_SESSION}.jsonl`);

    // Planner: an Edit on PROJECT.md, confirmed by its result.
    const projectMd = path.join(projectMemory, 'PROJECT.md');
    await writeFile(projectMd, '# Demo\n\n- existing fact\n- planner added this\n');
    await writeFile(plannerTranscript, toolUse('t-edit', 'Edit', { file_path: projectMd, old_string: 'x', new_string: 'y' }) + toolResult('t-edit'));

    // Worker: a heredoc through a shell variable (no full path spelled out)
    // and an append naming the file, both confirmed.
    const lessonPath = path.join(projectMemory, 'lessons', 'new-lesson.md');
    const summaryPath = path.join(projectMemory, 'sessions', 'summary.md');
    await writeFile(lessonPath, 'A worker lesson.\n');
    await appendFile(summaryPath, '\n## Job 2\n\n- worker appended this\n');
    await writeFile(
      workerTranscript,
      toolUse('t-bash-1', 'Bash', { command: `L=${path.join(projectMemory, 'lessons')}; cat > $L/new-lesson.md <<'EOF'\nA worker lesson.\nEOF` })
        + toolResult('t-bash-1')
        + toolUse('t-bash-2', 'Bash', { command: `cat >> ${summaryPath} <<'EOF'\n## Job 2\n- worker appended this\nEOF` })
        + toolResult('t-bash-2'),
    );

    await Promise.all([
      memory.handleSessionTranscriptEvent(claudeProjectsRoot, plannerTranscript, PLANNER_SESSION),
      memory.handleSessionTranscriptEvent(claudeProjectsRoot, workerTranscript, WORKER_SESSION),
    ]);

    // The planner-repo watcher sees every changed file, in any order.
    memory.handlePlannerRepoFileEvent(summaryPath);
    memory.handlePlannerRepoFileEvent(lessonPath);
    memory.handlePlannerRepoFileEvent(projectMd);

    await sleep(3_200);

    const plannerRows = memoryUpdatesDb.listBySession(PLANNER_SESSION);
    const workerRows = memoryUpdatesDb.listBySession(WORKER_SESSION);
    assert.equal(plannerRows.length, 1);
    assert.equal(workerRows.length, 1);
    assert.deepEqual(JSON.parse(plannerRows[0].files_json), ['PROJECT.md']);
    assert.deepEqual(JSON.parse(workerRows[0].files_json), ['lessons/new-lesson.md', 'sessions/summary.md']);
    assert.ok((plannerRows[0].duration_ms ?? 0) >= 2_400);
    assert.ok((workerRows[0].duration_ms ?? 0) >= 2_400);

    const plannerDiffs = JSON.parse(plannerRows[0].diffs_json ?? '{}') as Record<string, string[]>;
    const workerDiffs = JSON.parse(workerRows[0].diffs_json ?? '{}') as Record<string, string[]>;
    assert.deepEqual(plannerDiffs['PROJECT.md'], ['+ - planner added this']);
    assert.deepEqual(workerDiffs['sessions/summary.md'], ['+ ## Job 2', '+ - worker appended this']);
    // A new file's lines are its added lines.
    assert.deepEqual(workerDiffs['lessons/new-lesson.md'], ['+ A worker lesson.']);

    // A further write to the same file inside the claim window is a new
    // change, not the watcher echoing the first one: it reports again.
    await appendFile(lessonPath, 'A second worker line.\n');
    memory.handlePlannerRepoFileEvent(lessonPath);
    await sleep(3_200);
    const workerRowsAfter = memoryUpdatesDb.listBySession(WORKER_SESSION);
    assert.equal(workerRowsAfter.length, 2);
    assert.deepEqual(JSON.parse(workerRowsAfter[1].files_json), ['lessons/new-lesson.md']);
    assert.deepEqual(
      (JSON.parse(workerRowsAfter[1].diffs_json ?? '{}') as Record<string, string[]>)['lessons/new-lesson.md'],
      ['+ A second worker line.'],
    );
    assert.equal(memoryUpdatesDb.listBySession(PLANNER_SESSION).length, 1);
  } finally {
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
