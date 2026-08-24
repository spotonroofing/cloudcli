import { memo, useMemo, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

import type {
  ChatMessage,
  ClaudePermissionSuggestion,
  PermissionGrantResult,
  Provider,
} from '../../types/types';
import { extractExternalLinks, formatUsageLimitText, stripProposedPlanEnvelope } from '../../utils/chatFormatting';
import type { Project } from '../../../../types/app';
import { ToolRenderer, ToolErrorDisplay, shouldHideToolResult } from '../../tools';
import { MESSAGE_POP_UP, StreamingResponse, Thinking, useStreamedReveal } from '../../../../shared/view/beui';
import type { ThinkingRow } from '../../../../shared/view/beui';
import { Citations } from '../../../../shared/view/beui/Citations';

import ChatMessageImages from './ChatMessageImages';
import ChatMessageFiles from './ChatMessageFiles';
import { Markdown } from './Markdown';
import MessageCopyControl from './MessageCopyControl';
import MessageSpeakControl from './MessageSpeakControl';

type DiffLine = {
  type: string;
  content: string;
  lineNum: number;
};

type MessageComponentProps = {
  message: ChatMessage;
  /** Rows stamped after this epoch play the beUI pop-up on mount; history renders statically. */
  animateFrom?: number;
  prevMessage: ChatMessage | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission?: (suggestion: ClaudePermissionSuggestion) => PermissionGrantResult | null | undefined;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject?: Project | null;
  provider: Provider | string;
  /** The user prompt that produced this assistant turn; enables the rerun action. */
  rerunContent?: string;
  onRerun?: (content: string, event: ReactMouseEvent) => void;
};

type InteractiveOption = {
  number: string;
  text: string;
  isSelected: boolean;
};

const COPY_HIDDEN_TOOL_NAMES = new Set(['Bash', 'Edit', 'Write', 'ApplyPatch']);

/**
 * Live assistant turn: the reveal engine paces the growing buffer while the
 * beautifului streaming-text treatment blurs each word in and keeps a caret
 * at the live edge.
 */
function StreamingAssistantText({ content }: { content: string }) {
  const cursor = useStreamedReveal(content);
  return (
    <StreamingResponse status="streaming" announce={false} contentClassName="bui-stream-caret-host">
      <Markdown streamWords className="prose prose-sm prose-gray max-w-none font-serif dark:prose-invert">
        {content.slice(0, cursor)}
      </Markdown>
    </StreamingResponse>
  );
}

const parseToolInputObject = (toolInput: unknown): Record<string, any> => {
  if (typeof toolInput !== 'string') return (toolInput as Record<string, any>) || {};
  try {
    return JSON.parse(toolInput);
  } catch {
    return {};
  }
};

const domainOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

const SEARCH_TRACE_MAX_ROWS = 6;

/**
 * WebSearch / WebFetch turns render as the beautifului Thinking trace in its
 * search mode: the query line, then favicon rows for the sources read.
 */
function SearchToolThinking({ message }: { message: ChatMessage }) {
  const input = useMemo(() => parseToolInputObject(message.toolInput), [message.toolInput]);
  const isFetch = message.toolName === 'WebFetch';
  const working = !message.toolResult;
  const failed = Boolean(message.toolResult?.isError);
  const query = isFetch ? String(input.url || '') : String(input.query || '');

  const { rows, extraCount } = useMemo(() => {
    if (working || failed) return { rows: [] as ThinkingRow[], extraCount: 0 };
    if (isFetch) {
      const url = String(input.url || '');
      const domain = domainOf(url);
      if (!domain) return { rows: [] as ThinkingRow[], extraCount: 0 };
      return {
        rows: [{ key: url, primary: domain, href: url, faviconUrl: url } satisfies ThinkingRow],
        extraCount: 0,
      };
    }
    // WebSearch results carry their links as a `Links: [...]` JSON block.
    const content = String(message.toolResult?.content || '');
    const linksMatch = /Links:\s*(\[[\s\S]*?\])\s*(?:\n|$)/.exec(content);
    if (!linksMatch) return { rows: [] as ThinkingRow[], extraCount: 0 };
    try {
      const links = JSON.parse(linksMatch[1]) as Array<{ title?: string; url?: string }>;
      const usable = links.filter((link) => typeof link.url === 'string' && domainOf(link.url));
      const rows = usable.slice(0, SEARCH_TRACE_MAX_ROWS).map((link) => ({
        key: link.url as string,
        primary: link.title || domainOf(link.url as string),
        secondary: domainOf(link.url as string),
        href: link.url,
        faviconUrl: link.url,
      } satisfies ThinkingRow));
      return { rows, extraCount: Math.max(0, usable.length - rows.length) };
    } catch {
      return { rows: [] as ThinkingRow[], extraCount: 0 };
    }
  }, [working, failed, isFetch, input.url, message.toolResult]);

  return (
    <Thinking
      mode="search"
      working={working}
      activeLabel={isFetch ? 'Reading the page' : 'Searching the web'}
      doneLabel={failed
        ? (isFetch ? 'Page fetch failed' : 'Search failed')
        : (isFetch ? 'Read the page' : 'Searched the web')}
      query={query}
      rows={rows}
      footer={extraCount > 0 ? (
        <span className="px-1.5 text-[12px] text-muted-foreground/70">+{extraCount} more</span>
      ) : undefined}
    />
  );
}

/**
 * beUI citations strip under an assistant turn whose markdown carries external
 * http(s) links — one strip per message, deduped by URL. Inline links in the
 * prose stay untouched.
 */
function AssistantCitations({ content }: { content: string }) {
  const citations = useMemo(
    () =>
      extractExternalLinks(content).map((link) => ({
        id: link.url,
        title: link.title,
        domain: link.domain,
        url: link.url,
      })),
    [content],
  );

  if (citations.length === 0) return null;

  return <Citations citations={citations} className="mt-2" />;
}

const MessageComponent = memo(({ message, animateFrom, prevMessage, createDiff, onFileOpen, showRawParameters, showThinking, selectedProject, provider, rerunContent, onRerun }: MessageComponentProps) => {
  const { t } = useTranslation('chat');
  const reduceMotion = useReducedMotion() ?? false;
  // Evaluated once per mount: a row that pops in must not replay on re-render.
  const animateInRef = useRef<boolean | null>(null);
  if (animateInRef.current === null) {
    const stamp = message.timestamp ? new Date(message.timestamp).getTime() : 0;
    animateInRef.current = Boolean(animateFrom && stamp > animateFrom && !reduceMotion);
  }
  const animateIn = animateInRef.current;
  const isGrouped = prevMessage && prevMessage.type === message.type &&
    ((prevMessage.type === 'assistant') ||
      (prevMessage.type === 'user') ||
      (prevMessage.type === 'tool') ||
      (prevMessage.type === 'error'));
  const messageRef = useRef<HTMLDivElement | null>(null);
  const userCopyContent = String(message.content || '');
  const formattedMessageContent = useMemo(
    () => {
      const content = formatUsageLimitText(String(message.content || ''));
      return provider === 'codex' && message.type === 'assistant' && !message.isThinking
        ? stripProposedPlanEnvelope(content)
        : content;
    },
    [message.content, message.isThinking, message.type, provider]
  );
  const assistantCopyContent = message.isToolUse
    ? String(message.displayText || message.content || '')
    : formattedMessageContent;
  const isCommandOrFileEditToolResponse = Boolean(
    message.isToolUse && COPY_HIDDEN_TOOL_NAMES.has(String(message.toolName || ''))
  );
  const shouldShowUserCopyControl = message.type === 'user' && userCopyContent.trim().length > 0;
  const shouldShowAssistantCopyControl = message.type === 'assistant' &&
    assistantCopyContent.trim().length > 0 &&
    !isCommandOrFileEditToolResponse &&
    !message.isThinking;


  const formattedTime = useMemo(() => new Date(message.timestamp).toLocaleTimeString(), [message.timestamp]);
  const shouldHideThinkingMessage = Boolean(message.isThinking && !showThinking);

  if (shouldHideThinkingMessage) {
    return null;
  }

  return (
    <motion.div
      ref={messageRef}
      data-message-timestamp={message.timestamp || undefined}
      initial={animateIn ? { opacity: 0, transform: 'translateY(8px) scale(0.95)' } : false}
      animate={animateIn ? { opacity: 1, transform: 'translateY(0px) scale(1)' } : undefined}
      transition={MESSAGE_POP_UP}
      style={{ transformOrigin: message.type === 'user' ? '100% 100%' : '0% 100%' }}
      className={`chat-message group ${message.type} ${isGrouped ? 'grouped' : ''} ${message.type === 'user' ? 'flex justify-end px-3 sm:px-0' : 'px-3 sm:px-0'}`}
    >
      {message.type === 'user' ? (
        /* User turn on the right: claude.ai-style attachment cards above the bubble */
        <div className="flex w-full items-end sm:w-auto sm:max-w-[85%] md:max-w-md lg:max-w-lg xl:max-w-xl">
          <div className="flex min-w-0 flex-1 flex-col items-end gap-2 sm:flex-initial">
            {message.images && message.images.length > 0 && (
              <ChatMessageImages
                images={message.images}
                projectId={selectedProject?.projectId}
              />
            )}
            {message.files && message.files.length > 0 && (
              <ChatMessageFiles files={message.files} />
            )}
            {userCopyContent.trim().length > 0 || (!message.images?.length && !message.files?.length) ? (
              /* Meta (copy + timestamp) sits below the bubble, outside it; the
                 hover fades key off the row-level `group` on the message root */
              <>
                <div className="max-w-full rounded-lg bg-secondary px-3 py-2 text-secondary-foreground sm:px-4">
                  <div dir="auto" className="break-words font-serif text-sm">
                    <Markdown
                      breaks
                      className="prose prose-sm max-w-none font-serif dark:prose-invert [&_a]:underline"
                    >
                      {message.content}
                    </Markdown>
                  </div>
                </div>
                <div className="-mt-1 flex items-center justify-end gap-1 text-xs text-muted-foreground">
                  {shouldShowUserCopyControl && (
                    <MessageCopyControl content={userCopyContent} messageType="user" />
                  )}
                  <span className="opacity-0 transition-opacity duration-200 group-hover:opacity-100">{formattedTime}</span>
                </div>
              </>
            ) : (
              /* Attachment-only turn: no text bubble, but the timestamp still shows on hover */
              <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                <span className="opacity-0 transition-opacity duration-200 group-hover:opacity-100">{formattedTime}</span>
              </div>
            )}
          </div>
        </div>
      ) : message.isTaskNotification ? (
        /* Compact task notification on the left */
        <div className="w-full">
          <div className="flex items-center gap-2 py-0.5">
            <span className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${message.taskStatus === 'completed' ? 'bg-green-400 dark:bg-green-500' : 'bg-amber-400 dark:bg-amber-500'}`} />
            <span className="text-xs text-gray-500 dark:text-gray-400">{message.content}</span>
          </div>
        </div>
      ) : (
        /* Claude/Error/Tool messages on the left */
        <div className="w-full">
          {!isGrouped && message.type !== 'assistant' && (
            <div className="mb-2 flex items-center space-x-3">
              {message.type === 'error' ? (
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-red-600 text-sm text-white">
                  !
                </div>
              ) : (
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-600 text-sm text-white dark:bg-gray-700">
                  🔧
                </div>
              )}
              <div className="text-sm font-medium text-gray-900 dark:text-white">
                {message.type === 'error' ? t('messageTypes.error') : t('messageTypes.tool')}
              </div>
            </div>
          )}

          <div className="w-full">

            {message.isToolUse && (message.toolName === 'WebSearch' || message.toolName === 'WebFetch') ? (
              /* Web reads render as the beautifului Thinking trace (search mode) */
              <SearchToolThinking message={message} />
            ) : message.isToolUse ? (
              <>
                <div className="flex flex-col">
                  <div className="flex flex-col">
                    <Markdown className="prose prose-sm max-w-none font-serif dark:prose-invert">
                      {String(message.displayText || '')}
                    </Markdown>
                  </div>
                </div>

                {message.toolInput && (
                  <ToolRenderer
                    toolName={message.toolName || 'UnknownTool'}
                    toolInput={message.toolInput}
                    toolResult={message.toolResult}
                    toolId={message.toolId}
                    mode="input"
                    onFileOpen={onFileOpen}
                    createDiff={createDiff}
                    selectedProject={selectedProject}
                    showRawParameters={showRawParameters}
                    rawToolInput={typeof message.toolInput === 'string' ? message.toolInput : undefined}
                    isSubagentContainer={message.isSubagentContainer}
                    subagentState={message.subagentState}
                  />
                )}

                {/* Tool Result Section — Bash renders its output inside the command row
                    above; a subagent's result already shows in its steps-trace footer. */}
                {message.toolResult && message.toolName !== 'Bash' && !message.isSubagentContainer && !shouldHideToolResult(message.toolName || 'UnknownTool', message.toolResult) && (
                  message.toolResult.isError ? (
                    // Error results — collapsed red row that expands to the content
                    <div id={`tool-result-${message.toolId}`} className="scroll-mt-4">
                      <ToolErrorDisplay
                        label={t('messageTypes.error')}
                        content={String(message.toolResult.content || '')}
                      />
                    </div>
                  ) : (
                    // Non-error results - route through ToolRenderer (single source of truth)
                    <div id={`tool-result-${message.toolId}`} className="scroll-mt-4">
                      <ToolRenderer
                        toolName={message.toolName || 'UnknownTool'}
                        toolInput={message.toolInput}
                        toolResult={message.toolResult}
                        toolId={message.toolId}
                        mode="result"
                        onFileOpen={onFileOpen}
                        createDiff={createDiff}
                        selectedProject={selectedProject}
                      />
                    </div>
                  )
                )}
              </>
            ) : message.isInteractivePrompt ? (
              // Special handling for interactive prompts
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-amber-500">
                    <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h4 className="mb-3 text-base font-semibold text-amber-900 dark:text-amber-100">
                      {t('interactive.title')}
                    </h4>
                    {(() => {
                      const lines = (message.content || '').split('\n').filter((line) => line.trim());
                      const questionLine = lines.find((line) => line.includes('?')) || lines[0] || '';
                      const options: InteractiveOption[] = [];

                      // Parse the menu options
                      lines.forEach((line) => {
                        // Match lines like "❯ 1. Yes" or "  2. No"
                        const optionMatch = line.match(/[❯\s]*(\d+)\.\s+(.+)/);
                        if (optionMatch) {
                          const isSelected = line.includes('❯');
                          options.push({
                            number: optionMatch[1],
                            text: optionMatch[2].trim(),
                            isSelected
                          });
                        }
                      });

                      return (
                        <>
                          <p className="mb-4 text-sm text-amber-800 dark:text-amber-200">
                            {questionLine}
                          </p>

                          {/* Option buttons */}
                          <div className="mb-4 space-y-2">
                            {options.map((option) => (
                              <button
                                key={option.number}
                                className={`w-full rounded-lg border-2 px-4 py-3 text-left transition-all ${option.isSelected
                                  ? 'border-amber-600 bg-amber-600 text-white shadow-md dark:border-amber-700 dark:bg-amber-700'
                                  : 'border-amber-300 bg-white text-amber-900 dark:border-amber-700 dark:bg-gray-800 dark:text-amber-100'
                                  } cursor-not-allowed opacity-75`}
                                disabled
                              >
                                <div className="flex items-center gap-3">
                                  <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${option.isSelected
                                    ? 'bg-white/20'
                                    : 'bg-amber-100 dark:bg-amber-800/50'
                                    }`}>
                                    {option.number}
                                  </span>
                                  <span className="flex-1 text-sm font-medium sm:text-base">
                                    {option.text}
                                  </span>
                                  {option.isSelected && (
                                    <span className="text-lg">❯</span>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>

                          <div className="rounded-lg bg-amber-100 p-3 dark:bg-amber-800/30">
                            <p className="mb-1 text-sm font-medium text-amber-900 dark:text-amber-100">
                              {t('interactive.waiting')}
                            </p>
                            <p className="text-xs text-amber-800 dark:text-amber-200">
                              {t('interactive.instruction')}
                            </p>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            ) : message.isThinking ? (
              /* Thinking blocks — beautifului Thinking trace (reasoning mode) */
              <Thinking
                mode="reasoning"
                working={false}
                activeLabel={t('claudeStatus.actions.thinking', { defaultValue: 'Thinking' })}
                doneLabel={t('claudeStatus.thought', { defaultValue: 'Thought for a few seconds' })}
              >
                <Markdown className="prose prose-sm prose-gray max-w-none font-serif dark:prose-invert">
                  {message.content}
                </Markdown>
                <div className="mt-2 flex items-center text-[11px]">
                  <MessageCopyControl content={String(message.content || '')} messageType="assistant" />
                </div>
              </Thinking>
            ) : (
              <div dir="auto" className="text-sm text-gray-700 dark:text-gray-300">
                {/* Reasoning trace (non-Claude providers) */}
                {showThinking && message.reasoning && (
                  <Thinking
                    className="mb-3"
                    mode="reasoning"
                    working={false}
                    activeLabel={t('claudeStatus.actions.thinking', { defaultValue: 'Thinking' })}
                    doneLabel={t('claudeStatus.thought', { defaultValue: 'Thought for a few seconds' })}
                  >
                    <div className="whitespace-pre-wrap">
                      {message.reasoning}
                    </div>
                  </Thinking>
                )}

                {(() => {
                  const content = formattedMessageContent;

                  // Detect if content is pure JSON (starts with { or [)
                  const trimmedContent = content.trim();
                  if ((trimmedContent.startsWith('{') || trimmedContent.startsWith('[')) &&
                    (trimmedContent.endsWith('}') || trimmedContent.endsWith(']'))) {
                    try {
                      const parsed = JSON.parse(trimmedContent);
                      const formatted = JSON.stringify(parsed, null, 2);

                      return (
                        <div className="my-2">
                          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                            <span className="font-medium">{t('json.response')}</span>
                          </div>
                          <div className="overflow-hidden rounded-lg border border-border bg-muted">
                            <pre className="overflow-x-auto p-4">
                              <code className="block whitespace-pre font-mono text-sm text-foreground">
                                {formatted}
                              </code>
                            </pre>
                          </div>
                        </div>
                      );
                    } catch {
                      // Not valid JSON, fall through to normal rendering
                    }
                  }

                  // Normal rendering for non-JSON content
                  return message.type === 'assistant' ? (
                    message.isStreaming ? (
                      <StreamingAssistantText content={content} />
                    ) : (
                      <>
                        <Markdown className="prose prose-sm prose-gray max-w-none font-serif dark:prose-invert">
                          {content}
                        </Markdown>
                        <AssistantCitations content={content} />
                      </>
                    )
                  ) : (
                    <div className="whitespace-pre-wrap">
                      {content}
                    </div>
                  );
                })()}
              </div>
            )}

            {(shouldShowAssistantCopyControl || !isGrouped) && (
              <div className="mt-1 flex w-full items-center gap-2 text-[11px] text-gray-400 dark:text-gray-500">
                {shouldShowAssistantCopyControl && (
                  <MessageCopyControl content={assistantCopyContent} messageType="assistant" />
                )}
                {shouldShowAssistantCopyControl && (
                  <MessageSpeakControl content={assistantCopyContent} />
                )}
                {shouldShowAssistantCopyControl && !message.isStreaming && onRerun && rerunContent && (
                  /* Rerun: send the prompt that produced this turn again (beautifului action row) */
                  <div className="relative flex items-center opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(event) => onRerun(rerunContent, event)}
                      title={t('rerunMessage', { defaultValue: 'Rerun' })}
                      aria-label={t('rerunMessage', { defaultValue: 'Rerun' })}
                      className="inline-flex items-center rounded px-1 py-0.5 text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {!isGrouped && (
                  <span className="ml-auto opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    {formattedTime}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
});

export default MessageComponent;

