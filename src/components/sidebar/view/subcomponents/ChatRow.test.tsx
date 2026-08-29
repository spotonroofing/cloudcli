import assert from 'node:assert/strict';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import ChatRow from './ChatRow';

const renderRow = (sessionId: string, wakeTarget = false) => renderToStaticMarkup(
  <ChatRow
    href={`/session/${sessionId}`}
    bounceKey={sessionId}
    title={`Chat ${sessionId}`}
    age="now"
    isSelected
    isWatchdogWakeTarget={wakeTarget}
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
