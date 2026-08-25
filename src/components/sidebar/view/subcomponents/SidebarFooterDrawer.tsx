import { useEffect, useLayoutEffect, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import { EASE_OUT } from '../../../../shared/view/beui/ease';
import { cn } from '../../../../lib/utils';

type SidebarFooterDrawerProps = {
  open: boolean;
  onClose: () => void;
  /** Phone renders a full-width bottom sheet; desktop a sidebar-width drawer
      rising from the anchor block. Both portal to the body — the sidebar's
      backdrop-blur makes it the containing block for `fixed` descendants, so
      an in-tree backdrop could never cover the main pane. */
  isMobile: boolean;
  /** Desktop anchor: the accounts/settings block the drawer rises from. */
  anchorRef: RefObject<HTMLDivElement>;
  ariaLabel: string;
  dataSlot: string;
  children: ReactNode;
};

/**
 * The sidebar footer drawer shell (ui11 phase 5; shared with the counter
 * drawers in phase 12): slides up from just above the accounts/settings block,
 * overlaying the project and chat lists, and reverse-slides closed. A second
 * tap on the trigger, Escape, or an outside tap closes it — the transparent
 * full-viewport backdrop catches outside taps.
 */
export default function SidebarFooterDrawer({
  open,
  onClose,
  isMobile,
  anchorRef,
  ariaLabel,
  dataSlot,
  children,
}: SidebarFooterDrawerProps) {
  const reduceMotion = useReducedMotion();

  // Desktop drawer geometry: measured from the anchor block on open, so the
  // portaled panel sits flush over the sidebar with its bottom edge just
  // above the accounts/settings rows.
  const [anchorStyle, setAnchorStyle] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open || isMobile) {
      setAnchorStyle(null);
      return;
    }
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) {
      setAnchorStyle({ left: rect.left, width: rect.width, bottom: window.innerHeight - rect.top });
    }
  }, [open, isMobile, anchorRef]);

  // Escape closes the drawer (the Dialog primitive used to own this).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const drawer = (
    <AnimatePresence>
      {open && (isMobile || anchorStyle) && (
        <>
          <motion.div
            className={cn('fixed inset-0 z-40', isMobile ? 'bg-background/60 backdrop-blur-sm' : 'bg-transparent')}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.15 }}
            onClick={onClose}
            aria-hidden
          />
          <div
            className={cn(
              'pointer-events-none fixed z-50',
              isMobile ? 'inset-x-0 bottom-0' : 'overflow-hidden px-1.5 pb-1',
            )}
            style={isMobile ? undefined : anchorStyle ?? undefined}
          >
            <motion.div
              role="dialog"
              aria-label={ariaLabel}
              data-slot={dataSlot}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: EASE_OUT }}
              className={cn(
                'pointer-events-auto border-border bg-popover shadow-lg',
                isMobile
                  ? 'border-t rounded-t-lg pb-safe-area-inset-bottom'
                  : 'rounded-lg border',
              )}
            >
              {children}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );

  return createPortal(drawer, document.body);
}
