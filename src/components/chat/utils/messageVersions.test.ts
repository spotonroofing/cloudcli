import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyMessageVersions,
  findEditGroupId,
  groupVersionRows,
  type MessageVersionView,
} from './messageVersions';
import type { ChatMessage } from '../types/types';

const at = (seconds: number) => new Date(2026, 7, 23, 12, 0, seconds).toISOString();

const message = (id: string, type: string, content: string, seconds: number): ChatMessage => ({
  id,
  type,
  content,
  timestamp: at(seconds),
});

// One edited exchange: u1/a1 is version 1, u2/a2 the selected resend.
const transcript = [
  message('u0', 'user', 'earlier prompt', 0),
  message('a0', 'assistant', 'earlier answer', 1),
  message('u1', 'user', 'original prompt', 10),
  message('a1', 'assistant', 'original answer', 11),
  message('u2', 'user', 'edited prompt', 20),
  message('a2', 'assistant', 'new answer', 21),
];

const view = (selections: Array<[string, number]> = []): MessageVersionView => ({
  groups: groupVersionRows([
    { group_id: 'u1', version: 1, user_message_id: 'u1', prompt_text: 'original prompt', is_selected: 0, created_at: at(19) },
    { group_id: 'u1', version: 2, user_message_id: null, prompt_text: 'edited prompt', is_selected: 1, created_at: at(19) },
  ]),
  selections: new Map(selections),
});

test('hides the non-selected version segment and keeps earlier turns', () => {
  const visible = applyMessageVersions(transcript, view());
  assert.deepEqual(visible.map((entry) => entry.id), ['u0', 'a0', 'u2', 'a2']);
});

test('flipping the selection shows the original segment instead', () => {
  const visible = applyMessageVersions(transcript, view([['u1', 1]]));
  assert.deepEqual(visible.map((entry) => entry.id), ['u0', 'a0', 'u1', 'a1']);
});

test('stamps the navigator on the last visible message of the group', () => {
  const visible = applyMessageVersions(transcript, view());
  const marked = visible.find((entry) => entry.versionNav);
  assert.equal(marked?.id, 'a2');
  assert.deepEqual(marked?.versionNav, { groupId: 'u1', current: 2, total: 2, versions: [1, 2] });
});

test('navigator stays on the edited exchange when the conversation continues', () => {
  const continued = [
    ...transcript,
    message('u3', 'user', 'later prompt', 30),
    message('a3', 'assistant', 'later answer', 31),
  ];
  const visible = applyMessageVersions(continued, view());
  assert.deepEqual(visible.map((entry) => entry.id), ['u0', 'a0', 'u2', 'a2', 'u3', 'a3']);
  const marked = visible.filter((entry) => entry.versionNav);
  assert.equal(marked.length, 1);
  assert.equal(marked[0].id, 'a2');
});

test('resolves an unresolved resend by creation time while its turn streams in', () => {
  // The resend's user turn has not landed yet: only a1 exists after created_at.
  const streaming = transcript.slice(0, 4);
  const visible = applyMessageVersions(streaming, view());
  // v2's segment starts at created_at (19s); everything from u1 (10s) hides.
  assert.deepEqual(visible.map((entry) => entry.id), ['u0', 'a0']);
});

test('findEditGroupId maps a resent turn back to its group and defaults elsewhere', () => {
  const groups = view().groups;
  assert.equal(findEditGroupId(groups, transcript[2]), 'u1');
  assert.equal(findEditGroupId(groups, transcript[4]), 'u1');
  assert.equal(findEditGroupId(groups, transcript[0]), 'u0');
});
