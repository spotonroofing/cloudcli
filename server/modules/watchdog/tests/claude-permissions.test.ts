import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const runnerPath = path.resolve('scripts/macos/dispatch-chain-runner');

test('Claude chain stages use acceptEdits with an unattended tool allowlist', async () => {
  const runner = await readFile(runnerPath, 'utf8');

  assert.match(runner, /CLAUDE_PERMISSION_MODE="acceptEdits"/);
  assert.match(
    runner,
    /CLAUDE_ALLOWED_TOOLS="Bash,WebFetch,WebSearch,Agent,Skill,ToolSearch,Monitor,TaskOutput,Read,Edit,Write,Glob,Grep,NotebookEdit,TaskCreate,TaskUpdate,TaskList,TaskGet"/,
  );
  assert.match(runner, /--permission-mode "\$CLAUDE_PERMISSION_MODE"/);
  assert.match(runner, /--allowedTools "\$CLAUDE_ALLOWED_TOOLS"/);
  assert.doesNotMatch(runner, /--dangerously-skip-permissions/);
  assert.match(
    runner,
    /PERMISSION_JOURNAL=", permission \$CLAUDE_PERMISSION_MODE"/,
  );
  assert.match(
    runner,
    /permission_detail=", permission \$CLAUDE_PERMISSION_MODE"/,
  );
});
