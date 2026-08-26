import type { ReactNode } from 'react';

import { cn } from '../../../lib/utils';

type SettingsCardProps = {
  children: ReactNode;
  className?: string;
  divided?: boolean;
};

export default function SettingsCard({ children, className, divided }: SettingsCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border/60 bg-card/40',
        divided && 'divide-y divide-border/60',
        className,
      )}
    >
      {children}
    </div>
  );
}
