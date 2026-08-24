import { Sparkles, X } from 'lucide-react';
import { PRD_DOCS_URL } from '../constants';

type GenerateTasksModalProps = {
  isOpen: boolean;
  fileName: string;
  onClose: () => void;
};

export default function GenerateTasksModal({
  isOpen,
  fileName,
  onClose,
}: GenerateTasksModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border border-border bg-popover shadow-lg">
        <div className="flex items-center justify-between border-b border-border p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">
              Generate tasks from PRD
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <h4 className="mb-2 font-semibold text-foreground">
              Ask Claude Code directly
            </h4>
            <p className="mb-3 text-sm text-muted-foreground">
              Save this PRD, then ask Claude Code in chat to parse the file and create your initial tasks.
            </p>

            <div className="rounded border border-border bg-background p-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Example prompt</p>
              <p className="font-mono text-xs text-foreground">
                I have a PRD at .taskmaster/docs/{fileName}. Parse it and create the initial tasks.
              </p>
            </div>
          </div>

          <div className="border-t border-border pt-4 text-center">
            <a
              href={PRD_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-sm font-medium text-primary underline hover:text-primary/80"
            >
              View TaskMaster documentation
            </a>
          </div>

          <button
            onClick={onClose}
            className="w-full rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
