import { AlertTriangle, X } from 'lucide-react';

import { Button } from '../../shared/view/ui';
import { cn } from '../../lib/utils';
import { useAppMessages } from '../../contexts/AppMessageContext';

/**
 * The app's message strip (audit1 job 8): one non-blocking surface for every
 * user-initiated failure — a strip in the desktop's lower left, a bottom sheet
 * on the phone (drawer law, above the taskbar and inside the home-indicator
 * inset). Entries stay until dismissed or retried; nothing here blocks the
 * surface underneath, and nothing here is a console line.
 */
export default function AppMessageStrip({ isMobile = false }: { isMobile?: boolean }) {
  const { messages, dismissFailure } = useAppMessages();

  if (messages.length === 0) {
    return null;
  }

  return (
    <div
      data-slot="app-message-strip"
      data-layout={isMobile ? 'sheet' : 'strip'}
      data-message-count={messages.length}
      role="alert"
      aria-live="assertive"
      aria-label="Failures"
      className={cn(
        'fixed z-[9998] flex flex-col gap-2',
        isMobile
          ? 'inset-x-0 rounded-t-lg border-t border-border bg-popover px-3 pt-3 shadow-lg'
          // Clear of the sidebar taskbar, whose settings, account and memory
          // controls sit in that same lower-left corner.
          : 'bottom-16 left-4 w-[min(24rem,calc(100vw-2rem))]',
      )}
      style={isMobile
        ? {
          bottom: 'var(--mobile-taskbar-offset, 0px)',
          paddingBottom: 'calc(0.75rem + var(--safe-area-inset-bottom, 0px))',
        }
        : undefined}
    >
      {messages.map((message) => (
        <div
          key={message.id}
          data-slot="app-message"
          data-message-id={message.id}
          className={cn(
            'popout-enter popout-enter-up flex items-start gap-2.5 motion-reduce:animate-none',
            isMobile
              ? 'py-1'
              : 'rounded-lg border border-border bg-popover px-3 py-2.5 text-popover-foreground shadow-lg',
          )}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-5 text-foreground">{message.title}</p>
            {message.detail && (
              <p data-slot="app-message-detail" className="mt-0.5 break-words text-xs leading-4 text-muted-foreground">
                {message.detail}
              </p>
            )}
            {message.retry && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-slot="app-message-retry"
                className="mt-2 h-8 px-3 text-xs"
                onClick={() => {
                  dismissFailure(message.id);
                  void message.retry?.();
                }}
              >
                {message.retryLabel ?? 'Try again'}
              </Button>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-slot="app-message-dismiss"
            aria-label="Dismiss"
            className="touch-hit relative h-6 w-6 flex-shrink-0 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => dismissFailure(message.id)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
