import { Folder } from 'lucide-react';

type ShellEmptyStateProps = {
  title: string;
  description: string;
};

export default function ShellEmptyState({ title, description }: ShellEmptyStateProps) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-12">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
          <Folder className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mb-2 text-base font-medium text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
