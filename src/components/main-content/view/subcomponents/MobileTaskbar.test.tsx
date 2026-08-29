import assert from 'node:assert/strict';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import MobileTaskbar, { taskbarSegments, type TaskbarState } from './MobileTaskbar';

const state = (overrides: Partial<TaskbarState> = {}): TaskbarState => ({
  workerAvailable: true,
  openWindows: { files: false, git: false, shell: false },
  activeTab: 'chat',
  shellActive: false,
  ...overrides,
});

test('planner and worker are the two segments before any window is opened', () => {
  const segments = taskbarSegments(state());
  assert.deepEqual(segments.map((segment) => segment.id), ['planner', 'worker']);
  assert.deepEqual(segments.map((segment) => segment.active), [true, false]);
});

test('each opened tool window adds one segment in a fixed order', () => {
  const segments = taskbarSegments(state({
    openWindows: { files: true, git: true, shell: true },
    activeTab: 'git',
  }));
  assert.deepEqual(segments.map((segment) => segment.id), ['planner', 'worker', 'files', 'git', 'shell']);
  assert.deepEqual(segments.filter((segment) => segment.active).map((segment) => segment.id), ['git']);
});

test('the shell segment takes the mark from the chat pane it replaced', () => {
  const segments = taskbarSegments(state({
    openWindows: { files: false, git: false, shell: true },
    activeTab: 'worker',
    shellActive: true,
  }));
  assert.deepEqual(segments.map((segment) => segment.id), ['planner', 'worker', 'shell']);
  assert.deepEqual(segments.filter((segment) => segment.active).map((segment) => segment.id), ['shell']);
});

test('a tool window the app routed to carries its segment without the selector', () => {
  const segments = taskbarSegments(state({ activeTab: 'files' }));
  assert.deepEqual(segments.map((segment) => segment.id), ['planner', 'worker', 'files']);
});

test('a project without a worker gets no taskbar', () => {
  assert.deepEqual(taskbarSegments(state({ workerAvailable: false })), []);
  assert.equal(
    renderToStaticMarkup(
      <MobileTaskbar segments={taskbarSegments(state({ workerAvailable: false }))} hidden={false} onSelect={() => undefined} />,
    ),
    '',
  );
});

test('segments split the bar evenly and the focused composer slides it away', () => {
  const segments = taskbarSegments(state({ openWindows: { files: true, git: false, shell: false } }));
  const markup = renderToStaticMarkup(
    <MobileTaskbar segments={segments} hidden onSelect={() => undefined} />,
  );

  assert.equal((markup.match(/data-slot="mobile-taskbar-segment"/g) ?? []).length, 3);
  assert.equal((markup.match(/flex-1 basis-0/g) ?? []).length, 3);
  assert.match(markup, /data-segments="3"/);
  assert.match(markup, /data-hidden="true"/);
  assert.match(markup, /translate-y-full/);
});
