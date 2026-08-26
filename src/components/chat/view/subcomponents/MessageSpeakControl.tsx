import { Volume2, Loader2, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ActionSwapIcon } from '../../../../shared/view/beui/ActionSwap';
import { useTts } from '../../hooks/useTts';
import { useVoiceAvailable } from '../../hooks/useVoiceAvailable';

// Tap-to-speak button beside the copy control on assistant messages.
// Renders nothing unless the optional voice feature is enabled.
const MessageSpeakControl = ({ content }: { content: string }) => {
  const { t } = useTranslation('chat');
  const available = useVoiceAvailable();
  const { state, toggle, error } = useTts(() => content);

  if (!available) return null;

  const title =
    state === 'playing' ? t('voice.stopSpeaking') : state === 'loading' ? t('voice.loading') : t('voice.speak');

  return (
    // Hover-gated with the copy button beside it, except mid-playback where
    // the stop control must stay reachable; always visible on coarse pointers.
    <span className={`relative inline-flex ${
      state === 'playing' || state === 'loading'
        ? ''
        : 'transition-opacity duration-200 opacity-0 group-hover:opacity-100 touch:opacity-100'
    }`}>
      {error && (
        <span className="popout-enter popout-enter-up absolute bottom-full left-1/2 z-10 mb-1 max-w-[240px] -translate-x-1/2 whitespace-normal rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-center text-xs text-destructive shadow-lg">
          {error}
        </span>
      )}
      <button
        type="button"
        onClick={toggle}
        title={title}
        aria-label={title}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <ActionSwapIcon value={state} className="h-3.5 w-3.5">
          {state === 'playing' ? (
            <Square className="h-3.5 w-3.5" />
          ) : state === 'loading' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Volume2 className="h-3.5 w-3.5" />
          )}
        </ActionSwapIcon>
      </button>
    </span>
  );
};

export default MessageSpeakControl;
