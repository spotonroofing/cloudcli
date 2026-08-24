import type { ChatMessage } from '../types/types';

/**
 * Edit-and-resend response versioning (ui9 B3).
 *
 * A resend is a fresh provider turn appended to the Claude transcript; the
 * transcript itself is never rewritten. CloudCLI's `message_versions` rows
 * only say which turns are alternative versions of the same exchange. This
 * module maps those rows onto the loaded transcript: each version's segment
 * starts at its user turn and runs to the next version's start; only the
 * selected version's segment stays visible (hidden, never deleted).
 *
 * Version 1 is anchored by transcript message id. Resends are recorded before
 * their user turn exists, so their id is unknown server-side — they resolve
 * here by exact prompt text at or after the row's creation time (with a small
 * clock-skew allowance for the optimistic local echo), falling back to the
 * creation time itself while the turn is still streaming in.
 */

export type MessageVersionEntry = {
  groupId: string;
  version: number;
  userMessageId: string | null;
  promptText: string;
  isSelected: boolean;
  createdAt: string;
};

export type MessageVersionGroup = {
  groupId: string;
  /** Sorted ascending by version number. */
  versions: MessageVersionEntry[];
};

export type MessageVersionNav = {
  groupId: string;
  /** 1-based position of the selected version within `versions`. */
  current: number;
  total: number;
  /** Actual version numbers in display order, for selection calls. */
  versions: number[];
};

export type MessageVersionView = {
  groups: MessageVersionGroup[];
  /** Local selection overrides; falls back to the rows' is_selected. */
  selections: Map<string, number>;
};

/** Client clock (optimistic echo) vs server clock (row creation) allowance. */
const RESOLVE_SKEW_MS = 5000;

const messageTime = (message: ChatMessage): number => {
  const value = message.timestamp instanceof Date
    ? message.timestamp.getTime()
    : new Date(message.timestamp as string | number).getTime();
  return Number.isFinite(value) ? value : 0;
};

export const groupVersionRows = (rows: Array<Record<string, unknown>>): MessageVersionGroup[] => {
  const byGroup = new Map<string, MessageVersionEntry[]>();
  for (const row of rows) {
    const entry: MessageVersionEntry = {
      groupId: String(row.group_id ?? ''),
      version: Number(row.version ?? 0),
      userMessageId: typeof row.user_message_id === 'string' ? row.user_message_id : null,
      promptText: String(row.prompt_text ?? ''),
      isSelected: Boolean(row.is_selected),
      createdAt: String(row.created_at ?? ''),
    };
    if (!entry.groupId || entry.version < 1) continue;
    const list = byGroup.get(entry.groupId) ?? [];
    list.push(entry);
    byGroup.set(entry.groupId, list);
  }
  return Array.from(byGroup.entries()).map(([groupId, versions]) => ({
    groupId,
    versions: versions.sort((a, b) => a.version - b.version),
  }));
};

const selectedIndexFor = (group: MessageVersionGroup, selections: Map<string, number>): number => {
  const override = selections.get(group.groupId);
  const selectedVersion = override
    ?? group.versions.find((entry) => entry.isSelected)?.version
    ?? group.versions[group.versions.length - 1].version;
  const index = group.versions.findIndex((entry) => entry.version === selectedVersion);
  return index === -1 ? group.versions.length - 1 : index;
};

/**
 * Segment start time per version. An unresolved version-1 anchor means the
 * loaded window starts after it, so its segment opens the window (-Infinity).
 */
const resolveStarts = (messages: ChatMessage[], group: MessageVersionGroup): number[] => {
  const claimed = new Set<number>();
  return group.versions.map((entry, index) => {
    if (entry.userMessageId) {
      const found = messages.find((message) => message.id === entry.userMessageId);
      if (found) return messageTime(found);
      return index === 0 ? -Infinity : new Date(entry.createdAt).getTime();
    }
    const createdAt = new Date(entry.createdAt).getTime();
    const foundIndex = messages.findIndex((message, messageIndex) => (
      !claimed.has(messageIndex)
      && message.type === 'user'
      && typeof message.content === 'string'
      && message.content === entry.promptText
      && messageTime(message) >= createdAt - RESOLVE_SKEW_MS
    ));
    if (foundIndex !== -1) {
      claimed.add(foundIndex);
      return messageTime(messages[foundIndex]);
    }
    return createdAt;
  });
};

const segmentIndexAt = (starts: number[], time: number): number => {
  for (let index = starts.length - 1; index >= 0; index -= 1) {
    if (time >= starts[index]) return index;
  }
  return -1;
};

/**
 * Hides every non-selected version segment and stamps `versionNav` on the last
 * visible message of each multi-version group (the navigator's render anchor).
 */
export const applyMessageVersions = (
  messages: ChatMessage[],
  view: MessageVersionView,
): ChatMessage[] => {
  const activeGroups = view.groups.filter((group) => group.versions.length > 0);
  if (activeGroups.length === 0 || messages.length === 0) return messages;

  const keep = new Array<boolean>(messages.length).fill(true);
  const resolved = activeGroups.map((group) => ({
    group,
    starts: resolveStarts(messages, group),
    selectedIndex: selectedIndexFor(group, view.selections),
  }));

  for (const { starts, selectedIndex } of resolved) {
    messages.forEach((message, index) => {
      const segment = segmentIndexAt(starts, messageTime(message));
      if (segment !== -1 && segment !== selectedIndex) keep[index] = false;
    });
  }

  const navByIndex = new Map<number, MessageVersionNav>();
  for (const { group, starts, selectedIndex } of resolved) {
    if (group.versions.length < 2) continue;
    const start = starts[selectedIndex];
    // The navigator anchors to the edited exchange's own response, so the
    // exchange ends at the next visible user turn — conversation that
    // continues after the edit never inherits the control.
    let boundary = Infinity;
    messages.forEach((message, index) => {
      if (!keep[index] || boundary !== Infinity) return;
      if (message.type === 'user' && messageTime(message) > start) {
        boundary = messageTime(message);
      }
    });
    let lastKept = -1;
    messages.forEach((message, index) => {
      if (!keep[index]) return;
      const time = messageTime(message);
      if (time >= start && time < boundary) {
        lastKept = index;
      }
    });
    if (lastKept !== -1) {
      navByIndex.set(lastKept, {
        groupId: group.groupId,
        current: selectedIndex + 1,
        total: group.versions.length,
        versions: group.versions.map((entry) => entry.version),
      });
    }
  }

  const result: ChatMessage[] = [];
  messages.forEach((message, index) => {
    if (!keep[index]) return;
    const nav = navByIndex.get(index);
    result.push(nav ? { ...message, versionNav: nav } : message);
  });
  return result;
};

/**
 * The group an edited user message belongs to: its own group when it is a
 * recorded version's turn, otherwise its message id starts a new group.
 */
export const findEditGroupId = (
  groups: MessageVersionGroup[],
  message: ChatMessage,
): string => {
  const messageId = typeof message.id === 'string' ? message.id : '';
  for (const group of groups) {
    for (const entry of group.versions) {
      if (entry.userMessageId && entry.userMessageId === messageId) return group.groupId;
      if (
        !entry.userMessageId
        && typeof message.content === 'string'
        && message.content === entry.promptText
        && messageTime(message) >= new Date(entry.createdAt).getTime() - RESOLVE_SKEW_MS
      ) {
        return group.groupId;
      }
    }
  }
  return messageId;
};
