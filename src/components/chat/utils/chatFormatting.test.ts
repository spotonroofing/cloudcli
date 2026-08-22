import assert from 'node:assert/strict';
import test from 'node:test';

import { extractExternalLinks, stripProposedPlanEnvelope } from './chatFormatting';

test('stripProposedPlanEnvelope removes a complete outer plan envelope', () => {
  assert.equal(
    stripProposedPlanEnvelope('<proposed_plan>\n# Session Timeline\n\nPlan body\n</proposed_plan>'),
    '# Session Timeline\n\nPlan body',
  );
});

test('stripProposedPlanEnvelope removes the opening tag while a plan is streaming', () => {
  assert.equal(
    stripProposedPlanEnvelope('<proposed_plan>\n# Partial plan'),
    '# Partial plan',
  );
});

test('stripProposedPlanEnvelope preserves tags that are not the outer envelope', () => {
  const content = 'Use `<proposed_plan>` only for plans.';
  assert.equal(stripProposedPlanEnvelope(content), content);
});

test('stripProposedPlanEnvelope preserves an unmatched terminal closing tag', () => {
  const content = 'Ordinary text that mentions a terminal tag.\n</proposed_plan>';
  assert.equal(stripProposedPlanEnvelope(content), content);
});

test('extractExternalLinks collects markdown links with their text as title', () => {
  assert.deepEqual(
    extractExternalLinks('See [Railway docs](https://docs.railway.app/guides) for details.'),
    [{ url: 'https://docs.railway.app/guides', title: 'Railway docs', domain: 'docs.railway.app' }],
  );
});

test('extractExternalLinks collects bare URLs and trims trailing punctuation', () => {
  assert.deepEqual(
    extractExternalLinks('Deployed at https://example.com/app.'),
    [{ url: 'https://example.com/app', title: 'example.com', domain: 'example.com' }],
  );
});

test('extractExternalLinks dedupes by URL, first occurrence wins', () => {
  const links = extractExternalLinks(
    'Read [the guide](https://example.com/guide), then revisit https://example.com/guide later.',
  );
  assert.equal(links.length, 1);
  assert.equal(links[0].title, 'the guide');
});

test('extractExternalLinks ignores file references and non-http links', () => {
  assert.deepEqual(
    extractExternalLinks('Edit [src/foo.ts](src/foo.ts) and email [us](mailto:team@spotonroof.com).'),
    [],
  );
});

test('extractExternalLinks ignores image embeds', () => {
  assert.deepEqual(
    extractExternalLinks('Here is a chart: ![revenue chart](https://cdn.example.com/chart.png) and [the source](https://example.com/data).'),
    [{ url: 'https://example.com/data', title: 'the source', domain: 'example.com' }],
  );
});
