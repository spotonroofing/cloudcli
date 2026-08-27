import { useCallback, useEffect, useRef, useState } from 'react';
import type { TransitionEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, CornerDownLeft, Paperclip } from 'lucide-react';

import { authenticatedFetch } from '../../../../utils/api';
import { Skeleton } from '../../../../shared/view/ui';
import type { ChatAttachment } from '../../types/types';

type PromptHistoryFile = {
  path: string;
  name?: string;
};

export type PromptHistoryEntry = {
  id: string;
  sessionId: string;
  sessionTitle: string | null;
  timestamp: string;
  content: string;
  files: PromptHistoryFile[];
  images: PromptHistoryFile[];
};

interface PromptHistoryPanelProps {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
  sessionId: string | null;
  onUsePrompt: (content: string, attachments: ChatAttachment[]) => void;
}

const PANEL_RAMP = 'grid-template-rows 0.3s cubic-bezier(0.77, 0, 0.175, 1)';

const formatWhen = (timestamp: string): string => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const attachmentName = (file: PromptHistoryFile): string =>
  file.name || file.path.split(/[\\/]/).pop() || 'Attachment';

const downloadHistoryFile = async (file: PromptHistoryFile) => {
  const storedName = file.path.split(/[\\/]/).pop();
  if (!storedName) {
    return;
  }
  try {
    const response = await authenticatedFetch(`/api/assets/files/${encodeURIComponent(storedName)}`);
    if (!response.ok) {
      return;
    }
    const blobUrl = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = attachmentName(file);
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
  } catch (error) {
    console.error('Failed to download prompt-history attachment:', error);
  }
};

/**
 * Prompt history (ui15 job 2): the history button expands the prompt bar
 * area into a panel about a third of the pane tall listing the user's past
 * prompts (this session's and the project's recent ones), newest first. A row
 * expands to the full text and its attachments (downloadable — the files
 * live in the server's asset store); Use loads it into the composer.
 */
export default function PromptHistoryPanel({
  open,
  onClose,
  projectId,
  sessionId,
  onUsePrompt,
}: PromptHistoryPanelProps) {
  const { t } = useTranslation('chat');
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [rendered, setRendered] = useState(open);
  const [expanded, setExpanded] = useState(open);
  const [panelHeight, setPanelHeight] = useState(280);
  const [prompts, setPrompts] = useState<PromptHistoryEntry[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Mount, then expand on the next frame so the height ramps open; ramp
  // closed before unmounting. The timer backstops requestAnimationFrame,
  // which never fires while the window is occluded.
  useEffect(() => {
    if (open) {
      setRendered(true);
      const frame = requestAnimationFrame(() => setExpanded(true));
      const timer = setTimeout(() => setExpanded(true), 60);
      return () => {
        cancelAnimationFrame(frame);
        clearTimeout(timer);
      };
    }
    setExpanded(false);
  }, [open]);

  // Measure once the panel is actually in the DOM (rendered), not on the
  // open flip whose commit precedes the mount.
  useEffect(() => {
    if (!open || !rendered || !rootRef.current) {
      return;
    }
    const pane = rootRef.current.closest('[data-slot="chat-pane"]');
    if (pane) {
      setPanelHeight(Math.max(180, Math.round(pane.clientHeight / 3)));
    }
  }, [open, rendered]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setPrompts(null);
    setExpandedId(null);
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (sessionId) params.set('sessionId', sessionId);
    let cancelled = false;
    void authenticatedFetch(`/api/prompt-history?${params.toString()}`)
      .then(async (response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (cancelled) {
          return;
        }
        const rows = body?.data?.prompts;
        setPrompts(Array.isArray(rows) ? (rows as PromptHistoryEntry[]) : []);
      })
      .catch(() => {
        if (!cancelled) {
          setPrompts([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, sessionId]);

  const handleTransitionEnd = useCallback((event: TransitionEvent<HTMLDivElement>) => {
    // Only the panel's own height collapse unmounts it — child transitions
    // (row hovers) bubble here too.
    if (!open && event.target === rootRef.current && event.propertyName === 'grid-template-rows') {
      setRendered(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!rendered) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      data-slot="prompt-history-panel"
      className="grid"
      style={{ gridTemplateRows: expanded ? '1fr' : '0fr', transition: PANEL_RAMP }}
      onTransitionEnd={handleTransitionEnd}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className="mb-2 flex flex-col overflow-hidden rounded-lg border border-border/50 bg-card/80 shadow-sm backdrop-blur-sm"
          style={{ height: panelHeight }}
        >
          <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/40 px-3">
            <span className="text-xs font-medium text-muted-foreground">
              {t('input.history.title', { defaultValue: 'Prompt history' })}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {prompts === null && (
              <div className="space-y-1.5 p-1">
                <Skeleton className="h-7 w-full" />
                <Skeleton className="h-7 w-5/6" />
                <Skeleton className="h-7 w-2/3" />
              </div>
            )}

            {prompts !== null && prompts.length === 0 && (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                {t('input.history.empty', { defaultValue: 'No prompts yet.' })}
              </p>
            )}

            {prompts?.map((prompt) => {
              const isExpanded = expandedId === prompt.id;
              const attachments = [...prompt.images, ...prompt.files];
              return (
                <div key={prompt.id} data-slot="prompt-history-row" className="rounded-lg">
                  <div className="group/history flex min-h-8 items-center gap-2 rounded-lg px-2 py-1 hover:bg-accent/50">
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : prompt.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      aria-expanded={isExpanded}
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/90">
                        {prompt.content || attachments.map(attachmentName).join(', ')}
                      </span>
                      {attachments.length > 0 && !isExpanded && (
                        <span className="flex shrink-0 items-center gap-0.5 text-[10px] tabular-nums text-muted-foreground/70">
                          <Paperclip className="h-3 w-3" aria-hidden />
                          {attachments.length}
                        </span>
                      )}
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
                        {formatWhen(prompt.timestamp)}
                      </span>
                      <span className="grid size-4 shrink-0 place-items-center">
                        <ChevronDown
                          className={`size-3.5 text-muted-foreground/70 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                          aria-hidden
                        />
                      </span>
                    </button>
                    <button
                      type="button"
                      data-slot="prompt-history-use"
                      onClick={() => {
                        onUsePrompt(prompt.content, attachments as ChatAttachment[]);
                        onClose();
                      }}
                      aria-label={t('input.history.use', { defaultValue: 'Use this prompt' })}
                      className="touch-hit relative flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/history:opacity-100 touch:opacity-100"
                    >
                      <CornerDownLeft className="h-3 w-3" aria-hidden />
                      {t('input.history.useLabel', { defaultValue: 'Use' })}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="px-2 pb-2 pl-4">
                      {prompt.content && (
                        <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 px-2.5 py-2 text-[13px] text-foreground/90">
                          {prompt.content}
                        </p>
                      )}
                      {attachments.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {attachments.map((file, index) => (
                            <button
                              key={`${file.path}-${index}`}
                              type="button"
                              onClick={() => void downloadHistoryFile(file)}
                              aria-label={`Download ${attachmentName(file)}`}
                              className="flex max-w-56 items-center gap-1.5 rounded-md border border-border/50 bg-background/80 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            >
                              <Paperclip className="h-3 w-3 shrink-0" aria-hidden />
                              <span className="truncate">{attachmentName(file)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
