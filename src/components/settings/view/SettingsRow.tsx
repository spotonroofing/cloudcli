import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';

type SettingsRowProps = {
  label: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

export default function SettingsRow({ label, description, children, className }: SettingsRowProps) {
  // Sidebar-width reflow (ui13 job 5): the text column keeps a readable
  // minimum, so wide controls (selects) wrap below it instead of squeezing
  // the description to one word per line; small toggles stay inline.
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4', className)}>
      <div className="min-w-[10rem] flex-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && (
          <div className="mt-0.5 text-sm text-muted-foreground">{description}</div>
        )}
      </div>
      <div className="ml-auto flex-shrink-0">{children}</div>
    </div>
  );
}
