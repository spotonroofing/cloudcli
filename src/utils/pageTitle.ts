import type { Project, ProjectSession } from '../types/app';
import { titleFromPrompt } from '../../shared/sessionTitle.js';

const DEFAULT_PAGE_TITLE = 'Command Center';

export const getSessionTitle = (session: ProjectSession): string => {
  if (session.__provider === 'cursor') {
    return titleFromPrompt(session.name as string) || 'Untitled Session';
  }

  return titleFromPrompt(session.summary as string) || 'New Session';
};

export const getPageTitle = (
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): string => {
  if (selectedSession) {
    return getSessionTitle(selectedSession);
  }

  const displayName = selectedProject?.displayName?.trim();
  return displayName ? `${displayName} - ${DEFAULT_PAGE_TITLE}` : DEFAULT_PAGE_TITLE;
};
