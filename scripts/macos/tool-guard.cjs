#!/usr/bin/env node
// tool-guard.cjs — the one destructive-command guard both engines call before
// a shell tool runs (codex job 2). Claude Code calls it from the PreToolUse
// hook on Bash (user settings.json, via the synced copy at
// ~/.claude/hooks/git-guard.js that install.sh refreshes); Codex calls it from
// the pre_tool_use hook in ~/.codex/hooks.json. Both read the same stdin JSON
// shape ({tool_name, tool_input, cwd}) and accept the same deny output.
//
// Only ever denies on a positive match; on any unexpected input it exits 0 so
// a broken guard cannot block normal work. Shell chains are split and each
// segment is checked on its own, so flags match their own command.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();

// A git subcommand may be preceded by git's own options (git -C x push, git --no-pager push).
const GIT_PRE = '\\bgit\\s+(?:(?:-C|-c)\\s+\\S+\\s+|--?[\\w-]+(?:=\\S+)?\\s+)*';

const GIT_RULES = [
  { name: 'git push --force / -f / --force-with-lease',
    sub: 'push',
    flag: /(^|\s)(--force(-with-lease|-if-includes)?(=\S+)?|-[A-Za-z]*f[A-Za-z]*)(\s|$)/ },
  { name: 'git reset --hard',
    sub: 'reset',
    flag: /(^|\s)--hard(\s|$)/ },
  { name: 'git clean',
    sub: 'clean',
    flag: /(?:)/ },
  { name: 'git branch -D / --delete --force',
    sub: 'branch',
    flag: /(^|\s)(-[A-Za-z]*D[A-Za-z]*|--delete\s+--force|--force\s+--delete)(\s|$)/ },
  { name: 'unpathed git checkout . / git restore .',
    sub: '(?:checkout|restore)',
    flag: /\s\.(\s|$)/ },
];

// Roots an agent may write to, move within, or delete under besides the
// current project. Everything else is off limits for those three verbs.
function allowedRoots(projectRoot) {
  return [
    projectRoot,
    path.join(HOME, 'Projects', 'spoton-worker'),
    path.join(HOME, 'forge-logs'),
    '/tmp',
    '/private/tmp',
    '/dev/null',
    '/dev/stdout',
    '/dev/stderr',
  ].filter(Boolean);
}

// The project is the nearest ancestor of the hook's cwd that holds a .git
// entry, so a session started in a subfolder can still write the whole repo.
function projectRootFor(cwd) {
  if (!cwd) return null;
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(cwd);
    dir = parent;
  }
}

// Splits a shell line into words, honoring quotes and backslashes, and keeps
// redirection operators as their own words so `>file` and `> file` read alike.
function shellWords(text) {
  const words = [];
  let cur = '';
  let quote = null;
  let has = false;
  const push = () => { if (has) { words.push(cur); } cur = ''; has = false; };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) { quote = null; continue; }
      if (ch === '\\' && quote === '"' && i + 1 < text.length) { cur += text[i + 1]; i += 1; continue; }
      cur += ch; has = true;
      continue;
    }
    if (ch === '\'' || ch === '"') { quote = ch; has = true; continue; }
    if (ch === '\\' && i + 1 < text.length) { cur += text[i + 1]; has = true; i += 1; continue; }
    if (/\s/.test(ch)) { push(); continue; }
    if (ch === '>' || ch === '<') {
      // Redirection operator: split off from what precedes and follows it,
      // keeping fd prefixes (2>, &>) and doubled forms (>>) attached.
      const before = cur;
      if (/^[0-9]$/.test(before) || before === '&') { cur = before; } else { push(); }
      cur += ch; has = true;
      if (ch === '>' && text[i + 1] === '>') { cur += '>'; i += 1; }
      if (text[i + 1] === '&') { cur += '&'; i += 1; }
      push();
      continue;
    }
    cur += ch; has = true;
  }
  push();
  return words;
}

// Segments of a shell line: one command each, split at the chain operators
// (||, &&, ;, |, &, newline) that sit outside quotes, so a quoted script or
// regex never splits a command in two.
function segments(command) {
  const text = String(command);
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && quote === '"' && i + 1 < text.length) { cur += text[i + 1]; i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\' && i + 1 < text.length) { cur += ch + text[i + 1]; i += 1; continue; }
    if (ch === '\'' || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === '\n' || ch === ';') { out.push(cur); cur = ''; continue; }
    if (ch === '|' || ch === '&') {
      if (text[i + 1] === ch) i += 1;
      else if (ch === '&' && text[i + 1] === '>') { cur += ch; continue; }
      else if (ch === '&' && cur.endsWith('>')) { cur += ch; continue; }
      out.push(cur); cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

// Drops leading wrappers (sudo and its flags, env and its assignments, command,
// exec, nohup, time) so `sudo rm -rf x` and `rm -rf x` see the same words.
function stripWrappers(words) {
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (w === 'sudo') {
      i += 1;
      while (i < words.length && words[i].startsWith('-')) {
        // sudo flags that take a value
        if (/^-(u|g|p|C|D|h|r|t|T|U)$/.test(words[i])) i += 1;
        i += 1;
      }
      continue;
    }
    if (w === 'env') {
      i += 1;
      while (i < words.length && (words[i].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]))) i += 1;
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || w === 'command' || w === 'exec' || w === 'nohup' || w === 'time' || w === 'builtin') {
      i += 1;
      continue;
    }
    break;
  }
  return words.slice(i);
}

function isRecursiveForceRm(words) {
  if (words[0] !== 'rm') return false;
  let recursive = false;
  let force = false;
  for (const w of words.slice(1)) {
    if (w === '--') break;
    if (w === '--recursive') recursive = true;
    else if (w === '--force') force = true;
    else if (/^-[A-Za-z]+$/.test(w)) {
      if (/[rR]/.test(w)) recursive = true;
      if (/f/.test(w)) force = true;
    }
  }
  return recursive && force;
}

function isFindDelete(words) {
  if (words[0] !== 'find') return false;
  for (let i = 1; i < words.length; i += 1) {
    if (words[i] === '-delete') return true;
    if ((words[i] === '-exec' || words[i] === '-execdir' || words[i] === '-ok' || words[i] === '-okdir')
      && stripWrappers(words.slice(i + 1))[0] === 'rm') return true;
  }
  return false;
}

// Absolute path for a target word, or null when it cannot be known (an
// unexpanded variable or a bare option).
function resolveTarget(word, cwd) {
  let w = word;
  if (w.startsWith('~/') || w === '~') w = path.join(HOME, w.slice(1));
  w = w.replace(/^\$\{?HOME\}?(?=\/|$)/, HOME);
  if (w.includes('$')) return null;
  if (!w) return null;
  const abs = path.isAbsolute(w) ? path.normalize(w) : path.resolve(cwd || process.cwd(), w);
  return abs.replace(/^\/private\/tmp(?=\/|$)/, '/tmp');
}

function isUnderAny(target, roots) {
  return roots.some((root) => {
    const r = path.normalize(root).replace(/^\/private\/tmp(?=\/|$)/, '/tmp');
    return target === r || target.startsWith(r.endsWith('/') ? r : `${r}/`);
  });
}

// Target paths a segment writes, moves, or deletes: the operands of rm, rmdir,
// unlink, mv, cp (its destination), tee, and every redirection target.
function writeTargets(words) {
  const targets = [];
  const cmd = words[0];
  const operands = (list) => {
    const out = [];
    let endOfFlags = false;
    for (const w of list) {
      if (!endOfFlags && w === '--') { endOfFlags = true; continue; }
      if (!endOfFlags && w.startsWith('-') && w !== '-') continue;
      if (/^(?:[0-9]?>>?&?|&>>?|<)$/.test(w)) break;
      out.push(w);
    }
    return out;
  };
  if (cmd === 'rm' || cmd === 'rmdir' || cmd === 'unlink' || cmd === 'mv' || cmd === 'tee') {
    targets.push(...operands(words.slice(1)));
  } else if (cmd === 'cp') {
    const ops = operands(words.slice(1));
    if (ops.length) targets.push(ops[ops.length - 1]);
  }
  for (let i = 0; i < words.length; i += 1) {
    if (/^(?:[0-9]?>>?|&>>?)$/.test(words[i]) && i + 1 < words.length) targets.push(words[i + 1]);
  }
  return targets;
}

function outsideProjectTarget(words, cwd, roots) {
  for (const word of writeTargets(words)) {
    const target = resolveTarget(word, cwd);
    if (target && !isUnderAny(target, roots)) return target;
  }
  return null;
}

// Nested shell strings (`bash -c "..."`, `zsh -lc '...'`) are checked as
// their own command lines.
function nestedShell(words) {
  if (!/^(?:sh|bash|zsh|dash|ksh)$/.test(path.basename(words[0] || ''))) return null;
  for (let i = 1; i < words.length; i += 1) {
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(words[i]) && i + 1 < words.length) return words[i + 1];
  }
  return null;
}

function findViolation(command, cwd) {
  const text = String(command);
  if (/\bDROP\s+(?:TABLE|DATABASE)\b/i.test(text)) {
    return { name: 'DROP TABLE / DROP DATABASE' };
  }
  const projectRoot = projectRootFor(cwd);
  const roots = allowedRoots(projectRoot);
  for (const seg of segments(text)) {
    for (const rule of GIT_RULES) {
      if (new RegExp(GIT_PRE + rule.sub + '\\b').test(seg) && rule.flag.test(seg)) return rule;
    }
    const words = stripWrappers(shellWords(seg));
    if (!words.length) continue;
    const inner = nestedShell(words);
    if (inner) {
      const hit = findViolation(inner, cwd);
      if (hit) return hit;
    }
    if (isRecursiveForceRm(words)) return { name: 'rm with recursive and force flags' };
    if (isFindDelete(words)) return { name: 'find -delete / find -exec rm' };
    const outside = outsideProjectTarget(words, cwd, roots);
    if (outside) {
      return { name: `a write, move, or delete outside the project (${outside})` };
    }
  }
  return null;
}

// The shell command out of either engine's tool input: Claude's Bash sends
// {command}, Codex's shell tools send {command} or {cmd}, string or argv.
function commandFrom(input) {
  const toolInput = input && typeof input === 'object' ? input.tool_input : null;
  if (!toolInput || typeof toolInput !== 'object') return null;
  const raw = typeof toolInput.command !== 'undefined' ? toolInput.command : toolInput.cmd;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw.every((w) => typeof w === 'string')) {
    return raw.map((w) => (/[\s"'$]/.test(w) ? `'${w.replace(/'/g, '\'\\\'\'')}'` : w)).join(' ');
  }
  return null;
}

module.exports = { findViolation, commandFrom, shellWords, segments };

if (require.main === module) {
  let raw = '';
  process.stdin.on('data', (d) => { raw += d; });
  process.stdin.on('end', () => {
    let input;
    try { input = JSON.parse(raw); } catch (e) { process.exit(0); }
    const command = commandFrom(input);
    if (typeof command !== 'string') process.exit(0);
    const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();

    const hit = findViolation(command, cwd);
    if (!hit) process.exit(0);

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `This command is not permitted: ${hit.name} is blocked by the tool guard (scripts/macos/tool-guard.cjs).`,
      },
    }) + '\n');
    process.exit(0);
  });
}
