import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { wrapMachineMessage } from '@/shared/utils.js';

const SESSION_ID = 'session-1';

const SKILL_BODY = [
  'Base directory for this skill: /tmp/claude/bundled-skills/2.1.220/abc123/claude-api',
  '',
  '# Building LLM-Powered Applications with Claude',
  '',
  'This skill helps you build LLM-powered applications with Claude.',
].join('\n');

test('claude: watchdog prompts keep explicit origin live and on reload', () => {
  const provider = new ClaudeSessionsProvider();
  const content = wrapMachineMessage('Check the dispatched chain.', 'watchdog');
  for (const rawContent of [content, [{ type: 'text', text: content }]]) {
    const messages = provider.normalizeMessage({
      uuid: `watchdog-${typeof rawContent}`,
      timestamp: '2026-08-27T10:00:00.000Z',
      message: { role: 'user', content: rawContent },
    }, SESSION_ID);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].content, 'Check the dispatched chain.');
    assert.equal(messages[0].messageOrigin, 'watchdog');
  }
});

test('claude: injected skill bodies are hidden even without the isMeta flag', () => {
  const provider = new ClaudeSessionsProvider();

  // The live SDK stream omits `isMeta`, so the payload has to be recognised by
  // its content or it renders as a giant user bubble mid-run.
  const live = provider.normalizeMessage(
    {
      uuid: 'u1',
      timestamp: '2026-07-28T10:00:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: SKILL_BODY }] },
    },
    SESSION_ID,
  );
  assert.deepEqual(live, []);

  const persisted = provider.normalizeMessage(
    {
      uuid: 'u2',
      timestamp: '2026-07-28T10:00:00.000Z',
      isMeta: true,
      message: { role: 'user', content: [{ type: 'text', text: SKILL_BODY }] },
    },
    SESSION_ID,
  );
  assert.deepEqual(persisted, []);
});

test('claude: the Skill tool result itself still reaches the UI', () => {
  const provider = new ClaudeSessionsProvider();

  const messages = provider.normalizeMessage(
    {
      uuid: 'u3',
      timestamp: '2026-07-28T10:00:00.000Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Launching skill: claude-api' }],
      },
    },
    SESSION_ID,
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'tool_result');
  assert.equal(messages[0].toolId, 'toolu_1');
});

test('claude: partial frames cannot chop or double-post a completed assistant block', () => {
  const provider = new ClaudeSessionsProvider();
  const content = 'Bottom line: it is not you. This reply must render exactly once.';
  const frames = [
    { type: 'content_block_delta', delta: { text: 'Bottom line: ' } },
    { type: 'content_block_delta', delta: { text: 'it is not you.' } },
    { type: 'content_block_stop' },
    {
      type: 'assistant',
      uuid: 'completed-block',
      timestamp: '2026-08-27T04:14:18.864Z',
      message: {
        id: 'msg_named_planner_reply',
        role: 'assistant',
        content: [{ type: 'text', text: content }],
      },
    },
  ];

  const normalized = frames.flatMap((frame) => provider.normalizeMessage(frame, SESSION_ID));
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].kind, 'text');
  assert.equal(normalized[0].content, content);
});

test('claude: a queued_command attachment renders as the user turn it became', () => {
  const provider = new ClaudeSessionsProvider();

  // The CLI folds a message queued mid-turn into the running turn and persists
  // it as an attachment (ui11 phase 2), not as a user row.
  const messages = provider.normalizeMessage(
    {
      type: 'attachment',
      uuid: 'att-1',
      parentUuid: 'tool-result-uuid',
      timestamp: '2026-08-24T19:41:11.882Z',
      attachment: { type: 'queued_command', prompt: 'From now on end every summary with BANANA.', commandMode: 'prompt' },
    },
    SESSION_ID,
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'text');
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].id, 'att-1');
  assert.equal(messages[0].timestamp, '2026-08-24T19:41:11.882Z');
  assert.equal(messages[0].content, 'From now on end every summary with BANANA.');

  assert.deepEqual(
    provider.normalizeMessage({ type: 'attachment', uuid: 'att-2', attachment: { type: 'queued_command', prompt: '   ' } }, SESSION_ID),
    [],
  );
});

test('claude: composer-sent commands normalize to a compact command payload with the body', () => {
  const provider = new ClaudeSessionsProvider();

  const wrapped = [
    '<command-message>End this planner session - refresh STATE.md</command-message>',
    '<command-name>/handoff</command-name>',
    '<command-args></command-args>',
    '',
    'Run the planner handoff for this session.',
  ].join('\n');

  const messages = provider.normalizeMessage(
    {
      uuid: 'cmd-1',
      timestamp: '2026-08-24T10:00:00.000Z',
      message: { role: 'user', content: wrapped },
    },
    SESSION_ID,
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'text');
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].content, '/handoff');
  assert.equal(messages[0].commandName, '/handoff');
  assert.equal(messages[0].commandMessage, 'End this planner session - refresh STATE.md');
  assert.equal(messages[0].commandBody, 'Run the planner handoff for this session.');
  assert.equal(messages[0].isLocalCommand, true);

  // CLI-written local command rows (no body) keep their historical shape.
  const cliMessages = provider.normalizeMessage(
    {
      uuid: 'cmd-2',
      timestamp: '2026-08-24T10:01:00.000Z',
      message: { role: 'user', content: '<command-message>clear</command-message>\n<command-name>/clear</command-name>' },
    },
    SESSION_ID,
  );
  assert.equal(cliMessages.length, 1);
  assert.equal(cliMessages[0].content, '/clear');
  assert.equal(cliMessages[0].commandBody, undefined);
});
