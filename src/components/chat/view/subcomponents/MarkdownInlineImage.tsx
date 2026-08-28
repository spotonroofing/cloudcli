import { useContext, useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';

import { authenticatedFetch } from '../../../../utils/api';

import { ChatProjectContext } from './ChatProjectContext';
import { ImageLightbox } from './ImageLightbox';

// Only HTTPS URLs may bypass the workspace file route. Plain HTTP, data/blob
// URLs, protocol-relative URLs, and other schemes stay non-renderable.
export const isRemoteImageUrl = (src: string): boolean => /^https:\/\//i.test(src);

// Only bare file paths are workspace candidates; the server still makes the
// final containment check and rejects anything outside the project root.
export const isWorkspaceImagePath = (src: string): boolean =>
  !!src && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith('//');

type MarkdownInlineImageProps = {
  src?: string;
  alt?: string;
  compact?: boolean;
};

/**
 * An image a session sent into the chat. HTTPS sources render directly;
 * workspace paths are fetched as blobs through the authenticated project
 * files route (which 403s anything outside the project root). Unsupported or
 * failed sources fall back to a muted non-image line/card.
 */
export default function MarkdownInlineImage({ src, alt, compact = false }: MarkdownInlineImageProps) {
  const projectId = useContext(ChatProjectContext);
  const path = typeof src === 'string' ? src : '';
  const remote = isRemoteImageUrl(path);
  const workspace = !!projectId && isWorkspaceImagePath(path);
  const eligible = remote || workspace;
  const [objectSrc, setObjectSrc] = useState<string | null>(remote ? path : null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(false);

    if (remote) {
      setObjectSrc(path);
      setFailed(false);
      return;
    }

    if (!workspace) {
      setObjectSrc(null);
      setFailed(false);
      return;
    }

    let objectUrl: string | null = null;
    const controller = new AbortController();

    const load = async () => {
      setFailed(false);
      try {
        const response = await authenticatedFetch(
          `/api/file-tree/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
          { signal: controller.signal },
        );
        if (!response.ok) {
          setFailed(true);
          return;
        }
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        setObjectSrc(objectUrl);
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          setFailed(true);
        }
      }
    };

    void load();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [path, projectId, remote, workspace]);

  const label = alt || path.split(/[\\/]/).pop() || 'image';

  if (!eligible || failed) {
    return (
      <span
        data-slot="transcript-image-fallback"
        className={compact
          ? 'flex size-28 max-w-full items-center justify-center gap-1.5 rounded-lg border border-border/50 bg-muted/60 p-2 text-center text-[10px] text-muted-foreground sm:size-32'
          : 'my-1 inline-flex max-w-full items-center gap-1.5 text-xs text-muted-foreground'}
      >
        <ImageOff className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        <span className="truncate font-mono">{path || label}</span>
      </span>
    );
  }

  if (!objectSrc) {
    return (
      <span
        data-slot="transcript-image-loading"
        className={compact
          ? 'block size-28 max-w-full animate-pulse rounded-lg border border-border/50 bg-muted sm:size-32'
          : 'block h-40 w-56 max-w-full animate-pulse rounded-lg border border-border/50 bg-muted'}
      />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label={`Expand ${label}`}
        data-slot="transcript-image-card"
        className={`${compact ? 'size-28 sm:size-32' : 'max-w-full'} block overflow-hidden rounded-lg border border-border/50 bg-background/80 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/60`}
      >
        <img
          src={objectSrc}
          alt={label}
          onError={() => setFailed(true)}
          className={compact
            ? 'size-full cursor-zoom-in object-contain p-1.5'
            : 'max-h-80 max-w-full cursor-zoom-in object-contain'}
        />
      </button>
      {expanded && <ImageLightbox src={objectSrc} alt={label} onClose={() => setExpanded(false)} />}
    </>
  );
}
