import assert from 'node:assert/strict';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import { BashCommandDisplay } from '../../../components/chat/tools/components/BashCommandDisplay';
import { CollapsibleSection } from '../../../components/chat/tools/components/CollapsibleSection';
import { OneLineDisplay } from '../../../components/chat/tools/components/OneLineDisplay';
import { ResearchDisplay } from '../../../components/chat/tools/components/ResearchDisplay';
import { ToolErrorDisplay } from '../../../components/chat/tools/components/ToolErrorDisplay';

import { Thinking } from './Thinking';
import { TranscriptIndicatorRow } from './TranscriptIndicatorRow';

const indicatorClass = (markup: string) => {
  const match = /data-slot="transcript-indicator-row"[^>]*class="([^"]+)"/.exec(markup);
  assert.ok(match, 'expected the shared transcript indicator header');
  return match[1];
};

test('every transcript indicator kind renders the one shared header anatomy', () => {
  const rows = [
    <BashCommandDisplay key="bash" command="npm test" output="ok" durationMeta={<span>1.2s</span>} />,
    <OneLineDisplay key="one-line" toolName="Read" label="Read" value="notes.md" />,
    <CollapsibleSection key="collapsible" toolName="Edit" title="app.tsx"><span>diff</span></CollapsibleSection>,
    <ResearchDisplay
      key="research"
      toolName="WebSearch"
      toolInput={{ query: 'indicator rows' }}
      toolResult={{ content: 'Links: [{"title":"Source","url":"https://example.com"}]' }}
    />,
    <ToolErrorDisplay key="error" label="Error" content="Something failed" />,
    <Thinking key="thinking" mode="reasoning" activeLabel="Thinking" doneLabel="Thought"><span>trace</span></Thinking>,
    <TranscriptIndicatorRow key="agent" kind="agent" label="Agent" detail="delegated task" />,
    <TranscriptIndicatorRow key="memory" kind="memory" label="Memory updated" />,
    <TranscriptIndicatorRow key="watchdog" kind="watchdog" label="Watchdog" detail="maintenance turn" />,
    <TranscriptIndicatorRow key="interrupted" kind="interrupted" label="Interrupted" />,
    <TranscriptIndicatorRow key="task-status" kind="task-status" label="Task" detail="completed" />,
    <TranscriptIndicatorRow key="activity" kind="activity" label="Writing" role="status" active />,
  ];

  const classes = rows.map((row) => indicatorClass(renderToStaticMarkup(row)));
  for (const className of classes) {
    assert.match(className, /min-h-7/);
    assert.match(className, /rounded-md/);
    assert.match(className, /py-0\.5/);
    assert.match(className, /text-xs/);
    assert.match(className, /text-foreground\/90/);
  }
});

test('Bash uses a fixed label and the shared muted detail slot', () => {
  const markup = renderToStaticMarkup(<BashCommandDisplay command="git status" output="clean" />);
  assert.match(markup, />Bash</);
  assert.match(markup, /font-mono text-\[11px\] text-muted-foreground\/70[^>]*>git status</);
});
