import { Fragment, useRef, useState } from 'react';
import type React from 'react';

import MainContent from '../../main-content/view/MainContent';
import type { MainContentProps } from '../../main-content/types/types';
import type { Project } from '../../../types/app';
import { cn } from '../../../lib/utils';
import { STANDALONE_PROJECT_ID } from '../../../types/app';

import WorkspaceRow, { type WorkspaceGripHandlers } from './WorkspaceRow';
import { PaneDivider } from './PaneStrip';
import { PROJECT_DRAG_TYPE, type WorkspaceState } from './useWorkspace';

type WorkspaceViewProps = MainContentProps & {
  projects: Project[];
  workspace: WorkspaceState;
  /** Removes a row; when it is the primary the app re-selects the next open project. */
  onCloseRow: (projectId: string) => void;
  /** Global New Session flow for a project (the primary row's + button). */
  onNewProjectSession: (project: Project) => void;
};

type DragState = {
  projectId: string;
  /** Insertion boundary in the current order (0..n). */
  boundaryIndex: number;
  /** Snap-guide position in px, relative to the workspace container. */
  guideOffset: number;
  /** Rows mode only: grip drag held at a side edge converts to columns (ui9 B5). */
  edge: 'left' | 'right' | null;
};

/** Edge drop zone while a sidebar project row is dragged over the view. */
type DropZone = 'left' | 'right' | 'bottom';

const MIN_UNIT_PX = 160;
/** Width of the rows-mode side strips that arm the convert-to-columns drop. */
const EDGE_CONVERT_PX = 56;

/**
 * The desktop app surface around MainContent (phase 7): with one open project
 * it renders MainContent exactly as before; once a second project is opened it
 * becomes the multi-project workspace — one row per project (planner pane +
 * worker pane), stacked so planners align over planners, or side by side as
 * planner/worker columns behind the layout toggle. Rows and panes resize via
 * dividers, and dragging a row's grip rearranges projects with a visible snap
 * guide at the drop boundary.
 */
export default function WorkspaceView({
  projects,
  workspace,
  onCloseRow,
  onNewProjectSession,
  ...mainContentProps
}: WorkspaceViewProps) {
  const {
    selectedProject,
    selectedSession,
    ws,
    sendMessage,
    isMobile,
    onInputFocusChange,
    onSessionProcessing,
    onSessionIdle,
    processingSessions,
    onNavigateToSession,
    onSessionEstablished,
    onShowSettings,
    externalMessageUpdate,
    newSessionTrigger,
    onProjectSelect,
    onProjectsRefresh,
  } = mainContentProps;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropZone, setDropZone] = useState<DropZone | null>(null);
  const resizeRef = useRef<{
    idA: string;
    idB: string;
    startPos: number;
    weightA: number;
    weightB: number;
    pixels: number;
  } | null>(null);

  const horizontal = workspace.mode === 'columns';

  const measureUnits = () => {
    const container = containerRef.current;
    if (!container) {
      return null;
    }
    const units = Array.from(container.querySelectorAll<HTMLElement>('[data-workspace-unit]'));
    return units.length > 0 ? { container, rects: units.map((el) => el.getBoundingClientRect()) } : null;
  };

  const updateDragTarget = (projectId: string, clientX: number, clientY: number) => {
    const measured = measureUnits();
    if (!measured) {
      return;
    }
    const { container, rects } = measured;

    // Rows mode: holding the grip at the container's left or right edge stops
    // being a reorder and becomes a convert-to-columns drop (ui9 B5).
    if (!horizontal) {
      const containerRect = container.getBoundingClientRect();
      const edge = clientX <= containerRect.left + EDGE_CONVERT_PX
        ? 'left' as const
        : clientX >= containerRect.right - EDGE_CONVERT_PX
          ? 'right' as const
          : null;
      if (edge) {
        setDrag({ projectId, boundaryIndex: 0, guideOffset: 0, edge });
        return;
      }
    }

    const pointer = horizontal ? clientX : clientY;
    const start = (rect: DOMRect) => (horizontal ? rect.left : rect.top);
    const end = (rect: DOMRect) => (horizontal ? rect.right : rect.bottom);

    // Snap zones: the container edges plus each gap between adjacent units.
    const boundaries: number[] = [start(rects[0])];
    for (let index = 1; index < rects.length; index += 1) {
      boundaries.push((end(rects[index - 1]) + start(rects[index])) / 2);
    }
    boundaries.push(end(rects[rects.length - 1]));

    let boundaryIndex = 0;
    let bestDistance = Infinity;
    boundaries.forEach((boundary, index) => {
      const distance = Math.abs(pointer - boundary);
      if (distance < bestDistance) {
        bestDistance = distance;
        boundaryIndex = index;
      }
    });

    const containerRect = container.getBoundingClientRect();
    const guideOffset = boundaries[boundaryIndex] - (horizontal ? containerRect.left : containerRect.top);
    setDrag({ projectId, boundaryIndex, guideOffset, edge: null });
  };

  const makeGripHandlers = (projectId: string): WorkspaceGripHandlers => ({
    onPointerDown: (event) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      updateDragTarget(projectId, event.clientX, event.clientY);
    },
    onPointerMove: (event) => {
      if (drag?.projectId !== projectId) {
        return;
      }
      updateDragTarget(projectId, event.clientX, event.clientY);
    },
    onPointerUp: () => {
      if (drag?.projectId === projectId) {
        if (drag.edge) {
          workspace.openProjectAt(
            drag.projectId,
            drag.edge === 'left' ? 0 : workspace.order.length,
            'columns',
          );
        } else {
          workspace.moveProject(drag.projectId, drag.boundaryIndex);
        }
      }
      setDrag(null);
    },
    onPointerCancel: () => setDrag(null),
  });

  const handleDividerPointerDown =
    (idA: string, idB: string) => (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const elA = container.querySelector<HTMLElement>(`[data-workspace-unit="${CSS.escape(idA)}"]`);
      const elB = container.querySelector<HTMLElement>(`[data-workspace-unit="${CSS.escape(idB)}"]`);
      if (!elA || !elB) {
        return;
      }
      const rectA = elA.getBoundingClientRect();
      const rectB = elB.getBoundingClientRect();
      resizeRef.current = {
        idA,
        idB,
        startPos: horizontal ? event.clientX : event.clientY,
        weightA: workspace.weights[idA] ?? 1,
        weightB: workspace.weights[idB] ?? 1,
        pixels: horizontal ? rectA.width + rectB.width : rectA.height + rectB.height,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    };

  const handleDividerPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = resizeRef.current;
    if (!state || state.pixels <= 0) {
      return;
    }
    const pointer = horizontal ? event.clientX : event.clientY;
    const total = state.weightA + state.weightB;
    const delta = ((pointer - state.startPos) / state.pixels) * total;
    const minWeight = Math.min(total / 2, (MIN_UNIT_PX / state.pixels) * total);
    const nextA = Math.min(total - minWeight, Math.max(minWeight, state.weightA + delta));
    workspace.setPairWeights(state.idA, nextA, state.idB, total - nextA);
  };

  const handleDividerPointerEnd = () => {
    resizeRef.current = null;
  };

  // Drag-to-combine (phase 5): a sidebar project row dragged over the view
  // offers edge drop zones — left/right edge opens the project as a column,
  // bottom edge as a stacked row — each marked by a zone wash and the same
  // 2px snap guide the grip drag uses.
  // (Archived deep links keep the single-project surface, so no zones there.)
  const canCombine =
    !isMobile
    && selectedProject?.projectId !== STANDALONE_PROJECT_ID
    && projects.some((project) => project.projectId === selectedProject?.projectId);

  const zoneFromPointer = (clientX: number, clientY: number): DropZone | null => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < rect.width * 0.2) {
      return 'left';
    }
    if (x > rect.width * 0.8) {
      return 'right';
    }
    return y > rect.height * 0.75 ? 'bottom' : null;
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!canCombine || !event.dataTransfer.types.includes(PROJECT_DRAG_TYPE)) {
      return;
    }
    event.preventDefault();
    const zone = zoneFromPointer(event.clientX, event.clientY);
    event.dataTransfer.dropEffect = zone ? 'move' : 'none';
    setDropZone(zone);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget as Node)) {
      return;
    }
    setDropZone(null);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    setDropZone(null);
    if (!canCombine) {
      return;
    }
    const projectId = event.dataTransfer.getData(PROJECT_DRAG_TYPE);
    if (!projectId || !projects.some((project) => project.projectId === projectId)) {
      return;
    }
    // Dropping the sole open project onto its own view changes nothing visible;
    // don't let it silently flip the persisted layout mode.
    if (workspace.order.length <= 1 && projectId === selectedProject?.projectId) {
      return;
    }
    event.preventDefault();
    const zone = zoneFromPointer(event.clientX, event.clientY);
    if (!zone) {
      return;
    }
    if (zone === 'left') {
      workspace.openProjectAt(projectId, 0, 'columns');
    } else {
      workspace.openProjectAt(projectId, workspace.order.length, zone === 'right' ? 'columns' : 'rows');
    }
  };

  const dropOverlay = dropZone && (
    <>
      <div
        data-workspace-drop-zone={dropZone}
        className="pointer-events-none absolute z-30 bg-primary/[0.07]"
        style={
          dropZone === 'left'
            ? { top: 0, bottom: 0, left: 0, width: '20%' }
            : dropZone === 'right'
              ? { top: 0, bottom: 0, right: 0, width: '20%' }
              : { left: 0, right: 0, bottom: 0, height: '25%' }
        }
      />
      <div
        data-workspace-drop-guide
        className="pointer-events-none absolute z-30 rounded-sm bg-primary shadow-[0_0_8px_2px] shadow-primary/40"
        style={
          dropZone === 'left'
            ? { top: 4, bottom: 4, left: 4, width: 2 }
            : dropZone === 'right'
              ? { top: 4, bottom: 4, right: 4, width: 2 }
              : { left: 4, right: 4, bottom: 4, height: 2 }
        }
      />
    </>
  );

  const surfaceProps = {
    ref: surfaceRef,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  };

  // The workspace activates only on desktop, with two or more resolvable open
  // projects, while the URL-driven selection is one of them (standalone chats
  // and archived deep links keep the single-project surface).
  const multiProjects = (() => {
    if (isMobile || workspace.order.length < 2 || !selectedProject) {
      return null;
    }
    if (!workspace.order.includes(selectedProject.projectId)) {
      return null;
    }
    const resolved = workspace.order
      .map((id) =>
        id === selectedProject.projectId
          ? selectedProject
          : projects.find((project) => project.projectId === id),
      )
      .filter((project): project is Project => Boolean(project));
    return resolved.length >= 2 ? resolved : null;
  })();

  if (!multiProjects) {
    return (
      <div {...surfaceProps} className="relative h-full min-h-0 min-w-0">
        <MainContent {...mainContentProps} />
        {dropOverlay}
      </div>
    );
  }

  const primaryId = selectedProject?.projectId ?? null;

  return (
    <div {...surfaceProps} className="relative h-full min-h-0 min-w-0">
    <div
      ref={containerRef}
      data-workspace-layout={workspace.mode}
      className={cn('relative flex h-full min-h-0 min-w-0', horizontal ? 'flex-row' : 'flex-col')}
    >
      {multiProjects.map((project, index) => (
        <Fragment key={project.projectId}>
          {index > 0 && (
            <PaneDivider
              orientation={horizontal ? 'vertical' : 'horizontal'}
              dataSlot={horizontal ? 'workspace-divider-column' : 'workspace-divider-row'}
              onPointerDown={handleDividerPointerDown(
                multiProjects[index - 1].projectId,
                project.projectId,
              )}
              onPointerMove={handleDividerPointerMove}
              onPointerUp={handleDividerPointerEnd}
              onPointerCancel={handleDividerPointerEnd}
            />
          )}
          <div
            data-workspace-unit={project.projectId}
            className={cn(
              'min-h-0 min-w-0 transition-opacity',
              drag?.projectId === project.projectId && 'opacity-60',
            )}
            style={{ flex: `${workspace.weights[project.projectId] ?? 1} 1 0px` }}
          >
            <WorkspaceRow
              project={project}
              isPrimary={project.projectId === primaryId}
              ws={ws}
              sendMessage={sendMessage}
              mode={workspace.mode}
              gripHandlers={makeGripHandlers(project.projectId)}
              onToggleLayout={workspace.toggleMode}
              onCloseRow={() => onCloseRow(project.projectId)}
              onNewPrimarySession={() => onNewProjectSession(project)}
              selectedSession={project.projectId === primaryId ? selectedSession : null}
              externalMessageUpdate={externalMessageUpdate}
              newSessionTrigger={newSessionTrigger}
              onNavigateToSession={onNavigateToSession}
              onSessionEstablished={onSessionEstablished}
              onInputFocusChange={onInputFocusChange}
              onSessionProcessing={onSessionProcessing}
              onSessionIdle={onSessionIdle}
              processingSessions={processingSessions}
              onShowSettings={onShowSettings}
              onProjectSelect={onProjectSelect}
              onProjectsRefresh={onProjectsRefresh}
            />
          </div>
        </Fragment>
      ))}
      {drag && !drag.edge && (
        <div
          data-workspace-snap-guide
          className="pointer-events-none absolute z-30 rounded-sm bg-primary shadow-[0_0_8px_2px] shadow-primary/40"
          style={
            horizontal
              ? { top: 4, bottom: 4, left: drag.guideOffset - 1, width: 2 }
              : { left: 4, right: 4, top: drag.guideOffset - 1, height: 2 }
          }
        />
      )}
      {drag?.edge && (
        <>
          <div
            data-workspace-edge-convert={drag.edge}
            className="pointer-events-none absolute z-30 bg-primary/[0.07]"
            style={
              drag.edge === 'left'
                ? { top: 0, bottom: 0, left: 0, width: EDGE_CONVERT_PX }
                : { top: 0, bottom: 0, right: 0, width: EDGE_CONVERT_PX }
            }
          />
          <div
            data-workspace-snap-guide
            className="pointer-events-none absolute z-30 rounded-sm bg-primary shadow-[0_0_8px_2px] shadow-primary/40"
            style={
              drag.edge === 'left'
                ? { top: 4, bottom: 4, left: 4, width: 2 }
                : { top: 4, bottom: 4, right: 4, width: 2 }
            }
          />
        </>
      )}
    </div>
    {dropOverlay}
    </div>
  );
}
