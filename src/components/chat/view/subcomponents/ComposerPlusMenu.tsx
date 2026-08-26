import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { PlusIcon, Paperclip, FileTextIcon } from 'lucide-react';
import type { SVGProps } from 'react';

import { useComposerMenuAnchor } from '../../hooks/useComposerMenuAnchor';
import { PromptInputButton } from '../../../../shared/view/ui';

import { ComposerMenuItem } from './ComposerMenuPrimitives';

// Slash-commands icon drawn in the plus icon's visual language: one diagonal
// stroke whose length (14 units) and stroke width match a single plus arm.
export function CommandSlashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M16.95 7.05 7.05 16.95" />
    </svg>
  );
}

interface ComposerPlusMenuProps {
  onUpload: () => void;
  onSlashCommands: () => void;
  onHandoff: () => void;
  /** Handoff applies only to planner project chats, not worker/scratch surfaces. */
  handoffAvailable: boolean;
  className?: string;
}

/**
 * The composer's plus button (ui13 job 12): the attach, slash-commands, and
 * handoff actions collapse into one drawer menu of stacked rows above the
 * button. Opens with the standard popout grow and ramps closed (the exit
 * animation plays before unmount); closes on selection, outside press, or
 * Escape via the shared anchor hook.
 */
export default function ComposerPlusMenu({
  onUpload,
  onSlashCommands,
  onHandoff,
  handoffAvailable,
  className,
}: ComposerPlusMenuProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const close = useCallback(() => setIsClosing(true), []);
  const { triggerRef, menuRef, anchor, updateAnchor } = useComposerMenuAnchor(
    isOpen,
    close,
    280,
    'left',
  );

  const handleExitEnd = useCallback(() => {
    setIsOpen(false);
    setIsClosing(false);
  }, []);

  const selectAndClose = useCallback((action: () => void) => {
    action();
    setIsClosing(true);
  }, []);

  const ariaLabel = t('input.plusMenu', { defaultValue: 'Open composer menu' });

  return (
    <>
      <PromptInputButton
        ref={triggerRef}
        onClick={() => {
          if (isOpen) {
            close();
            return;
          }
          updateAnchor();
          setIsOpen(true);
        }}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={isOpen && !isClosing}
        className={className}
      >
        <PlusIcon />
      </PromptInputButton>

      {isOpen && anchor && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={ariaLabel}
          data-slot="composer-plus-menu"
          onAnimationEnd={isClosing ? handleExitEnd : undefined}
          className={`${isClosing ? 'popout-exit-up' : 'popout-enter popout-enter-up'} fixed z-[100] min-w-48 overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg`}
          style={{
            left: anchor.left,
            bottom: anchor.bottom,
            maxHeight: anchor.maxHeight,
            maxWidth: anchor.maxWidth,
          }}
        >
          <ComposerMenuItem
            role="menuitem"
            label={t('input.uploadFile', { defaultValue: 'Upload a file' })}
            icon={<Paperclip className="h-4 w-4" />}
            isSelected={false}
            onSelect={() => selectAndClose(onUpload)}
            className="touch-hit relative py-2.5"
          />
          <ComposerMenuItem
            role="menuitem"
            label={t('input.slashCommands', { defaultValue: 'Slash commands' })}
            icon={<CommandSlashIcon className="h-4 w-4" />}
            isSelected={false}
            onSelect={() => selectAndClose(onSlashCommands)}
            className="touch-hit relative py-2.5"
          />
          {handoffAvailable && (
            <ComposerMenuItem
              role="menuitem"
              label={t('input.handoff', { defaultValue: 'Handoff' })}
              icon={<FileTextIcon className="h-4 w-4" />}
              isSelected={false}
              onSelect={() => selectAndClose(onHandoff)}
              className="touch-hit relative py-2.5"
            />
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
