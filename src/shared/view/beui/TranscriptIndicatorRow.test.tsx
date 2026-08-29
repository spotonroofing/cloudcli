import assert from 'node:assert/strict';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import { BashCommandDisplay } from '../../../components/chat/tools/components/BashCommandDisplay';
import { CollapsibleSection } from '../../../components/chat/tools/components/CollapsibleSection';
import { OneLineDisplay } from '../../../components/chat/tools/components/OneLineDisplay';
import { ResearchDisplay } from '../../../components/chat/tools/components/ResearchDisplay';
import { ToolErrorDisplay } from '../../../components/chat/tools/components/ToolErrorDisplay';
import StatusDuration from '../../../components/chat/view/subcomponents/StatusDuration';

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
  const markup = renderToStaticMarkup(<BashCommandDisplay command={'git status\necho hidden'} output="clean" />);
  assert.match(markup, />Bash</);
  assert.match(markup, />git status</);
  assert.doesNotMatch(markup, /echo hidden/);
  assert.match(markup, /font-mono text-\[11px\] text-muted-foreground\/70[^>]*>git status</);
});

/**
 * ui17 job 5: one rule for the whole status-row family — a duration sits in
 * the label group, right after the word it belongs to, and the trailing slot
 * holds the chevron alone. Order in the static markup is the structural proof;
 * the on-screen 12px gap is enforced by the label group's `gap-1.5`.
 */
const familyRowsWithDurations = () => {
  const duration = <StatusDuration durationMs={19_100} />;
  return [
    ['bash', <BashCommandDisplay key="bash" command="npm test" output="ok\nline two" durationMeta={duration} />],
    ['one-line', <OneLineDisplay key="one-line" toolName="Read" label="Read" value="notes.md" durationMeta={duration} />],
    ['collapsible', <CollapsibleSection key="collapsible" toolName="Edit" title="app.tsx" durationMeta={duration}><span>diff</span></CollapsibleSection>],
    ['research', <ResearchDisplay
      key="research"
      toolName="WebSearch"
      toolInput={{ query: 'indicator rows' }}
      toolResult={{ content: 'Links: [{"title":"Source","url":"https://example.com"}]' }}
      durationMs={19_100}
    />],
    ['thinking', <Thinking key="thinking" mode="reasoning" activeLabel="Thinking" doneLabel="Thought for" meta={duration}><span>trace</span></Thinking>],
    ['agent', <Thinking key="agent" kind="agent" mode="steps" activeLabel="Agent" doneLabel="Agent" doneDetail="delegated task" meta={duration}><span>trace</span></Thinking>],
    ['memory', <Thinking key="memory" kind="memory" mode="coding" activeLabel="Memory updated" doneLabel="Memory updated" meta={duration}><span>files</span></Thinking>],
    ['tool-group', <TranscriptIndicatorRow key="tool-group" kind="tool-group" label="Read" detail="notes.md" meta="x3" duration={duration} expandable />],
  ] as const;
};

test('every status row keeps its duration beside its label, never in the trailing slot', () => {
  for (const [kind, row] of familyRowsWithDurations()) {
    const markup = renderToStaticMarkup(row);

    const labelIndex = markup.indexOf('data-slot="indicator-label-text"');
    const durationIndex = markup.indexOf('data-slot="status-duration"');
    const detailIndex = markup.indexOf('data-slot="indicator-detail"');
    const affordanceIndex = markup.indexOf('data-slot="indicator-affordance"');

    assert.ok(labelIndex >= 0, `${kind}: expected a label`);
    assert.ok(durationIndex >= 0, `${kind}: expected a duration`);
    assert.ok(detailIndex >= 0, `${kind}: expected the detail slot`);
    assert.ok(affordanceIndex >= 0, `${kind}: expected the trailing affordance slot`);

    assert.ok(labelIndex < durationIndex, `${kind}: duration must follow its label`);
    assert.ok(durationIndex < detailIndex, `${kind}: duration must sit before the preview`);
    assert.ok(durationIndex < affordanceIndex, `${kind}: duration must not sit in the trailing slot`);

    // The duration lives inside the label group, so nothing can be spliced
    // between the word and its figure.
    const groupIndex = markup.indexOf('data-slot="indicator-label"');
    assert.ok(groupIndex >= 0 && groupIndex < labelIndex, `${kind}: expected the label group`);
    assert.match(
      markup.slice(groupIndex, labelIndex),
      /gap-1\.5/,
      `${kind}: label and duration share the small fixed gap`,
    );

    // Nothing after the trailing slot opens but the chevron: no duration, no count.
    const trailing = markup.slice(affordanceIndex);
    assert.ok(!trailing.includes('data-slot="status-duration"'), `${kind}: trailing slot carries a duration`);
    assert.ok(!trailing.includes('data-slot="indicator-meta"'), `${kind}: trailing slot carries a count`);
  }
});

test('counts ride with the preview in the preview muted style, and the preview is what truncates', () => {
  const markup = renderToStaticMarkup(
    <BashCommandDisplay command="git status" output={'a\nb\nc'} durationMeta={<StatusDuration durationMs={300} />} />,
  );
  assert.match(markup, /data-slot="indicator-meta"[^>]*class="[^"]*font-mono text-\[11px\][^"]*"/);
  assert.match(markup, /data-slot="indicator-meta"[^>]*class="[^"]*shrink-0[^"]*"/);
  assert.match(markup, /class="min-w-0 shrink truncate font-mono text-\[11px\] text-muted-foreground\/70"/);
  // The figure never truncates.
  assert.doesNotMatch(markup, /data-slot="status-duration"[^>]*class="[^"]*truncate[^"]*"/);
});
