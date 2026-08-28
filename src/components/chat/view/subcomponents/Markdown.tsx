import React, { useMemo, useState } from 'react';
import { Check, Copy, FileCode2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
// Direct style-file imports: the styles/prism index re-exports every theme
// (worse for the bundle) and node's test runner can't parse it as CJS.
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark';
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light';
import { useTranslation } from 'react-i18next';

import MermaidDiagram from '../../../code-editor/view/subcomponents/markdown/MermaidDiagram';
import { ActionSwapIcon } from '../../../../shared/view/beui/ActionSwap';
import { normalizeInlineCodeFences } from '../../utils/chatFormatting';
import { copyTextToClipboard } from '../../../../utils/clipboard';
import { usePaletteOps } from '../../../../contexts/PaletteOpsContext';
import { useTheme } from '../../../../contexts/ThemeContext';

import MarkdownInlineImage from './MarkdownInlineImage';

type MarkdownProps = {
  children: React.ReactNode;
  className?: string;
  /** Render single newlines as hard line breaks (for user-typed messages). */
  breaks?: boolean;
  /**
   * Live-turn streaming treatment (beautifului.dev Streaming Text): wrap each
   * word in a span that blurs in on arrival. Append-only growth keeps earlier
   * spans' DOM nodes stable across reparses, so a word animates exactly once —
   * when it first lands.
   */
  streamWords?: boolean;
};

type MarkdownInlineImageProps = {
  src?: string;
  alt?: string;
  compact?: boolean;
};

const MarkdownImageRenderer = ({ src, alt, compact }: MarkdownInlineImageProps) => (
  <MarkdownInlineImage src={src} alt={alt} compact={compact} />
);

// Rehype plugin behind `streamWords`: wraps every word-sized text run in a
// `.bui-stream-word` span. Code panels and KaTeX output keep their text nodes
// untouched — wrapping there would break their own layout.
const rehypeStreamWords = () => (tree: unknown) => {
  const visit = (node: { children?: any[] }) => {
    if (!node.children) return;
    const nextChildren: any[] = [];
    for (const child of node.children) {
      if (child.type === 'element') {
        const classes = Array.isArray(child.properties?.className)
          ? child.properties.className.join(' ')
          : String(child.properties?.className ?? '');
        if (child.tagName === 'code' || child.tagName === 'pre' || classes.includes('katex')) {
          nextChildren.push(child);
          continue;
        }
        visit(child);
        nextChildren.push(child);
      } else if (child.type === 'text' && child.value.trim()) {
        for (const part of child.value.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) {
            nextChildren.push({ type: 'text', value: part });
          } else {
            nextChildren.push({
              type: 'element',
              tagName: 'span',
              properties: { className: ['bui-stream-word'] },
              children: [{ type: 'text', value: part }],
            });
          }
        }
      } else {
        nextChildren.push(child);
      }
    }
    node.children = nextChildren;
  };
  visit(tree as { children?: any[] });
};

// Links to the wider web (or in-page anchors) keep normal browser navigation;
// everything else is treated as a workspace file reference.
const isExternalHref = (href?: string): boolean =>
  !!href && (/^(https?:|mailto:|tel:|data:)/i.test(href) || href.startsWith('#'));

// Strip a trailing `:line` / `:line:col` suffix (e.g. `src/foo.ts:130`).
const stripLineSuffix = (value: string): string => value.replace(/:\d+(?::\d+)?$/, '');

// A usable file path contains a separator or a filename with an extension.
const looksLikeFilePath = (value?: string): value is string => {
  if (!value) {
    return false;
  }
  const cleaned = stripLineSuffix(value.trim());
  if (!cleaned || cleaned === '#') {
    return false;
  }
  return /[\\/]/.test(cleaned) || /\.[a-z0-9]+$/i.test(cleaned);
};

// Extract plain text from link children so a reference rendered only as link
// text (e.g. `[src/foo.ts]()` with an empty href) can still be opened.
const childrenToText = (children: React.ReactNode): string => {
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(childrenToText).join('');
  }
  if (React.isValidElement(children)) {
    return childrenToText((children.props as { children?: React.ReactNode }).children);
  }
  return '';
};

type CodeBlockProps = {
  node?: any;
  className?: string;
  children?: React.ReactNode;
  /** Set by the custom `pre` renderer: this code element is a fenced/indented block. */
  forceBlock?: boolean;
};

// `node` is destructured out so react-markdown's hast node never reaches the DOM.
const CodeBlock = ({ node: _node, className, children, forceBlock, ...props }: CodeBlockProps) => {
  const { t } = useTranslation('chat');
  const { isDarkMode } = useTheme();
  const [copied, setCopied] = useState(false);
  // Fenced blocks carry a trailing newline in the tree; trim it so the
  // highlighter doesn't render an empty final line.
  const raw = (Array.isArray(children) ? children.join('') : String(children ?? '')).replace(/\n$/, '');
  // react-markdown v9+ dropped the `inline` prop: block code is whatever the
  // `pre` renderer hands us (forceBlock). Multiline is kept as a safety net.
  const shouldInline = !forceBlock && !/[\r\n]/.test(raw);

  if (shouldInline) {
    return (
      <code
        className={`whitespace-pre-wrap break-words rounded-md border border-border/70 bg-muted px-1.5 py-0.5 font-mono text-[0.875em] text-foreground ${className || ''
          }`}
        {...props}
      >
        {children}
      </code>
    );
  }

  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : 'text';
  const languageLabel = language.charAt(0).toUpperCase() + language.slice(1);

  if (language === 'mermaid') {
    return <MermaidDiagram code={raw} />;
  }

  // beUI code-block chrome (beui.dev/components/agents/code-block): a rounded
  // muted panel with a slim header — file icon, language, copy — over a
  // border-separated code viewport. Tokenizing stays on the app's existing
  // highlighter; radius is the app token (rounded-lg), not the donor's 2xl.
  return (
    <div className="group my-3 w-full overflow-hidden rounded-lg bg-muted/80 text-sm dark:bg-zinc-900">
      <div className="flex h-10 items-center gap-2.5 px-3">
        <FileCode2 aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/70" />
        <span className="select-none text-[10px] font-medium uppercase tracking-wide text-muted-foreground/55">
          {languageLabel}
        </span>
        <button
          type="button"
          onClick={() =>
            copyTextToClipboard(raw).then((success) => {
              if (success) {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }
            })
          }
          className={`ml-auto grid size-7 shrink-0 place-items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${copied
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-muted-foreground hover:bg-background/70 hover:text-foreground focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100'
            }`}
          title={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
          aria-label={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
        >
          <ActionSwapIcon value={copied ? 'copied' : 'copy'} className="size-3.5">
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </ActionSwapIcon>
        </button>
      </div>

      <div className="overflow-auto border-t border-foreground/[0.06] py-2" style={{ maxHeight: 280 }}>
        <SyntaxHighlighter
          language={language}
          style={isDarkMode ? oneDark : oneLight}
          customStyle={{
            margin: 0,
            borderRadius: 0,
            fontSize: '0.75rem',
            lineHeight: '1.25rem',
            padding: '0 1rem 0.5rem',
            // The container owns the background so the header and code read as one panel.
            background: 'transparent',
          }}
          codeTagProps={{
            style: {
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              background: 'transparent',
            },
          }}
        >
          {raw}
        </SyntaxHighlighter>
      </div>
    </div>
  );
};

const markdownComponents = {
  code: CodeBlock,
  // Session-produced images: `![caption](path-or-https-url)` renders inline
  // when its source is supported (see MarkdownInlineImage).
  img: MarkdownImageRenderer,
  // Fenced/indented code arrives as <pre><code>. Re-render the child CodeBlock
  // with `forceBlock` so it always gets the block treatment (react-markdown v9+
  // no longer passes an `inline` flag), and skip the outer <pre> so Tailwind
  // Typography doesn't wrap the highlighter in a second dark shell.
  pre: ({ children }: { children?: React.ReactNode }) => {
    const child = Array.isArray(children) ? children.find(React.isValidElement) : children;
    if (React.isValidElement(child) && child.type === CodeBlock) {
      return <CodeBlock {...(child.props as CodeBlockProps)} forceBlock />;
    }
    return <>{children}</>;
  },
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-3 border-l-2 border-primary/50 pl-4 italic text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-t border-border" />,
  p: ({ children }: { children?: React.ReactNode }) => {
    const meaningfulChildren = React.Children.toArray(children).filter(
      (child) => typeof child !== 'string' || child.trim().length > 0,
    );
    const imageOnly = meaningfulChildren.length > 0 && meaningfulChildren.every(
      (child) => React.isValidElement(child) && child.type === MarkdownImageRenderer,
    );

    if (imageOnly) {
      const compact = meaningfulChildren.length > 1;
      return (
        <div
          data-slot={compact ? 'transcript-image-grid' : 'transcript-image-row'}
          data-image-count={meaningfulChildren.length}
          className={compact ? 'my-3 grid w-fit max-w-full grid-cols-2 gap-2' : 'my-3 max-w-full'}
        >
          {meaningfulChildren.map((child) => React.cloneElement(
            child as React.ReactElement<MarkdownInlineImageProps>,
            { compact },
          ))}
        </div>
      );
    }

    return <div className="mb-2 last:mb-0">{children}</div>;
  },
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-2 list-outside list-disc space-y-1 pl-5 marker:text-current last:mb-0">{children}</ul>
  ),
  ol: ({ start, children }: { start?: number; children?: React.ReactNode }) => (
    // pl-8: outside markers hang left of the list's content edge, and the chat
    // row's paint containment (content-visibility: auto) clips anything past
    // the row's border box — a 1.5rem gutter cut "20." down to "!0.". 2rem
    // holds two- and three-digit markers. `start` passes through so a list
    // resuming at 10 keeps its real numbers.
    <ol start={start} className="mb-2 list-outside list-decimal space-y-1 pl-8 marker:text-current last:mb-0">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li className="[&>div:last-child]:mb-0 [&>div]:mb-1">{children}</li>,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-border">
      {/* my-0 cancels Tailwind Typography's table margin, which would show as blank bands inside the border */}
      <table className="my-0 min-w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-muted/60">{children}</thead>,
  tr: ({ children }: { children?: React.ReactNode }) => (
    <tr className="[&:last-child>td]:border-b-0">{children}</tr>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border-b border-border px-3 py-2 text-left font-semibold text-foreground">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border-b border-border/60 px-3 py-2 align-top">{children}</td>
  ),
};

export function Markdown({ children, className, breaks = false, streamWords = false }: MarkdownProps) {
  const content = normalizeInlineCodeFences(String(children ?? ''));
  const remarkPlugins = useMemo(
    () => (breaks
      ? [remarkGfm, [remarkMath, { singleDollarTextMath: false }], remarkBreaks]
      : [remarkGfm, [remarkMath, { singleDollarTextMath: false }]]) as any,
    [breaks],
  );
  const rehypePlugins = useMemo(
    () => (streamWords ? [rehypeKatex, rehypeStreamWords] : [rehypeKatex]),
    [streamWords],
  );
  const { openFileInEditor } = usePaletteOps();

  const components = useMemo(
    () => ({
      ...markdownComponents,
      a: ({ href, children: linkChildren }: { href?: string; children?: React.ReactNode }) => {
        // Prefer the href when it is a real path; otherwise fall back to the
        // link text, since models often emit `[src/foo.ts]()` with an empty href.
        const linkText = childrenToText(linkChildren);
        const fileRef = looksLikeFilePath(href) ? href : looksLikeFilePath(linkText) ? linkText : undefined;

        if (fileRef && !isExternalHref(href)) {
          return (
            <a
              href={href || fileRef}
              className="cursor-pointer text-primary hover:underline"
              onClick={(event) => {
                event.preventDefault();
                openFileInEditor(stripLineSuffix(fileRef));
              }}
            >
              {linkChildren}
            </a>
          );
        }

        return (
          <a
            href={href}
            className="text-primary hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {linkChildren}
          </a>
        );
      },
    }),
    [openFileInEditor],
  );

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components as any}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
