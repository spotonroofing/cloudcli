import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  Check,
  ChevronLeft,
  Copy,
  Edit2,
  Folder,
  FolderInput,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Trash2,
  X,
} from 'lucide-react';

import { cn } from '../../../../lib/utils';
import type { Project } from '../../../../types/app';
import { api } from '../../../../utils/api';
import { copyTextToClipboard } from '../../../../utils/clipboard';

const MENU_WIDTH = 260;

type CopyState = 'idle' | 'loading' | 'copying' | 'copied' | 'error';

export type ChatRowMenuProps = {
  sessionId: string;
  sessionTitle: string;
  providerLabel: string;
  /** Move-to-project targets (the drawer lists these). */
  projects: Project[];
  /** The chat's current project, when it has one — drives "Remove from <project>". */
  currentProjectId: string | null;
  currentProjectName: string | null;
  onRename: () => void;
  onMoveToProject: (projectPath: string | null) => void;
  onArchive: () => void;
  onDelete: () => void;
  /** Archive/delete hide while the session is mid-turn. */
  isProcessing?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * The one shared chat-row menu (ui9 B5): every chat row app-wide opens this
 * same component from its trailing three-dots control. Root view: rename,
 * move to project, copy session ID, then archive and delete as separate
 * items. "Move to project" swaps the panel to the anchored project drawer —
 * a downward list with "Remove from <project>" (or standalone) at the top.
 */
export default function ChatRowMenu({
  sessionId,
  sessionTitle,
  providerLabel,
  projects,
  currentProjectId,
  currentProjectName,
  onRename,
  onMoveToProject,
  onArchive,
  onDelete,
  isProcessing = false,
  onOpenChange,
}: ChatRowMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<'root' | 'move'>('root');
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [providerSessionId, setProviderSessionId] = useState<string | null>(null);
  const copyRequestRef = useRef(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const setMenuOpen = useCallback((open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setPosition(null);
      setView('root');
      copyRequestRef.current += 1;
      setCopyState('idle');
      setProviderSessionId(null);
    }
    onOpenChange?.(open);
  }, [onOpenChange]);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    const closeOnViewportChange = () => setMenuOpen(false);

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
    };
  }, [isOpen, setMenuOpen]);

  const loadProviderSessionId = async () => {
    const requestId = ++copyRequestRef.current;
    setCopyState('loading');
    try {
      const response = await api.providerSessionId(sessionId);
      const payload = await response.json();
      const loadedSessionId = payload?.data?.sessionId;
      if (!response.ok || typeof loadedSessionId !== 'string' || !loadedSessionId) {
        throw new Error('Provider session ID is unavailable');
      }
      if (requestId !== copyRequestRef.current) return;
      setProviderSessionId(loadedSessionId);
      setCopyState('idle');
    } catch {
      if (requestId !== copyRequestRef.current) return;
      setProviderSessionId(null);
      setCopyState('error');
    }
  };

  const copyProviderSessionId = async () => {
    if (!providerSessionId) {
      setCopyState('error');
      return;
    }
    setCopyState('copying');
    const didCopy = await copyTextToClipboard(providerSessionId);
    setCopyState(didCopy ? 'copied' : 'error');
  };

  const handleCopyAction = () => {
    if (copyState === 'error' && !providerSessionId) {
      void loadProviderSessionId();
    } else {
      void copyProviderSessionId();
    }
  };

  const toggleMenu = () => {
    if (isOpen) {
      setMenuOpen(false);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      // Downward from the trigger by default; flip up only when out of room.
      const estimatedHeight = 240;
      setPosition({
        top: rect.bottom + 6 + estimatedHeight <= window.innerHeight - 8
          ? rect.bottom + 6
          : Math.max(8, rect.top - estimatedHeight - 6),
        left: Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
      });
    }
    void loadProviderSessionId();
    setMenuOpen(true);
  };

  const selectItem = (action: () => void, close = true) => {
    if (close) setMenuOpen(false);
    action();
  };

  const isCopyPending = copyState === 'loading' || copyState === 'copying';
  const CopyStateIcon = copyState === 'copied' ? Check : Copy;
  const copyLabel = copyState === 'loading'
    ? `Loading ${providerLabel} session ID…`
    : copyState === 'copied'
      ? `${providerLabel} session ID copied`
      : copyState === 'error'
        ? providerSessionId
          ? `Couldn't copy ${providerLabel} session ID`
          : `${providerLabel} session ID unavailable`
        : `Copy ${providerLabel} session ID`;

  const itemClass = (danger = false) => cn(
    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
    'focus:outline-none focus-visible:bg-accent',
    danger
      ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950'
      : 'hover:bg-accent',
  );

  const menu = isOpen && position && (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      data-slot="chat-row-menu"
      className={cn(
        'fixed z-[70] rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-xl',
        'animate-in fade-in-0 zoom-in-95',
      )}
      style={{ ...position, width: MENU_WIDTH }}
    >
      {view === 'root' ? (
        <>
          <div className="mb-1 border-b border-border px-3 py-2">
            <p className="truncate text-xs font-medium text-foreground" title={sessionTitle}>
              {sessionTitle}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{providerLabel} session</p>
          </div>
          <button type="button" role="menuitem" className={itemClass()} onClick={() => selectItem(onRename)}>
            <Edit2 className="h-4 w-4 flex-shrink-0" />
            <span className="min-w-0 flex-1 truncate font-medium">Rename chat</span>
          </button>
          <button
            type="button"
            role="menuitem"
            data-slot="chat-row-menu-move"
            className={itemClass()}
            onClick={() => setView('move')}
          >
            <FolderInput className="h-4 w-4 flex-shrink-0" />
            <span className="min-w-0 flex-1 truncate font-medium">Move to project</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={isCopyPending}
            className={cn(itemClass(), isCopyPending && 'cursor-not-allowed opacity-50')}
            onClick={handleCopyAction}
          >
            {isCopyPending ? (
              <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" />
            ) : (
              <CopyStateIcon className="h-4 w-4 flex-shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate font-medium">{copyLabel}</span>
          </button>
          {!isProcessing && (
            <>
              <div className="mx-2 my-1 h-px bg-border" />
              <button
                type="button"
                role="menuitem"
                data-slot="chat-row-menu-archive"
                className={itemClass()}
                onClick={() => selectItem(onArchive)}
              >
                <Archive className="h-4 w-4 flex-shrink-0" />
                <span className="min-w-0 flex-1 truncate font-medium">Archive chat</span>
              </button>
              <button
                type="button"
                role="menuitem"
                data-slot="chat-row-menu-delete"
                className={itemClass(true)}
                onClick={() => selectItem(onDelete)}
              >
                <Trash2 className="h-4 w-4 flex-shrink-0" />
                <span className="min-w-0 flex-1 truncate font-medium">Delete chat</span>
              </button>
            </>
          )}
        </>
      ) : (
        <div data-slot="chat-row-move-drawer">
          <button
            type="button"
            className="mb-1 flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setView('root')}
          >
            <ChevronLeft className="h-3.5 w-3.5 flex-shrink-0" />
            Move to project
          </button>
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {currentProjectId ? (
              <button
                type="button"
                role="menuitem"
                data-slot="chat-row-move-remove"
                className={itemClass()}
                onClick={() => selectItem(() => onMoveToProject(null))}
              >
                <X className="h-4 w-4 flex-shrink-0" />
                <span className="min-w-0 flex-1 truncate font-medium">
                  Remove from {currentProjectName ?? 'project'}
                </span>
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                className={itemClass()}
                onClick={() => selectItem(() => onMoveToProject(null))}
              >
                <MessageSquare className="h-4 w-4 flex-shrink-0" />
                <span className="min-w-0 flex-1 truncate font-medium">No project (standalone)</span>
              </button>
            )}
            {projects
              .filter((project) => project.projectId !== currentProjectId)
              .map((project) => (
                <button
                  key={project.projectId}
                  type="button"
                  role="menuitem"
                  className={itemClass()}
                  onClick={() => selectItem(() => onMoveToProject(project.fullPath || project.path || ''))}
                >
                  <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{project.displayName || project.projectId}</span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-slot="chat-row-dots"
        aria-label={`Chat options for ${sessionTitle}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        className={cn(
          'touch-hit absolute inset-0 flex items-center justify-center rounded-md text-muted-foreground transition-all duration-150',
          'hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          // Arrow-to-dots morph: hidden at rest on desktop, revealed on row
          // hover (or while the menu is open); always reachable on touch.
          isOpen
            ? 'scale-100 opacity-100'
            : 'md:scale-50 md:opacity-0 md:group-hover:scale-100 md:group-hover:opacity-100',
        )}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleMenu();
        }}
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {typeof document !== 'undefined' && createPortal(menu, document.body)}
    </>
  );
}
