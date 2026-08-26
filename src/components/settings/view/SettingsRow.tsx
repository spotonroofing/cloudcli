import type { ReactNode } from 'react';

import { cn } from '../../../lib/utils';

type SettingsRowProps = {
  label: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

export default function SettingsRow({ label, description, children, className }: SettingsRowProps) {
  // Sidebar-width reflow (ui13 job 5, app scale ui14 job 5): the text column
  // keeps a readable minimum, so wide controls (selects) wrap below it instead
  // of squeezing the description to one word per line; toggles stay inline.
  // Sidebar row scale: 13px label, 11px description, h-7 controls.
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2', className)} data-slot="settings-row">
      <div className="min-w-32 flex-1">
        <div className="text-[13px] text-foreground">{label}</div>
        {description && (
          <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{description}</div>
        )}
      </div>
      <div className="ml-auto flex-shrink-0">{children}</div>
    </div>
  );
}
