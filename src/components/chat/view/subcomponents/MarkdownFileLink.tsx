import { useContext, useEffect, useState } from 'react';

import { authenticatedFetch } from '../../../../utils/api';

import { AttachmentCard, type AttachmentCardKind } from './AttachmentCard';
import { ChatProjectContext } from './ChatProjectContext';
import { ImageLightbox } from './ImageLightbox';
import { PastedTextViewer } from './PastedTextAttachment';

type LocalFileMeta = {
  name: string;
  size: number;
  mimeType: string;
  kind: AttachmentCardKind;
};

const localFileUrl = (path: string, projectId: string | null, suffix = '', extra = ''): string =>
  `/api/assets/local-file${suffix}?path=${encodeURIComponent(path)}${
    projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''
  }${extra}`;

/**
 * A file a session presented in chat by markdown link. The link resolves
 * through the read-only local-file route, which only reaches the pane's own
 * project workspace and the planner memory repo; anything it refuses (a path
 * outside those roots, a file that is not there) falls back to the plain
 * in-chat file link. A resolved file renders the shared attachment card and
 * opens in the viewer: images zoom, text opens in the scrollable sheet with a
 * download control, everything else downloads.
 */
export default function MarkdownFileLink({
  filePath,
  href,
  children,
  onOpenInEditor,
}: {
  filePath: string;
  href?: string;
  children?: React.ReactNode;
  onOpenInEditor: (path: string) => void;
}) {
  const projectId = useContext(ChatProjectContext);
  const [meta, setMeta] = useState<LocalFileMeta | null>(null);
  const [resolved, setResolved] = useState<'pending' | 'ok' | 'no'>('pending');
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setResolved('pending');
    void (async () => {
      try {
        const response = await authenticatedFetch(localFileUrl(filePath, projectId), {
          signal: controller.signal,
        });
        if (!response.ok) {
          setResolved('no');
          return;
        }
        setMeta((await response.json()) as LocalFileMeta);
        setResolved('ok');
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          setResolved('no');
        }
      }
    })();
    return () => controller.abort();
  }, [filePath, projectId]);

  const name = meta?.name || filePath.split(/[\\/]/).pop() || filePath;

  // The card carries the file's own face, so an image's thumbnail and a text
  // file's first lines load as soon as the path resolves. A large text file is
  // left to the viewer rather than pulled into every card.
  useEffect(() => {
    if (!meta || (meta.kind !== 'image' && !(meta.kind === 'text' && meta.size <= 256 * 1024))) {
      return;
    }
    let objectUrl: string | null = null;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await authenticatedFetch(localFileUrl(filePath, projectId, '/content'), {
          signal: controller.signal,
        });
        if (!response.ok) return;
        if (meta.kind === 'image') {
          objectUrl = URL.createObjectURL(await response.blob());
          setImageSrc(objectUrl);
        } else {
          setText(await response.text());
        }
      } catch {
        // Aborted or unreachable; the card keeps its placeholder face.
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [meta, filePath, projectId]);

  const fetchBlob = async () => {
    const response = await authenticatedFetch(localFileUrl(filePath, projectId, '/content'));
    return response.ok ? await response.blob() : null;
  };

  const download = async () => {
    const response = await authenticatedFetch(
      localFileUrl(filePath, projectId, '/content', '&download=1'),
    );
    if (!response.ok) return;
    const blobUrl = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
  };

  const open = async () => {
    if (meta?.kind === 'image') {
      if (!imageSrc) {
        const blob = await fetchBlob();
        if (!blob) return;
        setImageSrc(URL.createObjectURL(blob));
      }
      setExpanded(true);
      return;
    }
    if (meta?.kind === 'text') {
      if (text === null) {
        const blob = await fetchBlob();
        setText(blob ? await blob.text() : '');
      }
      setViewerOpen(true);
      return;
    }
    await download();
  };

  if (resolved === 'no') {
    return (
      <a
        href={href || filePath}
        className="cursor-pointer text-primary hover:underline"
        onClick={(event) => {
          event.preventDefault();
          onOpenInEditor(filePath);
        }}
      >
        {children}
      </a>
    );
  }

  return (
    <span className="my-1 mr-1 inline-flex align-middle">
      <AttachmentCard
        kind={meta?.kind ?? 'file'}
        name={name}
        size={meta?.size}
        mimeType={meta?.mimeType}
        previewSrc={imageSrc ?? undefined}
        previewText={text}
        label={name}
        actionLabel="Open"
        onOpen={() => void open()}
      />
      {expanded && imageSrc && (
        <ImageLightbox src={imageSrc} alt={name} onClose={() => setExpanded(false)} />
      )}
      {meta?.kind === 'text' && (
        <PastedTextViewer
          name={name}
          text={text}
          open={viewerOpen}
          onOpenChange={setViewerOpen}
          onDownload={() => void download()}
        />
      )}
    </span>
  );
}
