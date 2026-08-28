import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';

import type { ChatMessage, ClaudePermissionSuggestion, PermissionGrantResult, Provider } from '../../types/types';
import type { Project } from '../../../../types/app';
import type { ToolGroupItem } from '../../utils/toolGrouping';
import { statusStartedAt } from '../../utils/statusDuration';
import { getToolConfig, ToolGlyph } from '../../tools';
import {
  AgentDisclosure,
  MESSAGE_POP_UP,
  TranscriptIndicatorRow,
} from '../../../../shared/view/beui';

import MessageComponent from './MessageComponent';
import StatusDuration from './StatusDuration';

type DiffLine = {
  type: string;
  content: string;
  lineNum: number;
};

interface ToolGroupContainerProps {
  group: ToolGroupItem;
  /** Rows stamped after this epoch play the beUI pop-up on mount. */
  animateFrom?: number;
  prevMessage: ChatMessage | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  getMessageKey: (message: ChatMessage) => string;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission?: (suggestion: ClaudePermissionSuggestion) => PermissionGrantResult | null | undefined;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject?: Project | null;
  provider: Provider | string;
  /** True when this group belongs to the currently running tail turn. */
  isTurnRunning?: boolean;
}

function parseToolInput(toolInput: unknown): unknown {
  if (typeof toolInput !== 'string') {
    return toolInput;
  }

  try {
    return JSON.parse(toolInput);
  } catch {
    return toolInput;
  }
}

function getToolInputPreview(message: ChatMessage): string {
  const config = getToolConfig(message.toolName || 'UnknownTool').input;
  const parsedInput = parseToolInput(message.toolInput);
  const title = typeof config.title === 'function' ? config.title(parsedInput) : config.title;
  const value = config.getValue?.(parsedInput);

  return String(value || title || message.displayText || message.content || '').trim();
}

export default function ToolGroupContainer({
  group,
  animateFrom,
  prevMessage,
  createDiff,
  getMessageKey,
  onFileOpen,
  onShowSettings,
  onGrantToolPermission,
  showRawParameters,
  showThinking,
  selectedProject,
  provider,
  isTurnRunning = false,
}: ToolGroupContainerProps) {
  const reduce = useReducedMotion() ?? false;
  const [isExpanded, setIsExpanded] = useState(false);
  const config = getToolConfig(group.toolName).input;
  const label = config.label || group.toolName;
  // beautifului Thinking (coding mode) header treatment: the label shimmers
  // while any tool in the run is still awaiting its result, then settles.
  const working = isTurnRunning && group.messages.some((message) => !message.toolResult);
  const stamp = group.timestamp ? new Date(group.timestamp).getTime() : 0;
  const animateIn = Boolean(animateFrom && stamp > animateFrom && !reduce);
  const groupDurationMs = useMemo(() => {
    if (working) return undefined;
    const start = statusStartedAt(group.messages[0]?.timestamp);
    let end: number | null = null;
    for (const message of group.messages) {
      const messageStart = statusStartedAt(message.timestamp);
      const resultEnd = statusStartedAt(message.toolResult?.timestamp);
      const durationEnd = messageStart !== null && typeof message.durationMs === 'number'
        ? messageStart + message.durationMs
        : null;
      const candidate = resultEnd ?? durationEnd;
      if (candidate !== null && (end === null || candidate > end)) end = candidate;
    }
    return start !== null && end !== null && end >= start ? end - start : undefined;
  }, [group.messages, working]);

  const preview = useMemo(() => {
    const visiblePreviews = group.messages
      .slice(0, 2)
      .map(getToolInputPreview)
      .filter(Boolean);

    const extraCount = group.messages.length - visiblePreviews.length;
    const previewText = visiblePreviews.join(', ');

    if (!previewText) {
      return extraCount > 0 ? `+${extraCount} more` : '';
    }

    return extraCount > 0 ? `${previewText}, +${extraCount} more` : previewText;
  }, [group.messages]);

  return (
    <motion.div
      className="chat-message tool tool-row px-3 sm:px-0"
      data-message-id={getMessageKey(group.messages[0])}
      data-message-timestamp={group.timestamp || undefined}
      initial={animateIn ? { opacity: 0, transform: 'translateY(8px) scale(0.95)' } : false}
      animate={animateIn ? { opacity: 1, transform: 'translateY(0px) scale(1)' } : undefined}
      transition={MESSAGE_POP_UP}
      style={{ transformOrigin: '0% 100%' }}
    >
      <TranscriptIndicatorRow
        kind="tool-group"
        glyph={<ToolGlyph toolName={group.toolName} />}
        label={label}
        detail={preview || undefined}
        meta={`x${group.messages.length}`}
        duration={<StatusDuration
          startedAt={group.messages[0]?.timestamp}
          durationMs={groupDurationMs}
          running={working}
        />}
        active={working}
        expandable
        expanded={isExpanded}
        onToggle={() => setIsExpanded((current) => !current)}
      />

      <AgentDisclosure open={isExpanded}>
        {/* The group root already carries the mobile px-3; nested rows must not
            re-apply it or their chevrons fall off the shared right-edge column. */}
        <div className="mt-1.5 space-y-3 pl-6 sm:space-y-4 [&_.chat-message]:px-0">
          {group.messages.map((message, index) => (
            <MessageComponent
              key={getMessageKey(message)}
              message={message}
              prevMessage={index > 0 ? group.messages[index - 1] : prevMessage}
              createDiff={createDiff}
              onFileOpen={onFileOpen}
              onShowSettings={onShowSettings}
              onGrantToolPermission={onGrantToolPermission}
              showRawParameters={showRawParameters}
              showThinking={showThinking}
              selectedProject={selectedProject}
              provider={provider}
              isTurnRunning={isTurnRunning}
            />
          ))}
        </div>
      </AgentDisclosure>
    </motion.div>
  );
}
