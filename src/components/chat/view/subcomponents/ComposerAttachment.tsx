import { useEffect, useState } from 'react';
import { FileIcon, XIcon } from 'lucide-react';

import { authenticatedFetch } from '../../../../utils/api';
import { Dialog, DialogContent, DialogTitle } from '../../../../shared/view/ui';
import type { ChatAttachment } from '../../types/types';

import { ImageLightbox } from './ChatMessageImages';

/** Pasted-text attachments (created by the paste-over-threshold path) render
 * as the Claude.ai-style PASTED chip instead of the generic file card. */
const isPastedTextName = (name: string) => /^Pasted text( \d+)?\.txt$/.test(name);

/**
 * One composer attachment chip. `file` renders a just-attached browser File
 * (preview via object URL); `descriptor` renders an already-uploaded draft
 * attachment (preview blob-fetched from the asset store, since a bare
 * <img src> cannot carry the auth header). Exactly one of the two is set.
 */
interface ComposerAttachmentProps {
  file?: File;
  descriptor?: ChatAttachment;
  onRemove: () => void;
  uploadProgress?: number;
  error?: string;
}

const formatFileSize = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Square Claude.ai-style chip for a pasted-text attachment: a miniature text
 * preview fills the card, a PASTED label sits bottom-left, and clicking opens
 * a scrollable viewer with the full text.
 */
function PastedTextChip({ name, text, onOpen }: { name: string; text: string | null; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-slot="pasted-text-chip"
      aria-label={`View ${name}`}
      title={name}
      className="relative block h-20 w-20 overflow-hidden rounded-lg border border-border/50 bg-background/80 text-left shadow-sm transition-colors hover:bg-accent/40 focus:outline-none focus:ring-2 focus:ring-primary/60"
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

const ComposerAttachment = ({ file, descriptor, onRemove, uploadProgress, error }: ComposerAttachmentProps) => {
  const [preview, setPreview] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const [pastedText, setPastedText] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);

  const name = file?.name || descriptor?.name || descriptor?.path?.split(/[\\/]/).pop() || 'Attachment';
  const size = file?.size ?? descriptor?.size;
  const mimeType = file?.type || descriptor?.mimeType || '';
  const isImage = mimeType.startsWith('image/') || (!file && /\.(gif|jpe?g|png|svg|webp)$/i.test(name));
  const isPastedText = !isImage && isPastedTextName(name);

  // Pasted-text chips need the actual text: straight off the File for a fresh
  // paste, blob-fetched from the asset store for a restored draft descriptor.
  useEffect(() => {
    if (!isPastedText) {
      setPastedText(null);
      return;
    }
    if (file) {
      let cancelled = false;
      void file.text().then((text) => {
        if (!cancelled) setPastedText(text);
      });
      return () => {
        cancelled = true;
      };
    }
    const storedName = descriptor?.path?.split(/[\\/]/).pop();
    if (!storedName) {
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
        const text = await response.text();
        setPastedText(text);
      } catch {
        // Aborted or unreachable; the chip renders without a preview.
      }
    })();
    return () => controller.abort();
  }, [isPastedText, file, descriptor?.path]);

  useEffect(() => {
    if (!isImage) {
      setPreview(undefined);
      return;
    }

    if (file) {
      const url = URL.createObjectURL(file);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }

    const filename = descriptor?.path?.split(/[\\/]/).pop();
    if (!filename) {
      setPreview(undefined);
      return;
    }
    let objectUrl: string | null = null;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await authenticatedFetch(
          `/api/assets/images/${encodeURIComponent(filename)}`,
          { signal: controller.signal },
        );
        if (!response.ok) {
          return;
        }
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        setPreview(objectUrl);
      } catch {
        // Aborted or unreachable; the chip falls back to the file card.
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [file, descriptor?.path, isImage]);

  return (
    <div className="group relative max-w-full">
      {isImage && (file || preview) ? (
        <button
          type="button"
          onClick={() => preview && setExpanded(true)}
          aria-label={`Expand ${name}`}
          className="block overflow-hidden rounded-lg border border-border/50 shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/60"
        >
          {preview
            ? <img src={preview} alt={name} className="h-20 w-20 cursor-zoom-in object-cover" />
            : <div className="h-20 w-20 animate-pulse bg-muted" />}
        </button>
      ) : isPastedText ? (
        <PastedTextChip name={name} text={pastedText} onOpen={() => setViewerOpen(true)} />
      ) : (
        <div className="flex h-20 w-56 max-w-full items-center gap-3 rounded-lg border border-border/50 bg-background/80 px-3 shadow-sm">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileIcon className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground" title={name}>{name}</p>
            {size !== undefined && (
              <p className="mt-0.5 text-xs text-muted-foreground">{formatFileSize(size)}</p>
            )}
          </div>
        </div>
      )}
      {uploadProgress !== undefined && uploadProgress < 100 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-black/50">
          <div className="text-xs text-white">{uploadProgress}%</div>
        </div>
      )}
      {error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-red-500/50">
          <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 rounded-full border border-border/40 bg-background/90 p-1 text-foreground shadow-sm backdrop-blur transition-opacity hover:bg-background focus:opacity-100 md:opacity-0 md:group-hover:opacity-100"
        aria-label={`Remove ${name}`}
      >
        <XIcon className="h-3 w-3" aria-hidden />
      </button>
      {expanded && preview && (
        <ImageLightbox src={preview} alt={name} onClose={() => setExpanded(false)} />
      )}
      {isPastedText && (
        <Dialog open={viewerOpen} onOpenChange={setViewerOpen}>
          <DialogContent data-slot="pasted-text-viewer" className="flex max-h-[80dvh] max-w-xl flex-col">
            <DialogTitle>{name}</DialogTitle>
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <span className="text-sm font-medium text-foreground">{name.replace(/\.txt$/, '')}</span>
              <button
                type="button"
                onClick={() => setViewerOpen(false)}
                aria-label="Close"
                className="touch-hit relative inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <XIcon className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground">
                {pastedText ?? ''}
              </pre>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default ComposerAttachment;
