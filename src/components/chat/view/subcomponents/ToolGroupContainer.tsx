import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

import type { ChatMessage, ClaudePermissionSuggestion, PermissionGrantResult, Provider } from '../../types/types';
import type { Project } from '../../../../types/app';
import type { ToolGroupItem } from '../../utils/toolGrouping';
import { getToolConfig } from '../../tools';
import {
  AgentDisclosure,
  MESSAGE_POP_UP,
  SPRING_SWAP,
  TEXT_SHIMMER_CLASS_NAME,
  TEXT_SHIMMER_KEYFRAMES,
  textShimmerStyle,
} from '../../../../shared/view/beui';

import MessageComponent from './MessageComponent';

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

function getToolGroupIcon(icon: string | undefined, toolName: string): string {
  if (icon === 'terminal') {
    return '$';
  }

  return icon || toolName.slice(0, 1).toUpperCase();
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
}: ToolGroupContainerProps) {
  const reduce = useReducedMotion() ?? false;
  const [isExpanded, setIsExpanded] = useState(false);
  const config = getToolConfig(group.toolName).input;
  const label = config.label || group.toolName;
  const icon = getToolGroupIcon(config.icon, group.toolName);
  // beautifului Thinking (coding mode) header treatment: the label shimmers
  // while any tool in the run is still awaiting its result, then settles.
  const working = group.messages.some((message) => !message.toolResult);
  const stamp = group.timestamp ? new Date(group.timestamp).getTime() : 0;
  const animateIn = Boolean(animateFrom && stamp > animateFrom && !reduce);

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
      <button
        type="button"
        className="group flex min-h-7 w-full items-center gap-2 rounded-md py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setIsExpanded((current) => !current)}
        aria-expanded={isExpanded}
      >
        <span
          aria-hidden="true"
          className="grid size-4 shrink-0 place-items-center text-xs text-muted-foreground"
        >
          {icon}
        </span>
        {working ? (
          <>
            <style>{TEXT_SHIMMER_KEYFRAMES}</style>
            <span
              className={`min-w-0 shrink-0 text-xs font-medium ${TEXT_SHIMMER_CLASS_NAME}`}
              style={textShimmerStyle(1.4)}
            >
              {label}
            </span>
          </>
        ) : (
          <span className="min-w-0 shrink-0 text-xs font-medium text-foreground/90">{label}</span>
        )}
        {/* Plain count, never a chip (DESIGN.md tool-row law) — same meta cut
            as the Bash row's line count. */}
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
          x{group.messages.length}
        </span>
        {preview && (
          <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/55">{preview}</span>
        )}
        <motion.span
          aria-hidden="true"
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={reduce ? { duration: 0 } : SPRING_SWAP}
          className="ml-auto grid size-4 shrink-0 place-items-center text-muted-foreground/50 transition-colors group-hover:text-muted-foreground"
        >
          <ChevronDown className="size-3.5" />
        </motion.span>
      </button>

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
            />
          ))}
        </div>
      </AgentDisclosure>
    </motion.div>
  );
}
