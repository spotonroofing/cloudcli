import { FileArchiveIcon, FileCodeIcon, FileIcon, FileTextIcon } from 'lucide-react';

/**
 * The one attachment card, shared by the composer, sent user bubbles, and files
 * a session presents by link. Every kind is the same square with the same
 * corners and border language — only the fill changes: an image thumbnail, the
 * first lines of text, or an icon over the name and size.
 */

export type AttachmentCardKind = 'image' | 'text' | 'file';

const CARD_CLASS =
  'relative block h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border/50 bg-background/80 text-left align-middle shadow-sm outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-default disabled:hover:bg-background/80';

const ACTION_LABELS: Record<AttachmentCardKind, string> = {
  image: 'Expand',
  text: 'View',
  file: 'Download',
};

/** Human-readable byte size, shared by every place a card shows one. */
export const formatFileSize = (size?: number): string | null => {
  if (typeof size !== 'number' || Number.isNaN(size)) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

/** Picks the glyph for a non-image, non-text card from the file's name/type. */
export const getFileIcon = (name: string, mimeType?: string) => {
  const lowered = (name || '').toLowerCase();
  if ((mimeType || '').startsWith('text/') || /\.(md|txt|pdf|docx?)$/.test(lowered)) return FileTextIcon;
  if (/\.(zip|rar|7z|tar|gz)$/.test(lowered)) return FileArchiveIcon;
  if (/\.(js|jsx|ts|tsx|py|rb|go|rs|java|c|cpp|css|html|json|ya?ml)$/.test(lowered)) return FileCodeIcon;
  return FileIcon;
};

type AttachmentCardProps = {
  kind: AttachmentCardKind;
  name: string;
  size?: number;
  mimeType?: string;
  /** Image kind: the resolved source; undefined while it is still loading. */
  previewSrc?: string;
  /** Text kind: the text whose first lines fill the card. */
  previewText?: string | null;
  /** Text kind: the strip label over the preview (defaults to the file name). */
  label?: string;
  /** Image kind: rendered as a failed card instead of a thumbnail. */
  failed?: boolean;
  onOpen?: () => void;
  /** The verb in the card's aria-label; defaults per kind. */
  actionLabel?: string;
  /** Overrides the slot name for surfaces with their own existing selector. */
  slot?: string;
};

export function AttachmentCard({
  kind,
  name,
  size,
  mimeType,
  previewSrc,
  previewText,
  label,
  failed = false,
  onOpen,
  actionLabel,
  slot = 'attachment-card',
}: AttachmentCardProps) {
  const FileTypeIcon = getFileIcon(name, mimeType);
  const sizeLabel = formatFileSize(size);

  return (
    <button
      type="button"
      data-slot={slot}
      data-attachment-card=""
      data-attachment-kind={kind}
      onClick={onOpen}
      disabled={!onOpen}
      aria-label={`${actionLabel ?? ACTION_LABELS[kind]} ${name}`}
      className={CARD_CLASS}
    >
      {kind === 'image' && !failed ? (
        previewSrc ? (
          <img src={previewSrc} alt={name} className="h-full w-full cursor-zoom-in object-contain" />
        ) : (
          <span className="block h-full w-full animate-pulse bg-muted" />
        )
      ) : kind === 'text' ? (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none block h-full w-full select-none whitespace-pre-wrap break-words p-1.5 text-[6px] leading-[8px] text-muted-foreground"
          >
            {previewText ? previewText.slice(0, 400) : ''}
          </span>
          <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end bg-gradient-to-t from-background via-background/80 to-transparent px-1.5 pb-1 pt-3">
            <span className="w-full truncate text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              {label ?? name}
            </span>
          </span>
        </>
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-1.5">
          <FileTypeIcon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="w-full truncate text-center text-[10px] font-medium leading-3 text-foreground">{name}</span>
          {sizeLabel && <span className="text-[9px] leading-3 text-muted-foreground">{sizeLabel}</span>}
        </span>
      )}
    </button>
  );
}

export default AttachmentCard;
