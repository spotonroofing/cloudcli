import { useContext, useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';

import { authenticatedFetch } from '../../../../utils/api';

import { ChatProjectContext } from './ChatProjectContext';
import { ImageLightbox } from './ImageLightbox';

// Only bare file paths are workspace candidates; anything carrying a URL
// scheme (http:, data:, blob:) or a protocol-relative prefix is not a
// workspace file and never renders as an image.
const isWorkspacePath = (src: string): boolean =>
  !!src && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith('//');

/**
 * An image a session sent into the chat: markdown `![caption](path)` whose
 * path is a file inside the project workspace. The path is fetched as a blob
 * through the authenticated project files route (which 403s anything outside
 * the project root), so only workspace files ever render; everything else
 * falls back to a muted non-image line.
 */
export default function MarkdownInlineImage({ src, alt }: { src?: string; alt?: string }) {
  const projectId = useContext(ChatProjectContext);
  const path = typeof src === 'string' ? src : '';
  const eligible = !!projectId && isWorkspacePath(path);
  const [objectSrc, setObjectSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!eligible) {
      setObjectSrc(null);
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
  }, [eligible, projectId, path]);

  const label = alt || path.split(/[\\/]/).pop() || 'image';

  if (!eligible || failed) {
    return (
      <span className="my-1 inline-flex max-w-full items-center gap-1.5 text-xs text-muted-foreground">
        <ImageOff className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        <span className="truncate font-mono">{path || label}</span>
      </span>
    );
  }

  if (!objectSrc) {
    return <span className="my-3 block h-40 w-56 max-w-full animate-pulse rounded-lg border border-border/50 bg-muted" />;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label={`Expand ${label}`}
        className="my-3 block max-w-full overflow-hidden rounded-lg border border-border/50 bg-background/80 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <img
          src={objectSrc}
          alt={label}
          onError={() => setFailed(true)}
          className="max-h-80 max-w-full cursor-zoom-in object-contain"
        />
      </button>
      {expanded && <ImageLightbox src={objectSrc} alt={label} onClose={() => setExpanded(false)} />}
    </>
  );
}
