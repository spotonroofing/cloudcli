// node --test scripts/macos/dispatch.test.cjs
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const scriptDir = __dirname;
const dispatch = path.join(scriptDir, 'dispatch');
const launcher = path.join(scriptDir, 'cloudcli-dev-start.sh');
const templatePath = path.join(scriptDir, 'phase-tail', 'v1.md');

function run(script, args, env = {}) {
  return spawnSync('/bin/zsh', [script, ...args], {
    cwd: path.resolve(scriptDir, '..', '..'),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function templateBlock(template, name) {
  const match = template.match(new RegExp(
    `<!-- phase-tail-${name}:start -->\\n([\\s\\S]*?)\\n<!-- phase-tail-${name}:end -->`,
  ));
  assert.ok(match, `missing ${name} template block`);
  return match[1];
}

test('dispatch assembles the phase headers and job paragraph with shared and engine tails', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-tail-'));
  try {
    const phase = path.join(directory, '01-job.md');
    const source = '<!-- engine: codex -->\n<!-- name: Small job -->\n<!-- tasks: one | two -->\n\nExecute Job 1 of PUNCHLIST_stub.md. Do the exact job paragraph.\n';
    fs.writeFileSync(phase, source);
    const values = {
      '{{JOURNAL_PATH}}': path.join(directory, 'JOURNAL.md'),
      '{{LESSONS_INDEX_PATH}}': path.join(directory, 'LESSONS.md'),
      '{{LESSONS_DIR}}': path.join(directory, 'memory', 'lessons'),
      '{{SUMMARY_PATH}}': path.join(directory, 'memory', 'sessions', 'summary.md'),
    };
    const template = fs.readFileSync(templatePath, 'utf8');

    for (const engine of ['codex', 'claude']) {
      const result = run(dispatch, [
        'assemble-phase', phase, engine, values['{{JOURNAL_PATH}}'],
        values['{{LESSONS_INDEX_PATH}}'], values['{{LESSONS_DIR}}'], values['{{SUMMARY_PATH}}'],
      ]);
      assert.equal(result.status, 0, result.stderr);
      let tail = `${templateBlock(template, 'shared')}\n\n${templateBlock(template, engine)}`;
      for (const [token, value] of Object.entries(values)) tail = tail.replaceAll(token, value);
      assert.equal(result.stdout, `${source.trimEnd()}\n\n${tail.trimEnd()}\n`);
      assert.ok(result.stdout.includes(templateBlock(template, engine)));
      assert.ok(!result.stdout.includes(templateBlock(template, engine === 'codex' ? 'claude' : 'codex')));
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('runner assembles only the fired prompt and snapshots lessons only on a fresh chain start', () => {
  const runner = fs.readFileSync(path.join(scriptDir, 'dispatch-chain-runner'), 'utf8');
  assert.match(runner, /if \[\[ \$RESUME_FROM -eq 1 && -z "\$\{DISPATCH_RESUMING:-\}" \]\]; then\n  if ! "\$SCRIPT_DIR\/dispatch" index-lessons "\$LESSONS_DIR" "\$LESSONS_INDEX"/);
  assert.match(runner, /"\$SCRIPT_DIR\/dispatch" assemble-phase "\$PHASE_FILE" "\$UNIT_ENGINE"/);
  assert.match(runner, /run_engine "\$UNIT_ENGINE" "\$ASSEMBLED_PHASE_FILE"/);
  assert.doesNotMatch(runner, /run_engine "\$UNIT_ENGINE" "\$PHASE_FILE"/);
});

test('inline-tail phases pass through byte for byte', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-inline-'));
  try {
    const phase = path.join(directory, 'inline.md');
    const source = '<!-- engine: codex -->\n<!-- tail: inline -->\n\nAlready compiled, including its tail.\n';
    fs.writeFileSync(phase, source);
    const result = run(dispatch, ['assemble-phase', phase, 'codex', '/journal', '/index', '/lessons', '/summary']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, source);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('chain-start lesson index has one sorted filename and first line per lesson file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-lessons-'));
  try {
    const lessons = path.join(directory, 'lessons');
    const output = path.join(directory, 'runtime', 'LESSONS.md');
    fs.mkdirSync(path.join(lessons, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(lessons, 'b.md'), 'Second summary\nbody\n');
    fs.writeFileSync(path.join(lessons, 'a.md'), 'First summary\nbody\n');
    const result = run(dispatch, ['index-lessons', lessons, output]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(output, 'utf8'), 'a.md | First summary\nb.md | Second summary\n');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('service launcher rotates a stub log at the configured size and keeps three archives', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcli-log-'));
  try {
    const log = path.join(directory, 'dev.out.log');
    fs.writeFileSync(log, 'current-log');
    fs.writeFileSync(`${log}.1`, 'archive-one');
    fs.writeFileSync(`${log}.2`, 'archive-two');
    fs.writeFileSync(`${log}.3`, 'archive-three');
    const result = run(launcher, ['--rotate-logs-only', directory, 'dev'], {
      CLOUDCLI_LOG_ROTATE_MAX_BYTES: '5',
      CLOUDCLI_LOG_ROTATE_KEEP: '3',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(log, 'utf8'), '');
    assert.equal(fs.readFileSync(`${log}.1`, 'utf8'), 'current-log');
    assert.equal(fs.readFileSync(`${log}.2`, 'utf8'), 'archive-one');
    assert.equal(fs.readFileSync(`${log}.3`, 'utf8'), 'archive-two');
    assert.ok(!fs.existsSync(`${log}.4`));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
