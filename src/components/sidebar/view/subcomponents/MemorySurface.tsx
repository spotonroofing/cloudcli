import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { BookMarked, Check, Loader2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import { PromptInput, PromptInputBody, PromptInputSubmit, PromptInputTextarea } from '../../../../shared/view/ui';
import { Markdown } from '../../../chat/view/subcomponents/Markdown';
import { api } from '../../../../utils/api';

import SidebarSurface from './SidebarSurface';

type MemorySurfaceProps = {
  open: boolean;
  onClose: () => void;
  isMobile: boolean;
  t: TFunction;
};

type EditState = 'idle' | 'running' | 'done';

/** How long the check shows on the send button after an edit lands. */
const DONE_SETTLE_MS = 1_600;

/**
 * Memory surface (ui12 phase 7; full-sidebar ui13 job 5; one view ui14 job
 * 3): fills the sidebar on the slide-up shell with Willem's curated memory
 * document (planner/_global/GLOBALMEMORY.md) rendered as a clean document,
 * and a prompt box at the bottom, Claude.ai style. An instruction typed there
 * runs a one-off headless edit session on the server (not a chat, not a
 * planner session) that applies it to the document by the document's own
 * rules, commits and pushes the memory repo, and the view refreshes from the
 * response. No tabs, no Internals, no Project/Global split.
 */
export default function MemorySurface({ open, onClose, isMobile, t }: MemorySurfaceProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [editState, setEditState] = useState<EditState>('idle');
  const [note, setNote] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchContent = useCallback(async () => {
    try {
      const response = await api.memoryCurated();
      if (!response.ok) return;
      const body = await response.json();
      setContent(typeof body?.data?.content === 'string' ? body.data.content : null);
    } catch (error) {
      console.error('Failed to fetch curated memory:', error);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void fetchContent().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, fetchContent]);

  useEffect(() => () => {
    if (doneTimer.current) clearTimeout(doneTimer.current);
  }, []);

  // Autogrow the instruction box to its text, capped by the textarea's own max height.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [instruction, open]);

  const submit = async () => {
    const text = instruction.trim();
    if (!text || editState === 'running') return;
    setEditState('running');
    setNote(null);
    try {
      const response = await api.editMemoryCurated(text);
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : t('memory.editFailed', 'The edit failed.'));
      }
      const data = body?.data ?? {};
      if (typeof data.content === 'string') setContent(data.content);
      setInstruction('');
      if (typeof data.warning === 'string') {
        setNote({ kind: 'error', text: data.warning });
      } else if (data.changed === false) {
        setNote({ kind: 'info', text: t('memory.noChange', 'No change') });
      }
      setEditState('done');
      if (doneTimer.current) clearTimeout(doneTimer.current);
      doneTimer.current = setTimeout(() => setEditState('idle'), DONE_SETTLE_MS);
    } catch (error) {
      setNote({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
      setEditState('idle');
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const running = editState === 'running';

  return (
    <SidebarSurface
      open={open}
      onClose={onClose}
      ariaLabel={t('memory.title', 'Memory')}
      dataSlot="memory-surface"
      mobileSheet={isMobile}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">{t('memory.title', 'Memory')}</h2>
        <BookMarked className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" data-slot="memory-surface-body">
        {loading && content === null ? (
          <p className="px-1 py-1 text-xs text-muted-foreground/70">{t('memory.loading', 'Loading memory...')}</p>
        ) : content === null ? (
          <p className="px-1 py-1 text-xs text-muted-foreground/70">
            {t('memory.noCurated', 'Nothing remembered yet.')}
          </p>
        ) : (
          <div data-slot="memory-curated">
            <Markdown className="prose prose-sm max-w-none dark:prose-invert">{content}</Markdown>
          </div>
        )}
      </div>

      <div className="border-t border-border/60 px-3 py-3" data-slot="memory-prompt">
        <PromptInput onSubmit={onSubmit} status={running ? 'submitted' : 'ready'}>
          <div className="flex items-end px-2 pb-1.5">
            <PromptInputBody className="min-w-0 flex-1">
              <PromptInputTextarea
                ref={textareaRef}
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={t('memory.prompt', 'Iterate memory...')}
                aria-label={t('memory.promptLabel', 'Edit memory')}
                disabled={running}
                className="px-2 py-1.5 leading-5 md:text-[13px]"
              />
            </PromptInputBody>
            <PromptInputSubmit
              className="mb-0.5 h-7 w-7"
              disabled={running || !instruction.trim()}
              aria-label={t('memory.apply', 'Apply')}
              data-state={editState}
            >
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : editState === 'done' ? (
                <Check className="h-4 w-4" />
              ) : undefined}
            </PromptInputSubmit>
          </div>
        </PromptInput>
        {note && (
          <p
            data-slot="memory-prompt-note"
            className={
              note.kind === 'error'
                ? 'mt-1.5 px-1 text-xs text-destructive'
                : 'mt-1.5 px-1 text-xs text-muted-foreground/70'
            }
          >
            {note.text}
          </p>
        )}
      </div>
    </SidebarSurface>
  );
}
