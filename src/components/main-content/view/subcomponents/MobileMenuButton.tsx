import { Menu } from 'lucide-react';

import type { MobileMenuButtonProps } from '../../types/types';
import { useMobileMenuHandlers } from '../../hooks/useMobileMenuHandlers';

export default function MobileMenuButton({ onMenuClick }: MobileMenuButtonProps) {
  const { handleMobileMenuClick, handleMobileMenuTouchEnd } = useMobileMenuHandlers(onMenuClick);

  return (
    <button
      onClick={handleMobileMenuClick}
      onTouchEnd={handleMobileMenuTouchEnd}
      className="touch-hit pwa-menu-button relative flex h-8 w-8 flex-shrink-0 touch-manipulation items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground active:scale-95"
      aria-label="Open menu"
    >
      <Menu className="h-4 w-4" />
    </button>
  );
}
