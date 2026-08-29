import { useEffect, useState } from 'react';
import { XIcon } from 'lucide-react';

import { authenticatedFetch } from '../../../../utils/api';
import type { ChatAttachment } from '../../types/types';

import { AttachmentCard } from './AttachmentCard';
import { ImageLightbox } from './ImageLightbox';
import { PastedTextChip, PastedTextViewer, isPastedTextName, useStoredPastedText } from './PastedTextAttachment';

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
  /** Pasted-text chips only: the viewer's edited text replaces the attachment. */
  onReplaceText?: (text: string) => void;
  uploadProgress?: number;
  error?: string;
}

const ComposerAttachment = ({ file, descriptor, onRemove, onReplaceText, uploadProgress, error }: ComposerAttachmentProps) => {
  const [preview, setPreview] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const [filePastedText, setFilePastedText] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);

  const name = file?.name || descriptor?.name || descriptor?.path?.split(/[\\/]/).pop() || 'Attachment';
  const size = file?.size ?? descriptor?.size;
  const mimeType = file?.type || descriptor?.mimeType || '';
  const isImage = mimeType.startsWith('image/') || (!file && /\.(gif|jpe?g|png|svg|webp)$/i.test(name));
  const isPastedText = !isImage && isPastedTextName(name);

  // Pasted-text chips need the actual text: straight off the File for a fresh
  // paste, blob-fetched from the asset store for a restored draft descriptor.
  useEffect(() => {
    if (!isPastedText || !file) {
      setFilePastedText(null);
      return;
    }
    let cancelled = false;
    void file.text().then((text) => {
      if (!cancelled) setFilePastedText(text);
    });
    return () => {
      cancelled = true;
    };
  }, [isPastedText, file]);
  const storedPastedText = useStoredPastedText(
    descriptor?.path?.split(/[\\/]/).pop(),
    isPastedText && !file,
  );
  const pastedText = filePastedText ?? storedPastedText;

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
        <AttachmentCard
          kind="image"
          name={name}
          previewSrc={preview}
          onOpen={preview ? () => setExpanded(true) : undefined}
        />
      ) : isPastedText ? (
        <PastedTextChip name={name} text={pastedText} onOpen={() => setViewerOpen(true)} />
      ) : (
        <AttachmentCard kind="file" name={name} size={size} mimeType={mimeType} />
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
        <PastedTextViewer
          name={name}
          text={pastedText}
          open={viewerOpen}
          onOpenChange={setViewerOpen}
          onSave={onReplaceText}
        />
      )}
    </div>
  );
};

export default ComposerAttachment;
