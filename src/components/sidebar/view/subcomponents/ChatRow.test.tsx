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

test('the wake target is a hover-only mono tag, never a bell glyph', () => {
  const markup = renderRow('session-a', true);
  const mark = markup.match(/<span data-slot="watchdog-wake-target-mark"[^>]*>(.*?)<\/span>/)?.[0] ?? '';

  assert.match(mark, />wake<\/span>/);
  assert.match(mark, /font-mono/);
  assert.match(mark, /hidden/);
  assert.match(mark, /group-hover:inline-flex/);
  assert.doesNotMatch(mark, /<svg/);
});
