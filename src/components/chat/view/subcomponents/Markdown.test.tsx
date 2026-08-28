import { test } from 'node:test';
import assert from 'node:assert';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Markdown } from './Markdown';
import { isRemoteImageUrl, isWorkspaceImagePath } from './MarkdownInlineImage';
import { DRAFT_LIST_25, BOLD_LED_BULLETS } from './markdownRegressionFixtures';

// The component needs no providers for plain prose: palette ops fall back to
// no-ops and theme/i18n are only touched inside code blocks.
const render = (text: string) => renderToStaticMarkup(<Markdown>{text}</Markdown>);

const listItems = (html: string, listTag: 'ol' | 'ul') => {
  const list = html.match(new RegExp(`<${listTag}[^>]*>([\\s\\S]*?)</${listTag}>`));
  assert.ok(list, `expected a <${listTag}> in the output`);
  return [...list![1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) =>
    m[1].replace(/<[^>]+>/g, ''),
  );
};

test('25-item planner draft list keeps all items, in order, unmangled', () => {
  const html = render(DRAFT_LIST_25);
  const items = listItems(html, 'ol');
  assert.strictEqual(items.length, 25);
  // The items Willem saw as ".0" / "!1." — their text must round-trip intact.
  assert.match(items[9], /^App-wide overlay consistency pass/);
  assert.match(items[19], /^Edit-and-resend with response versioning/);
  assert.match(items[24], /^planner\.md: every intake ends/);
  for (const item of items) {
    assert.ok(!/^[.!]/.test(item.trim()), `item must not start with a stray marker artifact: ${item.slice(0, 40)}`);
  }
});

test('ordered list renders as a semantic <ol> so markers come from the browser, not text', () => {
  const html = render(DRAFT_LIST_25);
  // Markers are browser-generated: no literal "10." may appear inside item text.
  const items = listItems(html, 'ol');
  for (const item of items) {
    assert.ok(!/^\d+\.\s/.test(item.trim()), `marker leaked into item text: ${item.slice(0, 40)}`);
  }
});

test('a list starting past 1 keeps its real numbers (start passthrough)', () => {
  const html = render('intro\n\n4. fourth\n5. fifth\n6. sixth');
  assert.match(html, /<ol[^>]*start="4"/);
});

test('bold-led bullets keep their <strong> lead and full text', () => {
  const html = render(BOLD_LED_BULLETS);
  const items = listItems(html, 'ul');
  assert.ok(items.length >= 6);
  for (const lead of ['Sidebar truth:', 'Drafts:', 'Sidebar redo:', 'Themes:', 'Workspace:', 'Accounts:']) {
    assert.ok(
      new RegExp(`<strong[^>]*>${lead.replace(':', ':?')}`).test(html) || html.includes(`<strong>${lead}</strong>`),
      `expected a bold lead for "${lead}"`,
    );
  }
  // No "!" exists in the source bullets; none may be introduced by rendering.
  const bulletText = items.join(' ');
  assert.ok(!bulletText.includes('!'), 'rendering introduced a stray "!"');
});

// Code blocks are excluded here: they render through theme/i18n providers that
// need a browser environment. The broken cases this file guards are lists.
test('standard GFM structures round-trip: nested lists, links, tables', () => {
  const html = render(
    '1. first\n   - nested a\n   - nested b\n2. second with a [link](https://example.com)\n\n| h1 | h2 |\n| -- | -- |\n| a | b |',
  );
  assert.match(html, /<ol[^>]*>/);
  assert.match(html, /<ul[^>]*>/);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.match(html, /<table[^>]*>/);
  assert.match(html, /<th[^>]*>h1<\/th>/);
});

test('image source classification accepts only HTTPS or bare workspace paths', () => {
  assert.equal(isRemoteImageUrl('https://images.example.com/reference.png'), true);
  assert.equal(isRemoteImageUrl('HTTPS://images.example.com/reference.png'), true);
  assert.equal(isRemoteImageUrl('http://images.example.com/reference.png'), false);
  assert.equal(isRemoteImageUrl('//images.example.com/reference.png'), false);
  assert.equal(isRemoteImageUrl('data:image/png;base64,abc'), false);

  assert.equal(isWorkspaceImagePath('assets/icon.svg'), true);
  assert.equal(isWorkspaceImagePath('/Users/example/project/icon.png'), true);
  assert.equal(isWorkspaceImagePath('https://images.example.com/reference.png'), false);
  assert.equal(isWorkspaceImagePath('blob:unsafe'), false);
  assert.equal(isWorkspaceImagePath('//images.example.com/reference.png'), false);
});

test('consecutive HTTPS image markers render as an even compact grid of zoomable cards', () => {
  const html = render([
    '![One](https://images.example.com/one.png)',
    '![Two](https://images.example.com/two.png)',
    '![Three](https://images.example.com/three.png)',
    '![Four](https://images.example.com/four.png)',
  ].join('\n'));

  assert.match(html, /data-slot="transcript-image-grid"/);
  assert.match(html, /data-image-count="4"/);
  assert.equal((html.match(/data-slot="transcript-image-card"/g) ?? []).length, 4);
  assert.equal((html.match(/aria-label="Expand /g) ?? []).length, 4);
  assert.equal((html.match(/size-28 sm:size-32/g) ?? []).length, 4);
  assert.equal((html.match(/object-contain/g) ?? []).length, 4);
});

test('unsupported remote schemes keep the graceful non-image fallback', () => {
  const html = render('![Unsafe](http://images.example.com/unsafe.png)');
  assert.match(html, /data-slot="transcript-image-fallback"/);
  assert.doesNotMatch(html, /data-slot="transcript-image-card"/);
});
