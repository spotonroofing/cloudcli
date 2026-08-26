import type { ComponentType } from 'react';
import { motion } from 'motion/react';

import { TABS_INDICATOR_SPRING } from '../beui/BeuiTabs';
import { cn } from '../../../lib/utils';

export type IconTab<T extends string> = {
  id: T;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

type IconTabsProps<T extends string> = {
  tabs: IconTab<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Distinct per strip: two mounted strips must not share a layoutId. */
  layoutId: string;
  className?: string;
};

/**
 * The sidebar's left-aligned icon-tab strip (ui13 job 5; shared ui14 job 5):
 * icon-only `h-7 w-9` triggers in a `w-fit bg-muted/50 p-0.5` pill container,
 * the active plate gliding between triggers on the tabs spring. Icon-only
 * controls, so `title` tooltips are allowed. Drives Projects/Chats/Archive
 * in the sidebar header and the Settings tab strip.
 */
export function IconTabs<T extends string>({ tabs, value, onChange, layoutId, className }: IconTabsProps<T>) {
  return (
    <div className={cn('flex w-fit flex-shrink-0 rounded-lg bg-muted/50 p-0.5', className)} data-slot="icon-tabs">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = value === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-pressed={active}
            aria-label={tab.label}
            title={tab.label}
            className={cn(
              'touch-hit relative flex h-7 w-9 items-center justify-center rounded-md transition-colors',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                data-slot="sidebar-segment-indicator"
                transition={TABS_INDICATOR_SPRING}
                className="absolute inset-0 rounded-md bg-background shadow-sm"
                aria-hidden="true"
              />
            )}
            <Icon className="relative h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
