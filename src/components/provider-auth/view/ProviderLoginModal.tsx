import { createPortal } from 'react-dom';
import { Terminal, X } from 'lucide-react';

import StandaloneShell from '../../standalone-shell/view/StandaloneShell';
import { IS_PLATFORM } from '../../../shared/utils';
import type { LLMProvider } from '../../../types/app';

/**
 * For empty shell instances where no project is provided,
 * we use a default project object to ensure the shell can still function.
 * This prevents errors related to missing project data.
 *
 * `projectId` is set to a well-known sentinel ('default') because the empty
 * shell doesn't correspond to any real project row in the database; any API
 * call that routes through this placeholder must tolerate a missing match.
 */
const DEFAULT_PROJECT_FOR_EMPTY_SHELL = {
  projectId: 'default',
  displayName: 'default',
  fullPath: IS_PLATFORM ? '/workspace' : '',
  path: IS_PLATFORM ? '/workspace' : '',
};

type ProviderLoginModalProps = {
  isOpen: boolean;
  onClose: () => void;
  provider?: LLMProvider;
  onComplete?: (exitCode: number) => void;
  customCommand?: string;
  isAuthenticated?: boolean;
  /** Window title; defaults to the provider's login title. */
  title?: string;
};

const getProviderCommand = ({
  provider,
  customCommand,
  isAuthenticated: _isAuthenticated,
}: {
  provider: LLMProvider;
  customCommand?: string;
  isAuthenticated: boolean;
}) => {
  if (customCommand) {
    return customCommand;
  }

  if (provider === 'claude') {
    return 'claude --dangerously-skip-permissions /login';
  }

  if (provider === 'cursor') {
    return 'cursor-agent login';
  }

  if (provider === 'codex') {
    return IS_PLATFORM ? 'codex login --device-auth' : 'codex login';
  }

  if (provider === 'opencode') {
    return 'opencode auth login';
  }

  return 'claude --dangerously-skip-permissions /login';
};

const getProviderTitle = (provider: LLMProvider) => {
  if (provider === 'claude') return 'Claude Code CLI Login';
  if (provider === 'cursor') return 'Cursor CLI Login';
  if (provider === 'codex') return 'Codex CLI Login';
  if (provider === 'opencode') return 'OpenCode CLI Login';
  return 'Claude Code CLI Login';
};

export default function ProviderLoginModal({
  isOpen,
  onClose,
  provider = 'claude',
  onComplete,
  customCommand,
  isAuthenticated = false,
  title: titleOverride,
}: ProviderLoginModalProps) {
  if (!isOpen) {
    return null;
  }

  const command = getProviderCommand({ provider, customCommand, isAuthenticated });
  const title = titleOverride ?? getProviderTitle(provider);

  const handleComplete = (exitCode: number) => {
    onComplete?.(exitCode);
    // Keep the modal open so users can read terminal output before closing.
  };

  // Portaled to the body so the window covers the viewport from wherever it
  // is opened (a sidebar drawer's animated region would clamp a fixed child).
  // Presses and keys inside it stay inside it: the surfaces beneath (the
  // footer's outside-press listener, a drawer's Escape) must not react to
  // the terminal being used.
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

  return createPortal(
    <div
      className="overlay-enter fixed inset-0 z-[9999] flex items-center justify-center bg-background/60 backdrop-blur-sm max-md:items-stretch max-md:justify-stretch"
      onPointerDown={stop}
      onKeyDown={stop}
    >
      <div
        className="popout-enter popout-enter-center flex h-3/4 w-full max-w-4xl flex-col rounded-lg border border-border bg-background shadow-xl max-md:m-0 max-md:h-full max-md:max-w-none max-md:rounded-none max-md:border-0 md:m-4"
        role="dialog"
        aria-label={title}
        data-slot="shell-window"
      >
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-3 py-1.5">
          <h3 className="flex min-w-0 items-center gap-2 text-xs font-medium text-foreground">
            <Terminal className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            <span className="truncate">{title}</span>
          </h3>
          <button
            onClick={onClose}
            className="touch-hit relative flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close"
            data-slot="shell-window-close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          <StandaloneShell project={DEFAULT_PROJECT_FOR_EMPTY_SHELL} command={command} onComplete={handleComplete} minimal={true} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
