import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSessionTitleFromMessage, normalizeSessionName } from '@/shared/utils.js';

import { isCommentShapedTitle, stripHeaderComments, titleFromPrompt } from '../../../shared/sessionTitle.js';

const PROMPT_FILE = `<!-- verify: no -->
<!-- browser -->
<!-- name: Jobs view truth -->
<!-- tasks: Beam lights for running workers | Titles from the name header -->
Execute Job 5 of PUNCHLIST_codex.md in this repo (jobs view truth).`;

test('a prompt file is titled by its name header, never by the raw prompt text', () => {
  assert.equal(titleFromPrompt(PROMPT_FILE), 'Jobs view truth');
  assert.equal(buildSessionTitleFromMessage(PROMPT_FILE), 'Jobs view truth');
  assert.equal(normalizeSessionName(PROMPT_FILE, 'Untitled Claude Session'), 'Jobs view truth');
});

test('a verify prompt titles as "Verify: <name>"', () => {
  const verify = `<!-- name: Verify: Jobs view truth -->\nYou are the fresh-context verifier for job 5 of 5.`;
  assert.equal(buildSessionTitleFromMessage(verify), 'Verify: Jobs view truth');
  assert.equal(normalizeSessionName(verify, 'x'), 'Verify: Jobs view truth');
});

test('header comments are stripped from titles that have no name header', () => {
  const text = '<!-- verify: no -->\n<!-- browser -->\nExecute Job 2 of PUNCHLIST_ui15.md now please';
  assert.equal(stripHeaderComments(text), 'Execute Job 2 of PUNCHLIST_ui15.md now please');
  assert.equal(buildSessionTitleFromMessage(text), 'Execute Job 2 of');
  assert.equal(normalizeSessionName(text, 'x'), 'Execute Job 2 of PUNCHLIST_ui15.md now please');
});

test('a title that is only comments falls back instead of going empty', () => {
  assert.equal(titleFromPrompt('<!-- browser -->\n<!-- verify: no -->'), '');
  assert.equal(buildSessionTitleFromMessage('<!-- browser -->'), 'Untitled Session');
  assert.equal(normalizeSessionName('<!-- browser -->', 'Untitled Codex Session'), 'Untitled Codex Session');
});

test('plain messages keep the four-word title and comment detection is exact', () => {
  assert.equal(buildSessionTitleFromMessage('fix the login redirect bug today'), 'fix the login redirect');
  assert.equal(isCommentShapedTitle('<!-- name: Verify 02-composer.md --> You are'), true);
  assert.equal(isCommentShapedTitle('Jobs view truth'), false);
  assert.equal(titleFromPrompt(null), '');
});
