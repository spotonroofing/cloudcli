import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ActionSwapIcon } from '../../../../shared/view/beui/ActionSwap';
import { copyTextToClipboard } from '../../../../utils/clipboard';

const COPY_SUCCESS_TIMEOUT_MS = 2000;

// Converts markdown into readable plain text; the copy button always copies plain text.
export const convertMarkdownToPlainText = (markdown: string): string => {
  let plainText = markdown.replace(/\r\n/g, '\n');
  const codeBlocks: string[] = [];
  plainText = plainText.replace(/```[\w-]*\n([\s\S]*?)```/g, (_match, code: string) => {
    const placeholder = `@@CODEBLOCK${codeBlocks.length}@@`;
    codeBlocks.push(code.replace(/\n$/, ''));
    return placeholder;
  });
  plainText = plainText.replace(/`([^`]+)`/g, '$1');
  plainText = plainText.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1');
  plainText = plainText.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  plainText = plainText.replace(/^>\s?/gm, '');
  plainText = plainText.replace(/^#{1,6}\s+/gm, '');
  plainText = plainText.replace(/^[-*+]\s+/gm, '');
  plainText = plainText.replace(/^\d+\.\s+/gm, '');
  plainText = plainText.replace(/(\*\*|__)(.*?)\1/g, '$2');
  plainText = plainText.replace(/(\*|_)(.*?)\1/g, '$2');
  plainText = plainText.replace(/~~(.*?)~~/g, '$1');
  plainText = plainText.replace(/<\/?[^>]+(>|$)/g, '');
  plainText = plainText.replace(/\n{3,}/g, '\n\n');
  plainText = plainText.replace(/@@CODEBLOCK(\d+)@@/g, (_match, index: string) => codeBlocks[Number(index)] ?? '');
  return plainText.trim();
};

const MessageCopyControl = ({ content }: { content: string; messageType?: 'user' | 'assistant' }) => {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);
  const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyPayload = useMemo(() => convertMarkdownToPlainText(content), [content]);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current) {
        clearTimeout(copyFeedbackTimerRef.current);
      }
    };
  }, []);

  const handleCopyClick = async () => {
    if (!copyPayload.trim()) return;
    const didCopy = await copyTextToClipboard(copyPayload);
    if (!didCopy) return;

    setCopied(true);
    if (copyFeedbackTimerRef.current) {
      clearTimeout(copyFeedbackTimerRef.current);
    }
    copyFeedbackTimerRef.current = setTimeout(() => {
      setCopied(false);
    }, COPY_SUCCESS_TIMEOUT_MS);
  };

  const copyTitle = copied ? t('copyMessage.copied') : t('copyMessage.copy');

  return (
    // Hover-gated like the timestamp (message furniture stays out of the way);
    // always visible on touch via the md: fence.
    <div className="relative flex items-center transition-opacity duration-200 md:opacity-0 md:group-hover:opacity-100">
      <button
        type="button"
        onClick={handleCopyClick}
        title={copyTitle}
        aria-label={copyTitle}
        className="inline-flex items-center rounded px-1 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <ActionSwapIcon value={copied ? 'copied' : 'copy'} className="h-3.5 w-3.5">
          {copied ? (
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          )}
        </ActionSwapIcon>
      </button>
    </div>
  );
};

export default MessageCopyControl;
