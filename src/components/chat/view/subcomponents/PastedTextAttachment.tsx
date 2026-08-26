import { useEffect, useRef, useState } from 'react';
import { XIcon } from 'lucide-react';

import { authenticatedFetch } from '../../../../utils/api';
import { Button, Dialog, DialogContent, DialogTitle } from '../../../../shared/view/ui';

/** Pasted-text attachments (created by the paste-over-threshold path) render
 * as the Claude.ai-style PASTED chip instead of the generic file card. */
export const isPastedTextName = (name: string) => /^Pasted text( \d+)?\.txt$/.test(name);

/**
 * Loads a pasted-text attachment's full text from the asset store (a bare
 * fetch cannot carry the auth header, so the text is blob-fetched).
 */
export function useStoredPastedText(storedName: string | undefined, enabled: boolean): string | null {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !storedName) {
      setText(null);
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await authenticatedFetch(
          `/api/assets/files/${encodeURIComponent(storedName)}`,
          { signal: controller.signal },
        );
        if (!response.ok) return;
        setText(await response.text());
      } catch {
        // Aborted or unreachable; the chip renders without a preview.
      }
    })();
    return () => controller.abort();
  }, [enabled, storedName]);

  return text;
}

/**
 * Square Claude.ai-style chip for a pasted-text attachment: a miniature text
 * preview fills the card, a PASTED label sits bottom-left, and clicking opens
 * the full text (editable from the composer, read-only on a sent bubble). Shared between the composer and
 * sent user bubbles so both render identically.
 */
export function PastedTextChip({ name, text, onOpen }: { name: string; text: string | null; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-slot="pasted-text-chip"
      aria-label={`View ${name}`}
      className="relative block h-20 w-20 overflow-hidden rounded-lg border border-border/50 bg-background/80 text-left shadow-sm outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none h-full w-full select-none whitespace-pre-wrap break-words p-1.5 text-[6px] leading-[8px] text-muted-foreground"
      >
        {text ? text.slice(0, 400) : ''}
      </div>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end bg-gradient-to-t from-background via-background/80 to-transparent px-1.5 pb-1 pt-3">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
          PASTED
        </span>
      </span>
    </button>
  );
}

/**
 * Full-text viewer behind the PASTED chip. With `onSave` (composer chips) the
 * text is editable in place: Save or any close (X, Escape, outside press)
 * writes the edited text back to the attachment, Cancel restores the original.
 * Without it (sent bubbles) the text is read-only and says so.
 */
export function PastedTextViewer({
  name,
  text,
  open,
  onOpenChange,
  onSave,
}: {
  name: string;
  text: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave?: (text: string) => void;
}) {
  const [draft, setDraft] = useState('');
  useEffect(() => {
    if (open) setDraft(text ?? '');
  }, [open, text]);
  // The dialog's own first-focusable pass lands on the Close button (and the
  // text may still be loading); focus the editor a frame later, once enabled.
  const editorRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!open || text === null) return;
    const frame = requestAnimationFrame(() => editorRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, text]);

  const editable = Boolean(onSave);
  const close = () => onOpenChange(false);
  const commit = () => {
    if (editable && text !== null && draft !== text) onSave?.(draft);
    close();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : commit())}>
      <DialogContent
        data-slot="pasted-text-viewer"
        data-editable={editable ? 'true' : 'false'}
        className="flex max-h-[80dvh] max-w-xl flex-col"
      >
        <DialogTitle>{name}</DialogTitle>
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-sm font-medium text-foreground">{name.replace(/\.txt$/, '')}</span>
            {!editable && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Read only</span>}
          </span>
          <button
            type="button"
            onClick={commit}
            aria-label="Close"
            className="touch-hit relative inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <XIcon className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {editable ? (
          <textarea
            ref={editorRef}
            data-slot="pasted-text-editor"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={text === null}
            aria-label={`Edit ${name}`}
            className="block h-[60dvh] min-h-0 w-full resize-none overscroll-contain bg-transparent px-4 py-3 font-sans text-sm leading-6 text-foreground outline-none"
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground">
              {text ?? ''}
            </pre>
          </div>
        )}
        {editable && (
          <div className="flex items-center justify-end gap-1.5 border-t border-border/60 px-4 py-2.5">
            <Button type="button" variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={commit} disabled={text === null}>
              Save
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
