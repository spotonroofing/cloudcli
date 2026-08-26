import type { ReactNode } from 'react';

import { cn } from '../../../lib/utils';

type SettingsSectionProps = {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

export default function SettingsSection({ title, description, children, className }: SettingsSectionProps) {
  return (
    <div className={cn('space-y-1.5', className)} data-slot="settings-section">
      <div className="px-1">
        <h3 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {description && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}
