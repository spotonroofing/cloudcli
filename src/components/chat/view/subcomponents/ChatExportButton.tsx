import { Download, FileJson, FileText } from 'lucide-react';

import { ActionMenu } from '../../../../shared/view/ui';
import { useChatExportTarget } from '../../state/chatExportTarget';
import { downloadMarkdown, downloadHTML, downloadPDF, EXPORT_FORMATS } from '../../utils/chatExport';

/**
 * Download chat (ui17 job 10): the export control lives in the pane top bar,
 * not floating over the transcript. Bare icon on the window selector's exact
 * anatomy — ghost, no background, no border, same h-6 w-6 box and spacing as
 * the other top-bar icon buttons. Renders nothing until the pane's transcript
 * has something to export.
 */
export default function ChatExportButton() {
  const target = useChatExportTarget();

  if (!target || !target.available) {
    return null;
  }

  const handleExport = (format: 'markdown' | 'html' | 'pdf') => {
    const snapshot = target.read();
    if (!snapshot || snapshot.messages.length === 0) return;
    const { messages, sessionTitle } = snapshot;
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${sessionTitle || 'chat'}-${timestamp}`;

    switch (format) {
      case 'markdown':
        downloadMarkdown(messages, `${filename}.md`, sessionTitle);
        break;
      case 'html':
        downloadHTML(messages, `${filename}.html`, sessionTitle);
        break;
      case 'pdf':
        downloadPDF(messages, filename, sessionTitle);
        break;
    }
  };

  return (
    <ActionMenu
      label="Download chat"
      ariaLabel="Download chat"
      icon={Download}
      iconOnly
      variant="ghost"
      size="sm"
      triggerClassName="touch-hit relative h-6 w-6 p-0 text-muted-foreground hover:text-foreground data-[state=open]:text-foreground"
      className="flex-shrink-0"
      menuClassName="min-w-[180px]"
      items={EXPORT_FORMATS.map((fmt) => ({
        key: fmt.id,
        label: fmt.label,
        icon: fmt.id === 'markdown' ? FileText : FileJson,
        onSelect: () => handleExport(fmt.id as 'markdown' | 'html' | 'pdf'),
      }))}
    />
  );
}
