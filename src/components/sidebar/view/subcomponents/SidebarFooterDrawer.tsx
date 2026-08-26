import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import { EASE_IN_OUT } from '../../../../shared/view/beui/ease';

type SidebarFooterDrawerProps = {
  open: boolean;
  onClose: () => void;
  /** Phone renders a full-width bottom sheet portaled over a blur scrim;
      desktop an in-flow region above the footer taskbar. */
  isMobile: boolean;
  ariaLabel: string;
  dataSlot: string;
  children: ReactNode;
};

/**
 * The sidebar footer drawer shell (ui11 phase 5; integrated ui13 job 4).
 * Desktop: no portal, no panel chrome — an in-flow region on the sidebar's
 * own background that unfolds above the taskbar, growing its height so the
 * lists above squish up naturally and ramping back to zero on close (height
 * collapse cannot leave an exit sliver). A trailing divider inside the
 * animated region separates it from the taskbar. Mobile: a full-width bottom
 * sheet over a blur scrim, same ramped curve. Escape closes here; outside
 * taps close via the scrim (mobile) or the footer's outside-press listener
 * (desktop); a second trigger tap toggles.
 */
export default function SidebarFooterDrawer({
  open,
  onClose,
  isMobile,
  ariaLabel,
  dataSlot,
  children,
}: SidebarFooterDrawerProps) {
  const reduceMotion = useReducedMotion();

  // Escape closes the drawer (the Dialog primitive used to own this).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!isMobile) {
    return (
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            role="region"
            aria-label={ariaLabel}
            data-slot={dataSlot}
            className="overflow-hidden"
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.3, ease: EASE_IN_OUT }}
          >
            {children}
            <div className="nav-divider" />
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  const sheet = (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.15 }}
            onClick={onClose}
            aria-hidden
          />
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50">
            <motion.div
              role="dialog"
              aria-label={ariaLabel}
              data-slot={dataSlot}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.32, ease: EASE_IN_OUT }}
              className="pointer-events-auto rounded-t-lg border-t border-border bg-background pb-safe-area-inset-bottom"
            >
              {children}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );

  return createPortal(sheet, document.body);
}
