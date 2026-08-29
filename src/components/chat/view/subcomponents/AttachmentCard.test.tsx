import { test } from 'node:test';
import assert from 'node:assert';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import ChatMessageFiles from './ChatMessageFiles';
import ChatMessageImages from './ChatMessageImages';
import { Markdown } from './Markdown';

// Every card element the transcript draws, whatever the attachment kind.
const cardTags = (html: string): string[] =>
  [...html.matchAll(/<button[^>]*data-attachment-card[^>]*>/g)].map((match) => match[0]);

const classOf = (tag: string): string => tag.match(/class="([^"]*)"/)?.[1] ?? '';

const kindOf = (tag: string): string => tag.match(/data-attachment-kind="([^"]*)"/)?.[1] ?? '';

test('one card component renders every attachment kind and a presented file link', () => {
  const sent = renderToStaticMarkup(
    <>
      <ChatMessageImages images={[{ path: '/assets/1-shot.png', name: 'shot.png', size: 2048 }]} />
      <ChatMessageFiles
        files={[
          { path: '/assets/2-Pasted text.txt', name: 'Pasted text.txt', size: 900 },
          { path: '/assets/3-spec.pdf', name: 'spec.pdf', mimeType: 'application/pdf', size: 51200 },
        ]}
      />
    </>,
  );
  const assistant = renderToStaticMarkup(
    <Markdown fileCards>{'Here it is: [the punch list](PUNCHLIST_ui18.md)'}</Markdown>,
  );

  const cards = [...cardTags(sent), ...cardTags(assistant)];
  assert.strictEqual(cards.length, 4, 'expected one card for each of the four attachments');

  // Identical dimensions and corners everywhere: the card class is one constant.
  const classes = new Set(cards.map(classOf));
  assert.strictEqual(classes.size, 1, `cards must share one class: ${[...classes].join(' | ')}`);
  const [cardClass] = [...classes];
  assert.match(cardClass, /\bh-20\b/);
  assert.match(cardClass, /\bw-20\b/);
  assert.match(cardClass, /\brounded-lg\b/);

  // The kinds are distinguishable inside that one shell.
  assert.deepStrictEqual(cards.map(kindOf), ['image', 'text', 'file', 'file']);
});

test('a code reference and a remote link stay plain links, images stay inline', () => {
  const html = renderToStaticMarkup(
    <Markdown fileCards>
      {'See [src/app.tsx:130](src/app.tsx:130) and [the docs](https://example.com/docs).\n\n![shot](https://example.com/shot.png)'}
    </Markdown>,
  );

  assert.strictEqual(cardTags(html).length, 0, 'neither a line reference nor a remote link is a card');
  assert.match(html, /href="src\/app\.tsx:130"/);
  assert.match(html, /href="https:\/\/example\.com\/docs"/);
  assert.match(html, /data-slot="transcript-image-(card|row|loading)"/);
});

test('file links stay plain links wherever file cards are off', () => {
  const html = renderToStaticMarkup(<Markdown>{'[the punch list](PUNCHLIST_ui18.md)'}</Markdown>);
  assert.strictEqual(cardTags(html).length, 0);
  assert.match(html, /href="PUNCHLIST_ui18\.md"/);
});
