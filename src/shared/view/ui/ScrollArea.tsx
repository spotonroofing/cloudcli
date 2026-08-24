import * as React from 'react';

import { cn } from '../../../lib/utils';

type ScrollAreaProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Classes for the inner scrolling viewport (the element that owns the scrollbar). */
  viewportClassName?: string;
};

const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ className, viewportClassName, children, ...props }, ref) => (
    <div className={cn(className, 'relative overflow-hidden')} {...props}>
      {/* Inner container keeps border radius while allowing momentum scrolling on touch devices. */}
      <div
        ref={ref}
        className={cn('h-full w-full overflow-auto rounded-[inherit]', viewportClassName)}
        style={{
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
        }}
      >
        {children}
      </div>
    </div>
  )
);

ScrollArea.displayName = 'ScrollArea';

export { ScrollArea };
