// node --test scripts/macos/tool-guard.test.cjs
// Commands that must block and commands that must pass through the guard.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

const { findViolation, commandFrom } = require('./tool-guard.cjs');

const HOME = os.homedir();
// The repo this test lives in stands in for "the current project".
const PROJECT = path.resolve(__dirname, '..', '..');

const MUST_BLOCK = [
  // destructive git set
  'git push --force origin main',
  'git push -f',
  'git push --force-with-lease origin main',
  'git -C /Users/x/repo push --force',
  'git reset --hard HEAD~1',
  'git clean -fd',
  'git clean -n',
  'git clean',
  'git branch -D feature',
  'git branch --delete --force feature',
  'git checkout .',
  'git restore .',
  'npm test && git push --force',
  // recursive force delete in any flag order or form, with or without sudo
  'rm -rf build',
  'rm -fr build',
  'rm -Rf build',
  'rm -r -f build',
  'rm -f -r build',
  'rm --recursive --force build',
  'rm --force --recursive build',
  'rm -rfv build',
  'sudo rm -rf build',
  'sudo -E rm -r -f build',
  'ls; rm -rf build',
  'bash -c "rm -rf build"',
  'zsh -lc \'rm -rf build\'',
  // recursive force deletes block everywhere, allowed roots included
  'rm -rf /tmp/scratch',
  'rm -rf /private/tmp/scratch',
  `rm -rf ${HOME}/forge-logs/stub`,
  // find with -delete or an exec of remove
  'find . -name "*.log" -delete',
  'find /tmp/x -type f -exec rm {} \\;',
  'find . -execdir rm -f {} +',
  // SQL drops in shell-invoked SQL
  'psql -c "DROP TABLE sessions"',
  'sqlite3 auth.db "drop database x"',
  'sqlite3 auth.db <<SQL\nDROP TABLE sessions;\nSQL',
  // writes, moves, deletes outside the project and the allowed roots
  `rm ${HOME}/Documents/notes.txt`,
  `rm -f ${HOME}/.codex/config.toml`,
  `mv ${PROJECT}/README.md ${HOME}/Desktop/README.md`,
  `mv ${HOME}/Desktop/a.txt ${PROJECT}/a.txt`,
  `cp README.md ${HOME}/Desktop/`,
  `cp -r dist ${HOME}/Sites/app`,
  `echo hi > ${HOME}/.zshrc`,
  `cat x >> ${HOME}/.claude/settings.json`,
  `echo hi >${HOME}/.zshrc`,
  `echo hi 2> ${HOME}/err.log`,
  `echo hi &> ${HOME}/all.log`,
  'echo hi > ~/.zshrc',
  'echo hi > $HOME/.zshrc',
  `tee ${HOME}/.ssh/config < x`,
  `tee -a ${HOME}/.ssh/config`,
  `rmdir ${HOME}/Library/Foo`,
  'rm ../outside.txt',
  `rm /Users/other/Projects/repo/file.txt`,
  `ls && echo x > ${HOME}/Downloads/x.txt`,
];

const MUST_PASS = [
  // ordinary git
  'git push origin main',
  'git push -u origin feature',
  'git reset --soft HEAD~1',
  'git reset HEAD file.txt',
  'git branch -d feature',
  'git branch -m old new',
  'git checkout -- file.txt',
  'git restore src/app.ts',
  'git checkout main',
  'git log --oneline -5',
  'git status && git diff',
  'git commit -m "clean up the force of habit"',
  'echo "git push --force" > NOTES.md',
  // rm without both flags, or inside allowed roots
  'rm build/out.js',
  'rm -f build/out.js',
  'rm -r build',
  'rm -rf-ish',
  'rm -r /tmp/scratch',
  `rm -f ${HOME}/forge-logs/stub/JOURNAL.md`,
  // find without a delete
  'find . -name "*.ts" -exec grep -l foo {} +',
  'find . -type f -name "*.log"',
  // SQL that only reads or drops nothing
  'sqlite3 auth.db "select * from sessions"',
  'psql -c "DROP INDEX idx_sessions"',
  // writes inside the project and the allowed roots
  'echo hi > notes.txt',
  `echo hi > ${PROJECT}/notes.txt`,
  'echo hi >> server/index.ts',
  'echo hi > /tmp/out.txt',
  `echo hi >> ${HOME}/forge-logs/codexint/JOURNAL.md`,
  `cat x > ${HOME}/Projects/spoton-worker/planner/cloudcli/lessons/a.md`,
  'ls > /dev/null 2>&1',
  'npm run build 2>&1 | tail -5',
  'mv src/a.ts src/b.ts',
  `cp ${HOME}/Desktop/a.txt ./a.txt`,
  'cp -r src /tmp/src-copy',
  'tee /tmp/log.txt',
  'echo "$FOO" > $OUT/file',
  // reads outside the project are fine
  `cat ${HOME}/.codex/config.toml`,
  `ls -la ${HOME}/Downloads`,
  `grep -r foo ${HOME}/Projects/other`,
  'cd /Users/other/repo && git status',
  'curl -s https://example.com -o /tmp/page.html',
  // quoted scripts and regexes never split into segments or read as redirections
  'node -e "const f = (t) => t; console.log(\'a|b\')"',
  'agent-browser eval "[...document.querySelectorAll(\'li\')].filter(t=>/worker|jobs/i.test(t.textContent))"',
  'grep -E "foo|bar" src/app.ts',
  "echo 'a > b; c && d' | cat",
];

test('commands that must block', () => {
  for (const command of MUST_BLOCK) {
    assert.ok(findViolation(command, PROJECT), `expected block: ${command}`);
  }
});

test('commands that must pass', () => {
  for (const command of MUST_PASS) {
    const hit = findViolation(command, PROJECT);
    assert.equal(hit, null, `expected pass: ${command} (blocked as ${hit && hit.name})`);
  }
});

test('project root is the nearest .git ancestor of cwd', () => {
  assert.equal(findViolation(`echo hi > ${PROJECT}/notes.txt`, path.join(PROJECT, 'server')), null);
});

test('command is read from either engine input shape', () => {
  assert.equal(commandFrom({ tool_name: 'Bash', tool_input: { command: 'ls' } }), 'ls');
  assert.equal(commandFrom({ tool_name: 'Bash', tool_input: { cmd: 'ls' } }), 'ls');
  assert.equal(commandFrom({ tool_input: { command: ['bash', '-lc', 'rm -rf build'] } }), 'bash -lc \'rm -rf build\'');
  assert.ok(findViolation(commandFrom({ tool_input: { command: ['bash', '-lc', 'rm -rf build'] } }), PROJECT));
  assert.equal(commandFrom({ tool_input: {} }), null);
  assert.equal(commandFrom(null), null);
});
