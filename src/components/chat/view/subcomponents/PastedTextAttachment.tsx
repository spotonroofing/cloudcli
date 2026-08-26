import { useEffect, useState } from 'react';
import { XIcon } from 'lucide-react';

import { authenticatedFetch } from '../../../../utils/api';
import { Dialog, DialogContent, DialogTitle } from '../../../../shared/view/ui';

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
 * a scrollable viewer with the full text. Shared between the composer and
 * sent user bubbles so both render identically.
 */
export function PastedTextChip({ name, text, onOpen }: { name: string; text: string | null; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-slot="pasted-text-chip"
      aria-label={`View ${name}`}
      className="relative block h-20 w-20 overflow-hidden rounded-lg border border-border/50 bg-background/80 text-left shadow-sm transition-colors hover:bg-accent/40 outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
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

/** Scrollable full-text viewer behind the PASTED chip. */
export function PastedTextViewer({
  name,
  text,
  open,
  onOpenChange,
}: {
  name: string;
  text: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="pasted-text-viewer" className="flex max-h-[80dvh] max-w-xl flex-col">
        <DialogTitle>{name}</DialogTitle>
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <span className="text-sm font-medium text-foreground">{name.replace(/\.txt$/, '')}</span>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="touch-hit relative inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <XIcon className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground">
            {text ?? ''}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}
