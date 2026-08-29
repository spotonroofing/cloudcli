import assert from 'node:assert/strict';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import ChatRow from './ChatRow';

const renderRow = (
  sessionId: string,
  wakeTarget = false,
  isLoading = false,
  failedReason: string | null = null,
) => renderToStaticMarkup(
  <ChatRow
    href={`/session/${sessionId}`}
    bounceKey={sessionId}
    title={`Chat ${sessionId}`}
    age="now"
    isSelected
    isWatchdogWakeTarget={wakeTarget}
    isLoading={isLoading}
    failedReason={failedReason}
    onRetry={() => undefined}
    onSelect={() => undefined}
    onRename={() => undefined}
    menu={{
      sessionId,
      sessionTitle: `Chat ${sessionId}`,
      providerLabel: 'Claude',
      projects: [],
      currentProjectId: 'project-1',
      currentProjectName: 'Project',
      onMoveToProject: () => undefined,
      onArchive: () => undefined,
      onDelete: () => undefined,
    }}
  />,
);

test('chat rows expose their session id as the bounce-dot destination', () => {
  assert.match(renderRow('session-a'), /data-bounce-key="session-a"/);
  assert.match(renderRow('session-b'), /data-bounce-key="session-b"/);
});

test('the wake target leaves no mark on the row (ui17 job 15)', () => {
  const markup = renderRow('session-a', true);

  assert.doesNotMatch(markup, /watchdog-wake-target-mark/);
  assert.doesNotMatch(markup, />wake</);
});

test('a reserved handoff successor reads as a loading row (ui17 job 17)', () => {
  const markup = renderRow('session-successor', false, true);

  assert.match(markup, /data-slot="chat-row-loading"/);
  assert.match(markup, /aria-busy="true"/);
  // No age line: the row has no history to date yet.
  assert.doesNotMatch(markup, />now</);
});

test('a failed successor row carries its reason and a Retry control (ui17 job 21)', () => {
  const markup = renderRow(
    'session-successor',
    false,
    false,
    'The handoff turn was stopped before it finished.',
  );

  assert.match(markup, /data-slot="chat-row-boot-failed"/);
  assert.match(markup, /The handoff turn was stopped before it finished\./);
  assert.match(markup, /data-slot="chat-row-boot-retry"/);
  assert.match(markup, />Retry</);
  // The reason takes the age's place, so the row still reads as two lines.
  assert.doesNotMatch(markup, />now</);
});
