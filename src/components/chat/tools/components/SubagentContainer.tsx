import React from 'react';

import type { SubagentChildTool } from '../../types/types';
import { Thinking } from '../../../../shared/view/beui';
import type { ThinkingRow } from '../../../../shared/view/beui';

interface SubagentContainerProps {
  toolInput: unknown;
  toolResult?: { content?: unknown; isError?: boolean } | null;
  subagentState: {
    childTools: SubagentChildTool[];
    currentToolIndex: number;
    isComplete: boolean;
  };
}

const getCompactToolDisplay = (toolName: string, toolInput: unknown): string => {
  const input = typeof toolInput === 'string' ? (() => {
    try { return JSON.parse(toolInput); } catch { return {}; }
  })() : (toolInput || {});

  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'ApplyPatch':
      return input.file_path?.split('/').pop() || input.file_path || '';
    case 'Grep':
    case 'Glob':
      return input.pattern || '';
    case 'Bash': {
      const cmd = input.command || '';
      return cmd.length > 40 ? `${cmd.slice(0, 40)}...` : cmd;
    }
    case 'Task':
      return input.description || input.subagent_type || '';
    case 'WebFetch':
    case 'WebSearch':
      return input.url || input.query || '';
    default:
      return '';
  }
};

const extractResultText = (content: unknown): string | null => {
  let value: unknown = content;
  if (typeof value === 'string') {
    const text: string = value;
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return text;
      value = parsed;
    } catch {
      return text;
    }
  }
  if (Array.isArray(value)) {
    const textParts = value
      .filter((part: any) => part.type === 'text' && part.text)
      .map((part: any) => part.text);
    if (textParts.length > 0) return textParts.join('\n');
    return null;
  }
  return typeof value === 'string' ? value : null;
};

/**
 * Subagent (Task tool) turns render as the beautifului Thinking trace in its
 * steps mode: the delegated description as the header, each child tool as a
 * step row — spinner on the tool in flight, muted checks once done — with the
 * prompt excerpt above and the final result excerpt below.
 */
export const SubagentContainer: React.FC<SubagentContainerProps> = ({
  toolInput,
  toolResult,
  subagentState,
}) => {
  const parsedInput = typeof toolInput === 'string' ? (() => {
    try { return JSON.parse(toolInput); } catch { return {}; }
  })() : ((toolInput as Record<string, any>) || {});

  const subagentType = parsedInput?.subagent_type || 'Agent';
  const description = parsedInput?.description || 'Running task';
  const prompt = parsedInput?.prompt || '';
  const { childTools, isComplete } = subagentState;

  const rows: ThinkingRow[] = childTools.map((child, index) => ({
    key: child.toolId || `${child.toolName}-${index}`,
    primary: child.toolName,
    secondary: getCompactToolDisplay(child.toolName, child.toolInput) || undefined,
    mono: true,
    state: !isComplete && index === childTools.length - 1 ? 'active' : 'done',
    isError: Boolean(child.toolResult?.isError),
  }));

  const resultText = isComplete && toolResult ? extractResultText(toolResult.content) : null;

  return (
    <div className="my-1 py-0.5">
      <Thinking
        mode="steps"
        working={!isComplete}
        activeLabel={description}
        doneLabel={`${description} · ${subagentType}, ${childTools.length} ${childTools.length === 1 ? 'tool' : 'tools'}`}
        intro={prompt ? (
          <span className="line-clamp-4 whitespace-pre-wrap break-words">{prompt}</span>
        ) : undefined}
        rows={rows}
        footer={resultText ? (
          <div className="line-clamp-6 whitespace-pre-wrap break-words px-1.5 py-0.5 text-xs text-muted-foreground">
            {resultText}
          </div>
        ) : undefined}
      />
    </div>
  );
};
