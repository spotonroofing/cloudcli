import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, BookMarked, ChevronDown, CircleCheck, Clock3, Cpu, Info, Pencil, RotateCcw, Wrench } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

import type {
  ChatMessage,
  ClaudePermissionSuggestion,
  PermissionGrantResult,
  Provider,
} from '../../types/types';
import { extractExternalLinks, formatUsageLimitText, stripProposedPlanEnvelope } from '../../utils/chatFormatting';
import type { Project } from '../../../../types/app';
import { ToolRenderer, ToolErrorDisplay, ResearchDisplay, shouldHideToolResult } from '../../tools';
import { AgentDisclosure, MESSAGE_POP_UP, SPRING_SWAP, Thinking, TranscriptIndicatorRow } from '../../../../shared/view/beui';
import { Citations } from '../../../../shared/view/beui/Citations';
import { Button } from '../../../../shared/view/ui';

import ChatMessageImages from './ChatMessageImages';
import ChatMessageFiles from './ChatMessageFiles';
import { Markdown } from './Markdown';
import MessageCopyControl from './MessageCopyControl';
import MessageSpeakControl from './MessageSpeakControl';
import StatusDuration from './StatusDuration';

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
  /** True when this is the turn's final assistant text — the only assistant row that carries copy + timestamp. */
  isTurnFinal?: boolean;
  /** Rerun on user rows: resends that row's own prompt through the submit path. */
  onRerun?: (content: string, event: ReactMouseEvent) => void;
  /** Pencil on user turns: opens the inline transcript editor on that bubble. */
  onEditMessage?: (message: ChatMessage) => void;
  /** Id of the user message currently in inline edit mode (one at a time). */
  editingMessageId?: string | null;
  /** Save from the inline editor: resends through edit-and-resend versioning. */
  onSaveEditMessage?: (message: ChatMessage, content: string) => void;
  /** Cancel/Escape from the inline editor: restores the original bubble. */
  onCancelEditMessage?: () => void;
  /** True only for rows in the currently running tail turn. */
  isTurnRunning?: boolean;
};

type InteractiveOption = {
  number: string;
  text: string;
  isSelected: boolean;
};

const COPY_HIDDEN_TOOL_NAMES = new Set(['Bash', 'Edit', 'Write', 'ApplyPatch']);

/**
 * One reveal rule for message furniture (copy, speak, edit, rerun, timestamp):
 * hover-revealed on fine pointers, always visible on coarse pointers.
 */
export const META_REVEAL_CLASS = 'transition-opacity duration-200 opacity-0 group-hover:opacity-100 touch:opacity-100';

/**
 * Small marker row at the point a turn was killed mid-response (stop button,
 * server restart, process death). Rendered for explicit transcript markers and
 * for a dead tool-call tail on reload.
 */
export function InterruptedMarker() {
  const { t } = useTranslation('chat');
  return (
    <div data-slot="interrupted-marker" className="my-0.5">
      <TranscriptIndicatorRow
        kind="interrupted"
        glyph={<Ban className="size-3.5" />}
        label={t('interrupted', { defaultValue: 'Interrupted' })}
      />
    </div>
  );
}

/**
 * Marker row where a session wrote memory (ui12 phase 7; ui13 job 8): the
 * server detects the write, so the row never relies on the model announcing
 * itself. Rendered on the beUI Thinking trace so it shares the
 * "Thought for a few seconds" row anatomy exactly (icon slot, type, chevron,
 * expand behavior); the files live behind the expand, one row each.
 */
export function MemoryUpdatedMarker({
  files,
  diffs = {},
  durationMs,
}: {
  files: string[];
  diffs?: Record<string, string[]>;
  durationMs?: number;
}) {
  const { t } = useTranslation('chat');
  return (
    <div data-slot="memory-updated-marker">
      <Thinking
        mode="coding"
        kind="memory"
        working={false}
        icon={<BookMarked aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />}
        activeLabel={t('memoryUpdated', { defaultValue: 'Memory updated' })}
        doneLabel={t('memoryUpdated', { defaultValue: 'Memory updated' })}
        meta={<StatusDuration durationMs={durationMs} />}
        footer={files.map((file) => {
          // One trace row per file (the Thinking row anatomy), and under it
          // the server's excerpt of the real change (ui14 job 3): plain diff
          // lines from the file's before/after, never a summary the model wrote.
          const excerpt = diffs[file] ?? [];
          return (
            <div key={file} data-slot="memory-updated-file">
              <div className="flex min-h-7 w-full items-center gap-2 rounded-md px-1.5 py-0.5 text-left">
                <span className="min-w-0 truncate text-xs font-medium text-foreground">{file}</span>
              </div>
              {excerpt.length > 0 && (
                <pre
                  data-slot="memory-updated-diff"
                  className="mb-1 whitespace-pre-wrap break-words px-1.5 font-mono text-[11px] leading-4 text-muted-foreground/70"
                >
                  {excerpt.join('\n')}
                </pre>
              )}
            </div>
          );
        })}
      />
    </div>
  );
}

/** Machine-to-planner prompt: compact meta row, never a user bubble. */
function MachineMessageRow({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  const summary = content.replace(/\s+/g, ' ').trim();
  return (
    <div data-slot="machine-message-row" data-origin="watchdog" className="my-0.5 w-full">
      <TranscriptIndicatorRow
        kind="watchdog"
        glyph={<Cpu className="size-3.5" />}
        label="Watchdog"
        detail={summary}
        expandable
        expanded={open}
        onToggle={() => setOpen((current) => !current)}
      />
      <AgentDisclosure open={open}>
        <div className="pl-6 pt-1.5">
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/80 p-3 font-mono text-[11px] leading-4 text-muted-foreground/80">
            {content}
          </pre>
        </div>
      </AgentDisclosure>
    </div>
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

/**
 * Compact command bubble (ui11 phase 3): a slash command renders as its name
 * and one-line description inside the standard user bubble; the expanded
 * command text sits behind a spring-rotated chevron and never shows by
 * default. Identical for live optimistic echoes and reloaded transcripts.
 */
function UserCommandBubble({ message }: { message: ChatMessage }) {
  const reduce = useReducedMotion() ?? false;
  const [expanded, setExpanded] = useState(false);
  const body = String(message.commandBody || '');
  const description = String(message.commandMessage || '').trim();
  const hasBody = body.trim().length > 0;
  const toggle = () => {
    if (hasBody) setExpanded((previous) => !previous);
  };

  return (
    <div
      data-slot="command-bubble"
      className="max-w-full rounded-lg bg-secondary px-3 py-2 text-secondary-foreground sm:px-4"
    >
      {/* Whole header toggles, like every expandable row (Bash reference);
          the chevron sits in the shared size-4 trailing slot. */}
      <div
        role={hasBody ? 'button' : undefined}
        tabIndex={hasBody ? 0 : undefined}
        aria-expanded={hasBody ? expanded : undefined}
        onClick={toggle}
        onKeyDown={(event) => {
          if (hasBody && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            toggle();
          }
        }}
        className={`flex min-w-0 items-center gap-2 outline-none ${hasBody ? 'cursor-pointer rounded-md focus-visible:ring-2 focus-visible:ring-ring' : ''}`}
      >
        <span className="whitespace-nowrap font-mono text-sm">{message.content}</span>
        {description && (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{description}</span>
        )}
        {hasBody && (
          <span className="touch-hit relative ml-auto grid size-4 flex-shrink-0 place-items-center">
            <motion.span
              aria-hidden="true"
              animate={{ rotate: expanded ? 180 : 0 }}
              transition={reduce ? { duration: 0 } : SPRING_SWAP}
              className="text-muted-foreground/50"
            >
              <ChevronDown className="size-3.5" />
            </motion.span>
          </span>
        )}
      </div>
      {hasBody && (
        <AgentDisclosure open={expanded}>
          <div className="mt-2 max-h-[280px] overflow-y-auto rounded-lg bg-muted/80 p-2">
            <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground">{body}</pre>
          </div>
        </AgentDisclosure>
      )}
    </div>
  );
}

/**
 * Inline transcript editor (ui11 phase 13): the pencil swaps the user bubble
 * for this editable box, claude.ai-style — the editor, then an info / Cancel /
 * Save row below it. The composer draft is never touched; Save resends through
 * edit-and-resend versioning, Cancel and Escape restore the original bubble.
 */
function UserMessageEditor({ initialText, onCancel, onSave }: {
  initialText: string;
  onCancel: () => void;
  onSave: (text: string) => void;
}) {
  const { t } = useTranslation('chat');
  const [text, setText] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const autosize = (element: HTMLTextAreaElement) => {
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  };

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    autosize(element);
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
    // Keeps the editor visible above a phone keyboard.
    element.scrollIntoView({ block: 'nearest' });
  }, []);

  const canSave = text.trim().length > 0;

  return (
    <div data-slot="message-edit" className="flex w-full flex-col gap-2">
      <div className="w-full rounded-lg border border-muted-foreground/40 bg-secondary shadow-md ring-1 ring-muted-foreground/20">
        <textarea
          spellCheck={false}
          autoCorrect="off"
          ref={textareaRef}
          value={text}
          dir="auto"
          rows={1}
          aria-label={t('editMessage', { defaultValue: 'Edit message' })}
          className="block w-full resize-none overflow-hidden bg-transparent px-3 py-2 font-serif text-base text-secondary-foreground outline-none sm:px-4 sm:text-sm"
          onChange={(event) => {
            setText(event.target.value);
            autosize(event.target);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              if (canSave) onSave(text);
            }
          }}
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <span
          className="text-muted-foreground/70"
          title={t('editMessageInfo', { defaultValue: 'Saving resends this message as a new version; earlier versions stay reachable.' })}
        >
          <Info className="h-3.5 w-3.5" aria-hidden />
        </span>
        <Button type="button" variant="ghost" size="sm" className="touch-hit relative" onClick={onCancel}>
          {t('editMessageCancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button type="button" size="sm" className="touch-hit relative" disabled={!canSave} onClick={() => onSave(text)}>
          {t('editMessageSave', { defaultValue: 'Save' })}
        </Button>
      </div>
    </div>
  );
}

const MessageComponent = memo(({ message, animateFrom, prevMessage, createDiff, onFileOpen, showRawParameters, showThinking, selectedProject, provider, isTurnFinal, onRerun, onEditMessage, editingMessageId, onSaveEditMessage, onCancelEditMessage, isTurnRunning = false }: MessageComponentProps) => {
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
  // The pencil needs a settled transcript row (a stable id to anchor the
  // version group) and a text-only turn — an edited resend carries no files.
  const shouldShowUserEditControl =
    shouldShowUserCopyControl
    && !message.isLocalCommand
    && Boolean(onEditMessage)
    && typeof message.id === 'string'
    && !message.id.startsWith('local_')
    && !message.images?.length
    && !message.files?.length;
  const shouldShowAssistantCopyControl = message.type === 'assistant' &&
    assistantCopyContent.trim().length > 0 &&
    !isCommandOrFileEditToolResponse &&
    !message.isThinking;


  // Inline edit mode (ui11 phase 13): this row's bubble renders as the editor.
  const isEditingThis = Boolean(
    editingMessageId
    && message.type === 'user'
    && typeof message.id === 'string'
    && message.id === editingMessageId,
  );

  const formattedTime = useMemo(() => new Date(message.timestamp).toLocaleTimeString(), [message.timestamp]);
  const shouldHideThinkingMessage = Boolean(message.isThinking && !showThinking);

  if (shouldHideThinkingMessage) {
    return null;
  }

  if (message.isInterruptMarker) {
    return (
      <div className="chat-message assistant px-3 sm:px-0" data-message-timestamp={message.timestamp || undefined}>
        <InterruptedMarker />
      </div>
    );
  }

  if (message.messageOrigin === 'watchdog') {
    return (
      <div className="chat-message machine px-3 sm:px-0" data-message-timestamp={message.timestamp || undefined}>
        <MachineMessageRow content={formattedMessageContent} />
      </div>
    );
  }

  // One error row for the whole app (ui14 job 12): every session-level error
  // — limit messages, provider errors, anything that used to render as the
  // red "Error" block — is the same themed tool-row anatomy: leading red
  // icon, short label, one-line summary, chevron; collapsed by default.
  if (message.type === 'error') {
    return (
      <div className="chat-message error px-3 sm:px-0" data-message-timestamp={message.timestamp || undefined}>
        <ToolErrorDisplay label={t('messageTypes.error')} content={formattedMessageContent} />
      </div>
    );
  }

  if (message.isMemoryUpdate) {
    return (
      <div className="chat-message assistant px-3 sm:px-0" data-message-timestamp={message.timestamp || undefined}>
        <MemoryUpdatedMarker
          files={Array.isArray(message.memoryFiles) ? message.memoryFiles : []}
          diffs={message.memoryDiffs}
          durationMs={message.durationMs}
        />
      </div>
    );
  }

  return (
    <motion.div
      ref={messageRef}
      data-message-id={message.id || undefined}
      data-message-timestamp={message.timestamp || undefined}
      initial={animateIn ? { opacity: 0, transform: 'translateY(8px) scale(0.95)' } : false}
      animate={animateIn ? { opacity: 1, transform: 'translateY(0px) scale(1)' } : undefined}
      transition={MESSAGE_POP_UP}
      style={{ transformOrigin: message.type === 'user' ? '100% 100%' : '0% 100%' }}
      className={`chat-message group ${message.type} ${message.isToolUse ? 'tool-row' : ''} ${isGrouped ? 'grouped' : ''} ${message.type === 'user' ? 'flex justify-end px-3 sm:px-0' : 'px-3 sm:px-0'}`}
    >
      {message.type === 'user' ? (
        /* User turn on the right: claude.ai-style attachment cards above the bubble.
           Edit mode fills the column width so the editor gets a stable box. */
        <div className={`flex w-full items-end ${isEditingThis ? '' : 'sm:w-auto'} sm:max-w-[85%] md:max-w-md lg:max-w-lg xl:max-w-xl`}>
          <div className={`flex min-w-0 flex-1 flex-col items-end gap-2 ${isEditingThis ? '' : 'sm:flex-initial'}`}>
            {/* One card row for the whole turn, the way the composer stacks
                them: images and other files wrap together, never in two bands. */}
            {((message.images?.length ?? 0) > 0 || (message.files?.length ?? 0) > 0) && (
              <div className="flex max-w-full flex-wrap justify-end gap-2">
                {message.images && message.images.length > 0 && (
                  <ChatMessageImages
                    images={message.images}
                    projectId={selectedProject?.projectId}
                  />
                )}
                {message.files && message.files.length > 0 && (
                  <ChatMessageFiles files={message.files} />
                )}
              </div>
            )}
            {isEditingThis ? (
              <UserMessageEditor
                initialText={userCopyContent}
                onCancel={() => onCancelEditMessage?.()}
                onSave={(text) => onSaveEditMessage?.(message, text)}
              />
            ) : userCopyContent.trim().length > 0 || (!message.images?.length && !message.files?.length) ? (
              /* Meta (edit pencil, copy, rerun) sits below the bubble, outside it;
                 the hover fades key off the row-level `group` on the message root */
              <>
                {message.isLocalCommand ? (
                  <UserCommandBubble message={message} />
                ) : (
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
                )}
                <div className="-mt-1 flex items-center justify-end gap-1 text-xs text-muted-foreground">
                  {shouldShowUserEditControl && (
                    <div className={`relative flex items-center ${META_REVEAL_CLASS}`}>
                      <button
                        type="button"
                        onClick={() => onEditMessage?.(message)}
                        title={t('editMessage', { defaultValue: 'Edit message' })}
                        aria-label={t('editMessage', { defaultValue: 'Edit message' })}
                        className="inline-flex items-center rounded px-1 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  {shouldShowUserCopyControl && (
                    <MessageCopyControl content={userCopyContent} messageType="user" />
                  )}
                  {shouldShowUserCopyControl && !message.isLocalCommand && onRerun && (
                    /* Rerun this prompt: resend it through the submit path (ui13 job 13) */
                    <div className={`relative flex items-center ${META_REVEAL_CLASS}`}>
                      <button
                        type="button"
                        onClick={(event) => onRerun(userCopyContent, event)}
                        title={t('rerunMessage', { defaultValue: 'Rerun' })}
                        aria-label={t('rerunMessage', { defaultValue: 'Rerun' })}
                        className="inline-flex items-center rounded px-1 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : message.isTaskNotification ? (
        /* Compact task notification on the left */
        <div className="my-0.5 w-full">
          <TranscriptIndicatorRow
            kind="task-status"
            glyph={message.taskStatus === 'completed'
              ? <CircleCheck className="size-3.5" />
              : <Clock3 className="size-3.5" />}
            label="Task"
            detail={message.content}
          />
        </div>
      ) : (
        /* Claude/Error/Tool messages on the left */
        <div className="w-full">
          {!isGrouped && message.type !== 'assistant' && (
            <div className="mb-2 flex items-center space-x-3">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
                <Wrench className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="text-sm font-medium text-foreground">{t('messageTypes.tool')}</div>
            </div>
          )}

          <div className="w-full">

            {message.isToolUse && (message.toolName === 'WebSearch' || message.toolName === 'WebFetch') ? (
              /* Web reads render as the Research tool row with real sources */
              <ResearchDisplay
                toolName={message.toolName}
                toolInput={message.toolInput}
                toolResult={message.toolResult}
                startedAt={message.timestamp}
                durationMs={message.durationMs}
                running={isTurnRunning && !message.toolResult}
              />
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
                    startedAt={message.timestamp}
                    durationMs={message.durationMs}
                    isRunning={isTurnRunning && !message.toolResult}
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
                doneLabel={t('claudeStatus.thought', { defaultValue: 'Thought for' })}
                meta={<StatusDuration durationMs={message.durationMs} />}
              >
                <Markdown className="prose prose-sm prose-gray max-w-none font-serif dark:prose-invert">
                  {message.content}
                </Markdown>
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
                    doneLabel={t('claudeStatus.thought', { defaultValue: 'Thought for' })}
                    meta={<StatusDuration durationMs={message.durationMs} />}
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
                    <>
                      <Markdown fileCards className="prose prose-sm prose-gray max-w-none font-serif dark:prose-invert">
                        {content}
                      </Markdown>
                      <AssistantCitations content={content} />
                    </>
                  ) : (
                    <div className="whitespace-pre-wrap">
                      {content}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Action-button law (ui13 job 13): only the turn's FINAL assistant
                text carries a meta line — copy and timestamp, hover-revealed.
                Intermediate assistant texts, error rows, and every tool row
                carry nothing; assistant rows never get rerun. */}
            {!message.isToolUse && isTurnFinal && shouldShowAssistantCopyControl && (
              <div className="mt-1 flex w-full items-center gap-2 text-[11px] text-gray-400 dark:text-gray-500">
                <MessageCopyControl content={assistantCopyContent} messageType="assistant" />
                <MessageSpeakControl content={assistantCopyContent} />
                <span className={`ml-auto ${META_REVEAL_CLASS}`}>
                  {formattedTime}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
});

export default MessageComponent;
