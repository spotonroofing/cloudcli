import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeShortLabel } from '@/modules/providers/services/session-label.service.js';

test('strips surrounding quotes', () => {
  assert.equal(sanitizeShortLabel('"Fix login redirect bug"'), 'Fix login redirect bug');
  assert.equal(sanitizeShortLabel('`Deploy pipeline cleanup`'), 'Deploy pipeline cleanup');
});

test('strips a trailing period', () => {
  assert.equal(sanitizeShortLabel('Refactor session watcher.'), 'Refactor session watcher');
});

test('multiline output takes the last non-empty line', () => {
  const raw = 'Here is a label for the session:\n\nRoof estimate follow-up\n';
  assert.equal(sanitizeShortLabel(raw), 'Roof estimate follow-up');
});

test('rejects labels with more than 8 words', () => {
  assert.equal(sanitizeShortLabel('one two three four five six seven eight nine'), null);
});

test('rejects empty and whitespace-only output', () => {
  assert.equal(sanitizeShortLabel(''), null);
  assert.equal(sanitizeShortLabel('   \n  \n'), null);
  assert.equal(sanitizeShortLabel('"."'), null);
});
