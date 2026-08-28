import {
  Bot,
  FileDiff,
  FilePlus2,
  Files,
  ListTodo,
  PencilLine,
  Search,
  SquareTerminal,
  Wrench,
} from 'lucide-react';

export function ToolGlyph({ toolName }: { toolName: string }) {
  const className = 'size-3.5';

  switch (toolName) {
    case 'Bash':
      return <SquareTerminal className={className} />;
    case 'Read':
      return <Files className={className} />;
    case 'Edit':
      return <PencilLine className={className} />;
    case 'Write':
      return <FilePlus2 className={className} />;
    case 'ApplyPatch':
      return <FileDiff className={className} />;
    case 'Grep':
    case 'Glob':
      return <Search className={className} />;
    case 'TodoWrite':
    case 'TodoRead':
    case 'TaskCreate':
    case 'TaskUpdate':
    case 'TaskList':
    case 'TaskGet':
      return <ListTodo className={className} />;
    case 'Task':
      return <Bot className={className} />;
    default:
      return <Wrench className={className} />;
  }
}
