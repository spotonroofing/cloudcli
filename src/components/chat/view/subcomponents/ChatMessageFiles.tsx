import { useState } from 'react';

import { authenticatedFetch } from '../../../../utils/api';
import type { ChatAttachment } from '../../types/types';

import { AttachmentCard } from './AttachmentCard';
import { PastedTextChip, PastedTextViewer, isPastedTextName, useStoredPastedText } from './PastedTextAttachment';

type ChatMessageFilesProps = {
  files: ChatAttachment[];
};

/**
 * A pasted-text attachment on a sent user bubble renders the same PASTED card
 * the composer shows, with the same scrollable full-text viewer behind it.
 */
function PastedTextMessageFile({ file, name }: { file: ChatAttachment; name: string }) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const text = useStoredPastedText(file.path?.split(/[\\/]/).pop(), true);

  return (
    <>
      <PastedTextChip name={name} text={text} onOpen={() => setViewerOpen(true)} />
      <PastedTextViewer name={name} text={text} open={viewerOpen} onOpenChange={setViewerOpen} />
    </>
  );
}

function ChatMessageFile({ file }: { file: ChatAttachment }) {
  const [isDownloading, setIsDownloading] = useState(false);
  const name = file.name || file.path?.split(/[\\/]/).pop() || 'Attached file';

  const download = async () => {
    if (!file.path || isDownloading) return;
    const storedName = file.path.split(/[\\/]/).pop();
    if (!storedName) return;

    setIsDownloading(true);
    try {
      const response = await authenticatedFetch(`/api/assets/files/${encodeURIComponent(storedName)}`);
      if (!response.ok) return;
      const blobUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
    } catch (error) {
      console.error(`Failed to download attachment "${name}":`, error);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <AttachmentCard
      kind="file"
      name={name}
      size={file.size}
      mimeType={file.mimeType}
      onOpen={file.path ? () => void download() : undefined}
    />
  );
}

export default function ChatMessageFiles({ files }: ChatMessageFilesProps) {
  if (!files?.length) return null;

  return (
    <div className="flex max-w-full flex-wrap justify-end gap-2">
      {files.map((file, index) => {
        const name = file.name || file.path?.split(/[\\/]/).pop() || 'Attached file';
        return isPastedTextName(name) ? (
          <PastedTextMessageFile key={file.path || file.name || index} file={file} name={name} />
        ) : (
          <ChatMessageFile key={file.path || file.name || index} file={file} />
        );
      })}
    </div>
  );
}
