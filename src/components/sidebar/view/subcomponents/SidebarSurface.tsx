import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import { EASE_IN_OUT } from '../../../../shared/view/beui/ease';

type SidebarSurfaceProps = {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  dataSlot: string;
  children: ReactNode;
};

/**
 * Full-sidebar slide-up surface (ui13 job 5): Settings and Memory fill the
 * sidebar's content area above the footer taskbar — not a centered popup, not
 * a floating panel. No portal, no panel chrome: the sidebar's own background,
 * sliding up from the taskbar edge on the ramped curve. Escape closes here;
 * the surface's taskbar icon toggles it.
 */
export default function SidebarSurface({
  open,
  onClose,
  ariaLabel,
  dataSlot,
  children,
}: SidebarSurfaceProps) {
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          role="region"
          aria-label={ariaLabel}
          data-slot={dataSlot}
          className="absolute inset-0 z-20 flex flex-col overflow-hidden bg-background"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.32, ease: EASE_IN_OUT }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
