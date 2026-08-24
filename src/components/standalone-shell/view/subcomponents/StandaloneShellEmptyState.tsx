import { Folder } from 'lucide-react';

type StandaloneShellEmptyStateProps = {
  className: string;
};

export default function StandaloneShellEmptyState({ className }: StandaloneShellEmptyStateProps) {
  return (
    <div className={`flex h-full items-center justify-center px-6 py-12 ${className}`}>
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
          <Folder className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mb-2 text-base font-medium text-foreground">No project selected</h3>
        <p className="text-sm text-muted-foreground">A project is required to open a shell</p>
      </div>
    </div>
  );
}
