import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Download, FileText, FolderPlus, Pencil, RefreshCw, Trash2, Upload, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from '../../../lib/utils';
import { EASE_OUT } from '../../../shared/view/beui/ease';

// beUI context-menu motion token (beui.dev/components/motion/context-menu):
// shared-layout glides for the active-item highlight. Not yet in the vendored
// ease.ts, so defined locally.
const SPRING_LAYOUT = {
  type: 'spring',
  stiffness: 360,
  damping: 32,
  mass: 0.6,
} as const;

type FileContextItem = {
  name: string;
  type: 'file' | 'directory';
  path: string;
  size?: number;
  modified?: string;
  permissionsRwx?: string;
  children?: FileContextItem[];
  [key: string]: unknown;
};

type ContextMenuAction = {
  key: string;
  label: string;
  icon?: LucideIcon;
  onSelect?: () => void;
  isDanger?: boolean;
  isDisabled?: boolean;
  shortcut?: string;
  showDividerBefore?: boolean;
};

const CONTEXT_MENU_WIDTH = 224;
const CONTEXT_MENU_HEIGHT = 300;
const VIEWPORT_PADDING = 10;
const MORPH_DURATION = 0.3;

function calculateViewportSafePosition(clientX: number, clientY: number) {
  // Keep the context menu inside the visible viewport.
  const safeX =
    clientX + CONTEXT_MENU_WIDTH > window.innerWidth
      ? window.innerWidth - CONTEXT_MENU_WIDTH - VIEWPORT_PADDING
      : clientX;
  const safeY =
    clientY + CONTEXT_MENU_HEIGHT > window.innerHeight
      ? window.innerHeight - CONTEXT_MENU_HEIGHT - VIEWPORT_PADDING
      : clientY;

  return { x: Math.max(VIEWPORT_PADDING, safeX), y: Math.max(VIEWPORT_PADDING, safeY) };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// The collapsed clip the panel unfolds from — a small window around the cursor
// point (beUI context-menu morph, radius mapped to the app token).
function collapsedClip(origin: { x: number; y: number }, size: { width: number; height: number }) {
  const half = 8;
  const top = clamp(origin.y - half, 0, size.height);
  const right = clamp(size.width - origin.x - half, 0, size.width);
  const bottom = clamp(size.height - origin.y - half, 0, size.height);
  const left = clamp(origin.x - half, 0, size.width);
  return `inset(${top}px ${right}px ${bottom}px ${left}px round 8px)`;
}

export default function FileContextMenu({
  children,
  item,
  onRename,
  onDelete,
  onNewFile,
  onNewFolder,
  onUpload,
  onRefresh,
  onCopyPath,
  onDownload,
  isLoading = false,
  className = '',
}: {
  children: ReactNode;
  item?: FileContextItem | null;
  onRename?: (item: FileContextItem) => void;
  onDelete?: (item: FileContextItem) => void;
  onNewFile?: (path: string) => void;
  onNewFolder?: (path: string) => void;
  onUpload?: (path: string) => void;
  onRefresh?: () => void;
  onCopyPath?: (item: FileContextItem) => void;
  onDownload?: (item: FileContextItem) => void;
  isLoading?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [clickPoint, setClickPoint] = useState({ x: 0, y: 0 });
  const [morphOrigin, setMorphOrigin] = useState({ x: 0, y: 0 });
  const [panelSize, setPanelSize] = useState({ width: 0, height: 0 });
  const [morphReady, setMorphReady] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const highlightId = useId();
  const reduceMotion = useReducedMotion() ?? false;

  const closeContextMenu = useCallback(() => {
    setIsMenuOpen(false);
    setActiveKey(null);
  }, []);

  const openContextMenuAtCursor = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    setClickPoint({ x: event.clientX, y: event.clientY });
    setMenuPosition(calculateViewportSafePosition(event.clientX, event.clientY));
    setActiveKey(null);
    setIsMenuOpen(true);
  }, []);

  const runMenuActionAndClose = useCallback((action?: () => void) => {
    closeContextMenu();
    action?.();
  }, [closeContextMenu]);

  const menuActions = useMemo<ContextMenuAction[]>(() => {
    if (item?.type === 'file') {
      return [
        {
          key: 'rename',
          icon: Pencil,
          label: t('fileTree.context.rename', 'Rename'),
          onSelect: () => onRename?.(item),
        },
        {
          key: 'delete',
          icon: Trash2,
          label: t('fileTree.context.delete', 'Delete'),
          onSelect: () => onDelete?.(item),
          isDanger: true,
        },
        {
          key: 'copyPath',
          icon: Copy,
          label: t('fileTree.context.copyPath', 'Copy Path'),
          onSelect: () => onCopyPath?.(item),
          showDividerBefore: true,
        },
        {
          key: 'download',
          icon: Download,
          label: t('fileTree.context.download', 'Download'),
          onSelect: () => onDownload?.(item),
        },
      ];
    }

    if (item?.type === 'directory') {
      return [
        {
          key: 'newFile',
          icon: FileText,
          label: t('fileTree.context.newFile', 'New File'),
          onSelect: () => onNewFile?.(item.path),
        },
        {
          key: 'newFolder',
          icon: FolderPlus,
          label: t('fileTree.context.newFolder', 'New Folder'),
          onSelect: () => onNewFolder?.(item.path),
        },
        {
          key: 'upload',
          icon: Upload,
          label: t('fileTree.context.upload', 'Upload Files'),
          onSelect: () => onUpload?.(item.path),
        },
        {
          key: 'rename',
          icon: Pencil,
          label: t('fileTree.context.rename', 'Rename'),
          onSelect: () => onRename?.(item),
          showDividerBefore: true,
        },
        {
          key: 'delete',
          icon: Trash2,
          label: t('fileTree.context.delete', 'Delete'),
          onSelect: () => onDelete?.(item),
          isDanger: true,
        },
        {
          key: 'copyPath',
          icon: Copy,
          label: t('fileTree.context.copyPath', 'Copy Path'),
          onSelect: () => onCopyPath?.(item),
          showDividerBefore: true,
        },
        {
          key: 'download',
          icon: Download,
          label: t('fileTree.context.download', 'Download'),
          onSelect: () => onDownload?.(item),
        },
      ];
    }

    return [
      {
        key: 'newFile',
        icon: FileText,
        label: t('fileTree.context.newFile', 'New File'),
        onSelect: () => onNewFile?.(''),
      },
      {
        key: 'newFolder',
        icon: FolderPlus,
        label: t('fileTree.context.newFolder', 'New Folder'),
        onSelect: () => onNewFolder?.(''),
      },
      {
        key: 'upload',
        icon: Upload,
        label: t('fileTree.context.upload', 'Upload Files'),
        onSelect: () => onUpload?.(''),
      },
      {
        key: 'refresh',
        icon: RefreshCw,
        label: t('fileTree.context.refresh', 'Refresh'),
        onSelect: onRefresh,
        showDividerBefore: true,
      },
    ];
  }, [item, onCopyPath, onDelete, onDownload, onNewFile, onNewFolder, onRefresh, onRename, onUpload, t]);

  // Measure the rendered panel, refine the viewport-safe position with the
  // real size, and stage the beUI unfold: paint one frame at the collapsed
  // clip around the cursor before expanding (two rAFs so the states can't
  // batch into a no-morph appearance).
  useLayoutEffect(() => {
    if (!isMenuOpen) {
      setMorphReady(false);
      return;
    }
    const menuElement = menuRef.current;
    if (!menuElement) {
      return;
    }

    const rect = menuElement.getBoundingClientRect();
    const left = Math.max(
      VIEWPORT_PADDING,
      Math.min(clickPoint.x, window.innerWidth - rect.width - VIEWPORT_PADDING),
    );
    const top = Math.max(
      VIEWPORT_PADDING,
      Math.min(clickPoint.y, window.innerHeight - rect.height - VIEWPORT_PADDING),
    );

    setMenuPosition({ x: left, y: top });
    setPanelSize({ width: rect.width, height: rect.height });
    setMorphOrigin({
      x: clamp(clickPoint.x - left, 12, Math.max(12, rect.width - 12)),
      y: clamp(clickPoint.y - top, 12, Math.max(12, rect.height - 12)),
    });
    setMorphReady(false);

    if (reduceMotion) {
      setMorphReady(true);
      return;
    }

    let openFrame = 0;
    const prepareFrame = requestAnimationFrame(() => {
      openFrame = requestAnimationFrame(() => setMorphReady(true));
    });
    return () => {
      cancelAnimationFrame(prepareFrame);
      cancelAnimationFrame(openFrame);
    };
  }, [isMenuOpen, clickPoint, reduceMotion]);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const handleOutsideMouseDown = (event: MouseEvent) => {
      const menuElement = menuRef.current;
      if (menuElement && !menuElement.contains(event.target as Node)) {
        closeContextMenu();
      }
    };

    const handleEscapeKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu();
      }
    };

    document.addEventListener('mousedown', handleOutsideMouseDown);
    document.addEventListener('keydown', handleEscapeKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideMouseDown);
      document.removeEventListener('keydown', handleEscapeKeyDown);
    };
  }, [closeContextMenu, isMenuOpen]);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    // Arrow key support keeps the menu accessible without a mouse.
    const handleKeyboardMenuNavigation = (event: KeyboardEvent) => {
      const menuItems = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])');
      if (!menuItems || menuItems.length === 0) {
        return;
      }

      const activeElement = document.activeElement as HTMLElement | null;
      const currentIndex = Array.from(menuItems).findIndex((menuItem) => menuItem === activeElement);

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const nextIndex = currentIndex < menuItems.length - 1 ? currentIndex + 1 : 0;
        menuItems[nextIndex]?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const previousIndex = currentIndex > 0 ? currentIndex - 1 : menuItems.length - 1;
        menuItems[previousIndex]?.focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        if (activeElement?.hasAttribute('role')) {
          event.preventDefault();
          activeElement.click();
        }
      }
    };

    document.addEventListener('keydown', handleKeyboardMenuNavigation);

    return () => {
      document.removeEventListener('keydown', handleKeyboardMenuNavigation);
    };
  }, [isMenuOpen]);

  return (
    <>
      <div onContextMenu={openContextMenuAtCursor} className={cn('contents', className)}>
        {children}
      </div>

      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            key="file-context-menu"
            initial={false}
            exit={{ opacity: 0, transition: { duration: 0.15, ease: EASE_OUT } }}
            style={{ position: 'fixed', left: menuPosition.x, top: menuPosition.y, zIndex: 9999 }}
            className="[filter:drop-shadow(0_18px_28px_rgba(0,0,0,0.2))]"
          >
            <motion.div
              ref={menuRef}
              role="menu"
              data-slot="context-menu"
              aria-label={t('fileTree.context.menuLabel', 'File context menu')}
              initial={false}
              animate={{
                opacity: morphReady ? 1 : 0,
                clipPath:
                  reduceMotion || morphReady
                    ? 'inset(0px 0px 0px 0px round 8px)'
                    : collapsedClip(morphOrigin, panelSize),
              }}
              transition={
                reduceMotion
                  ? { duration: 0.1, ease: EASE_OUT }
                  : {
                      clipPath: { duration: MORPH_DURATION, ease: EASE_OUT },
                      opacity: { duration: MORPH_DURATION, ease: EASE_OUT },
                    }
              }
              onContextMenu={(event) => event.preventDefault()}
              className="min-w-56 overflow-hidden rounded-lg border border-border bg-popover p-1.5 text-popover-foreground outline-none"
            >
              {isLoading ? (
                <div className="flex items-center justify-center py-4">
                  <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">{t('fileTree.context.loading', 'Loading...')}</span>
                </div>
              ) : (
                menuActions.map((action) => (
                  <Fragment key={action.key}>
                    {action.showDividerBefore && <hr className="-mx-1 my-1 h-px border-0 bg-border" />}
                    <button
                      role="menuitem"
                      tabIndex={action.isDisabled ? -1 : 0}
                      disabled={isLoading || action.isDisabled}
                      onFocus={() => setActiveKey(action.key)}
                      onPointerMove={(event) => {
                        if (!action.isDisabled && event.pointerType !== 'touch') {
                          event.currentTarget.focus();
                        }
                      }}
                      onClick={() => runMenuActionAndClose(action.onSelect)}
                      className={cn(
                        'relative isolate flex w-full select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] outline-none',
                        'focus-visible:ring-2 focus-visible:ring-foreground/15',
                        'disabled:pointer-events-none disabled:opacity-40',
                        action.isDisabled && 'cursor-not-allowed opacity-50',
                        action.isDanger ? 'text-rose-600 dark:text-rose-400' : 'text-foreground',
                        isLoading && 'pointer-events-none',
                      )}
                    >
                      {activeKey === action.key && (
                        <motion.span
                          layoutId={`${highlightId}-active`}
                          className={cn(
                            'absolute inset-0 -z-10 rounded-md',
                            action.isDanger ? 'bg-rose-500/10' : 'bg-foreground/[0.065]',
                          )}
                          transition={reduceMotion ? { duration: 0 } : SPRING_LAYOUT}
                        />
                      )}
                      {action.icon && <action.icon className="h-4 w-4 flex-shrink-0" />}
                      <span className="flex-1">{action.label}</span>
                      {action.shortcut && <span className="font-mono text-xs text-muted-foreground">{action.shortcut}</span>}
                    </button>
                  </Fragment>
                ))
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
