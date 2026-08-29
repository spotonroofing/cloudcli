import assert from 'node:assert/strict';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import type { ChatMessage } from '../../types/types';
import type { Project, ProjectSession } from '../../../../types/app';

import ChatMessagesPane from './ChatMessagesPane';

const project = { projectId: 'p1', path: '/tmp/project', displayName: 'Project' } as unknown as Project;
const session = { id: 's1', __provider: 'codex' } as unknown as ProjectSession;

const message = (id: string, content: string): ChatMessage => ({
  id,
  type: 'assistant',
  content,
  timestamp: new Date().toISOString(),
} as unknown as ChatMessage);

const renderPane = (messages: ChatMessage[], activity: unknown) => {
  // The activity row's ticker uses a layout effect in the browser; React's
  // expected server-render warning is not what this test is about.
  const originalError = console.error;
  console.error = () => undefined;
  try {
    return renderToStaticMarkup(
      <ChatMessagesPane
        scrollContainerRef={{ current: null } as never}
        onWheel={() => undefined}
        onTouchMove={() => undefined}
        isLoadingSessionMessages={false}
        isProcessing={Boolean(activity)}
        activity={activity as never}
        chatMessages={messages}
        selectedSession={session}
        provider="codex"
        isLoadingMoreMessages={false}
        visibleMessages={messages}
        createDiff={undefined}
        onGrantToolPermission={() => ({ success: true })}
        selectedProject={project}
      />,
    );
  } finally {
    console.error = originalError;
  }
};

// ui18 job 6. Willem's 2026-08-29 screenshot: a Codex worker session whose last
// row was a live "Thinking 10m 10.0s" sat at the top of the pane with about
// 400px of dead space between it and the composer, and a wheel that did
// nothing. Measured on dev before the fix: a 964px pane with 964px of content
// (no scroll range at all) and the indicator's bottom edge 348px above the
// composer's top edge. Both facts come from this transcript shell, so both are
// pinned here: the content box is at least one pane tall and lays its rows out
// from the bottom, and the composer clearance is a real trailing element.
test('the transcript shell anchors its rows to the bottom of the pane', () => {
  const markup = renderPane([message('m1', 'one line')], null);
  const log = /<div[^>]*role="log"[^>]*>/.exec(markup);
  assert.ok(log, 'expected the scroller content to be the transcript log');
  const attributes = log[0];
  assert.match(attributes, /min-h-full/, 'the content must fill the pane so spare space is layout, not a gap');
  assert.match(attributes, /flex-col/);
  assert.match(attributes, /justify-end/, 'spare space belongs above the first row, never below the last');
});

test('the composer clearance is the last element under the transcript log', () => {
  const markup = renderPane([message('m1', 'one line')], null);
  const clearance = markup.lastIndexOf('data-slot="composer-clearance"');
  assert.ok(clearance > -1, 'the clearance must be a spacer element, not padding the follow observer cannot see');
  // Nothing may open after it: the spacer is exactly the composer's height and
  // hides behind it, so anything below would push the last row into view above
  // the composer and reopen the gap.
  assert.equal(markup.slice(clearance).match(/<div/g)?.length ?? 0, 0);
});

test('the live indicator is the last row in the transcript flow', () => {
  const markup = renderPane(
    [message('m1', 'one line')],
    { statusText: null, canInterrupt: true, phase: 'thinking', phaseStartedAt: Date.now(), startedAt: Date.now() },
  );
  const indicator = markup.indexOf('data-testid="activity-indicator"');
  const clearance = markup.indexOf('data-slot="composer-clearance"');
  assert.ok(indicator > -1, 'a running turn renders the live indicator row');
  assert.ok(indicator < clearance, 'the indicator sits above the composer clearance');
  assert.equal(markup.slice(indicator, clearance).includes('class="chat-message'), false);
});
