import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import type { MessageVersionNav } from '../../utils/messageVersions';

/**
 * Claude.ai-style version flipper under a response that has been edited and
 * resent: left arrow, "n / m", right arrow. Always visible (never hover-gated)
 * so alternative versions stay discoverable.
 */
const MessageVersionNavigator = ({
  nav,
  onSelect,
  align = 'start',
}: {
  nav: MessageVersionNav;
  onSelect: (groupId: string, version: number) => void;
  align?: 'start' | 'end';
}) => {
  const { t } = useTranslation('chat');
  const buttonClass =
    'relative touch-hit inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground';

  const step = (offset: number) => {
    const version = nav.versions[nav.current - 1 + offset];
    if (version !== undefined) onSelect(nav.groupId, version);
  };

  return (
    <div
      data-slot="message-version-nav"
      className={`flex items-center gap-0.5 px-3 text-[11px] tabular-nums text-muted-foreground sm:px-0 ${
        align === 'end' ? 'justify-end' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={nav.current <= 1}
        title={t('messageVersions.previous', { defaultValue: 'Previous version' })}
        aria-label={t('messageVersions.previous', { defaultValue: 'Previous version' })}
        className={buttonClass}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span aria-live="polite">{nav.current} / {nav.total}</span>
      <button
        type="button"
        onClick={() => step(1)}
        disabled={nav.current >= nav.total}
        title={t('messageVersions.next', { defaultValue: 'Next version' })}
        aria-label={t('messageVersions.next', { defaultValue: 'Next version' })}
        className={buttonClass}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

export default MessageVersionNavigator;
