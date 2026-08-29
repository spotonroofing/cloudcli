import { useEffect, useState } from 'react';

import { authenticatedFetch } from '../../../../utils/api';
import type { ChatImage } from '../../types/types';

import { AttachmentCard } from './AttachmentCard';
import { ImageLightbox } from './ImageLightbox';

type ChatMessageImagesProps = {
  images: ChatImage[];
  projectId?: string | null;
};

/**
 * Resolves one chat image to a displayable src. Inline data URLs are used
 * directly; path-based attachments are fetched as blobs (a bare <img src>
 * cannot carry the auth header) — first from the global assets route
 * (the centralized runtime assets directory), then from the project files route as a fallback for
 * sessions recorded before attachments moved to the global store.
 */
function useChatImageSrc(image: ChatImage, projectId?: string | null): { src: string | null; failed: boolean } {
  const [src, setSrc] = useState<string | null>(image.data || null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (image.data) {
      setSrc(image.data);
      setFailed(false);
      return;
    }

    const imagePath = image.path;
    if (!imagePath) {
      setSrc(null);
      setFailed(true);
      return;
    }

    const filename = imagePath.split(/[\\/]/).pop() || '';
    const candidateUrls = [
      `/api/assets/images/${encodeURIComponent(filename)}`,
      ...(projectId
        ? [`/api/file-tree/projects/${projectId}/files/content?path=${encodeURIComponent(imagePath)}`]
        : []),
    ];

    let objectUrl: string | null = null;
    const controller = new AbortController();

    const load = async () => {
      setFailed(false);
      for (const url of candidateUrls) {
        try {
          const response = await authenticatedFetch(url, { signal: controller.signal });
          if (!response.ok) {
            continue;
          }
          const blob = await response.blob();
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
          return;
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            return;
          }
        }
      }
      setSrc(null);
      setFailed(true);
    };

    void load();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [image.data, image.path, projectId]);

  return { src, failed };
}

function ChatMessageImage({ image, projectId }: { image: ChatImage; projectId?: string | null }) {
  const { src, failed } = useChatImageSrc(image, projectId);
  const [expanded, setExpanded] = useState(false);
  const alt = image.name || 'Attached image';

  return (
    <>
      <AttachmentCard
        kind="image"
        name={alt}
        size={image.size}
        mimeType={image.mimeType}
        previewSrc={src ?? undefined}
        failed={failed}
        onOpen={src ? () => setExpanded(true) : undefined}
      />
      {expanded && src && <ImageLightbox src={src} alt={alt} onClose={() => setExpanded(false)} />}
    </>
  );
}

/**
 * Image attachments for a user turn: the shared square attachment card above
 * the message bubble, identical to the composer's. Each thumbnail expands to a
 * fullscreen lightbox on click.
 */
export default function ChatMessageImages({ images, projectId }: ChatMessageImagesProps) {
  if (!images || images.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {images.map((image, index) => (
        <ChatMessageImage key={image.path || image.name || index} image={image} projectId={projectId} />
      ))}
    </div>
  );
}
