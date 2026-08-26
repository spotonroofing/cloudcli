import { useEffect, useState } from 'react';
import { BookMarked, ChevronDown } from 'lucide-react';
import type { TFunction } from 'i18next';

import { AgentDisclosure, Tabs, TabsList, TabsTrigger } from '../../../../shared/view/beui';
import { Markdown } from '../../../chat/view/subcomponents/Markdown';
import { api } from '../../../../utils/api';
import { cn } from '../../../../lib/utils';
import type { Project } from '../../../../types/app';

import SidebarSurface from './SidebarSurface';

type MemoryFileEntry = { name: string; content: string };

type ProjectMemoryPayload = {
  memoryName: string;
  projectMd: string | null;
  stateMd: string | null;
  lessons: MemoryFileEntry[];
  sessions: MemoryFileEntry[];
};

type MemorySurfaceProps = {
  open: boolean;
  onClose: () => void;
  selectedProject: Project | null;
  t: TFunction;
};

/** First non-empty line of a memory file, heading marks stripped. */
function firstLineOf(content: string): string {
  for (const line of content.split('\n')) {
    const trimmed = line.replace(/^#+\s*/, '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

/**
 * One read-only expandable row: title (and optional one-line summary), spring
 * chevron, and the file's markdown behind an AgentDisclosure viewport.
 */
function MemoryFileRow({ title, summary, content }: { title: string; summary?: string; content: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border border-border/60" data-slot="memory-file-row">
      <button
        type="button"
        onClick={() => setExpanded((previous) => !previous)}
        aria-expanded={expanded}
        className="flex min-h-9 w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex-shrink-0 font-mono text-[11px] text-muted-foreground">{title}</span>
        {summary && (
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground/80">{summary}</span>
        )}
        <span className="ml-auto grid size-4 flex-shrink-0 place-items-center">
          <ChevronDown
            className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform duration-200', expanded && 'rotate-180')}
          />
        </span>
      </button>
      <AgentDisclosure open={expanded}>
        <div className="max-h-[280px] overflow-y-auto border-t border-border/60 px-3 py-2">
          <Markdown className="prose prose-sm max-w-none dark:prose-invert">{content}</Markdown>
        </div>
      </AgentDisclosure>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="mb-1.5 px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * Read-only memory viewer (ui12 phase 7; full-sidebar surface ui13 job 5):
 * fills the sidebar on the slide-up shell, listing the selected project's
 * planner memory (PROJECT.md, STATE.md, lessons with one-line summaries,
 * recent session summaries) and, on the Global tab, the cross-project
 * planner/_global/ folder. Browsing only; nothing writes.
 */
export default function MemorySurface({
  open,
  onClose,
  selectedProject,
  t,
}: MemorySurfaceProps) {
  const [tab, setTab] = useState<'project' | 'global'>('project');
  const [projectMemory, setProjectMemory] = useState<ProjectMemoryPayload | null>(null);
  const [globalFiles, setGlobalFiles] = useState<MemoryFileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const projectId = selectedProject?.projectId ?? null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const [projectResponse, globalResponse] = await Promise.all([
          projectId ? api.memoryProject(projectId) : Promise.resolve(null),
          api.memoryGlobal(),
        ]);
        if (cancelled) return;
        if (projectResponse?.ok) {
          const body = await projectResponse.json();
          if (!cancelled) setProjectMemory(body?.data ?? null);
        } else {
          setProjectMemory(null);
        }
        if (globalResponse.ok) {
          const body = await globalResponse.json();
          if (!cancelled) setGlobalFiles(Array.isArray(body?.data?.files) ? body.data.files : []);
        }
      } catch (error) {
        console.error('Failed to fetch memory viewer data:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const emptyHint = (text: string) => (
    <p className="px-1 py-1 text-xs text-muted-foreground/70">{text}</p>
  );

  return (
    <SidebarSurface
      open={open}
      onClose={onClose}
      ariaLabel={t('memory.title', 'Memory')}
      dataSlot="memory-surface"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground">{t('memory.title', 'Memory')}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {tab === 'global'
              ? t('memory.globalSubtitle', 'Cross-project preferences and lessons')
              : selectedProject?.displayName
                ?? t('memory.noProject', 'No project selected')}
          </p>
        </div>
        <BookMarked className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden />
      </div>

      <div className="border-b border-border/60 px-4 py-2">
        <Tabs value={tab} onValueChange={(value) => setTab(value as 'project' | 'global')} variant="segment">
          <TabsList>
            <TabsTrigger value="project">{t('memory.projectTab', 'Project')}</TabsTrigger>
            <TabsTrigger value="global">{t('memory.globalTab', 'Global')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3" data-slot="memory-surface-body">
        {tab === 'project' ? (
          !projectId ? (
            emptyHint(t('memory.selectProject', 'Select a project to browse its planner memory.'))
          ) : loading && !projectMemory ? (
            emptyHint(t('memory.loading', 'Loading memory...'))
          ) : !projectMemory ? (
            emptyHint(t('memory.noMemory', 'No planner memory found for this project.'))
          ) : (
            <>
              <section data-slot="memory-core-files">
                <SectionLabel>{t('memory.coreFiles', 'Project memory')}</SectionLabel>
                <div className="space-y-2">
                  {projectMemory.projectMd !== null && (
                    <MemoryFileRow title="PROJECT.md" content={projectMemory.projectMd} />
                  )}
                  {projectMemory.stateMd !== null && (
                    <MemoryFileRow title="STATE.md" content={projectMemory.stateMd} />
                  )}
                  {projectMemory.projectMd === null && projectMemory.stateMd === null
                    && emptyHint(t('memory.noCoreFiles', 'No PROJECT.md or STATE.md yet.'))}
                </div>
              </section>
              <section data-slot="memory-lessons">
                <SectionLabel>{t('memory.lessons', 'Lessons')}</SectionLabel>
                {projectMemory.lessons.length === 0
                  ? emptyHint(t('memory.noLessons', 'No lessons recorded yet.'))
                  : (
                    <div className="space-y-2">
                      {projectMemory.lessons.map((lesson) => (
                        <MemoryFileRow
                          key={lesson.name}
                          title={lesson.name}
                          summary={firstLineOf(lesson.content)}
                          content={lesson.content}
                        />
                      ))}
                    </div>
                  )}
              </section>
              <section data-slot="memory-sessions">
                <SectionLabel>{t('memory.sessions', 'Session summaries')}</SectionLabel>
                {projectMemory.sessions.length === 0
                  ? emptyHint(t('memory.noSessions', 'No session summaries yet.'))
                  : (
                    <div className="space-y-2">
                      {projectMemory.sessions.map((session) => (
                        <MemoryFileRow key={session.name} title={session.name} content={session.content} />
                      ))}
                    </div>
                  )}
              </section>
            </>
          )
        ) : loading && globalFiles.length === 0 ? (
          emptyHint(t('memory.loading', 'Loading memory...'))
        ) : globalFiles.length === 0 ? (
          emptyHint(t('memory.noGlobal', 'No global memory files yet.'))
        ) : (
          <section data-slot="memory-global-files">
            <div className="space-y-2">
              {globalFiles.map((file) => (
                <MemoryFileRow
                  key={file.name}
                  title={file.name}
                  summary={firstLineOf(file.content)}
                  content={file.content}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </SidebarSurface>
  );
}
