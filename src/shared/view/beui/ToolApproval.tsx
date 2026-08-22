// beUI tool-approval (beui.dev/components/agents/tool-approval), vendored:
// the agents-family approval card. Spacing, sizing, and motion timing are the
// donor's; colors and radii are swapped to this app's tokens (radius token via
// rounded-lg/md, accent through primary utilities, no hardcoded blue). The
// donor's shiki-highlighted AgentCode details grid is replaced by the app's
// muted mono viewport (rounded-lg bg-muted/80) holding the raw tool input.

import {
  Check,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  ShieldCheck,
  X,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { cn } from '../../../lib/utils';

import { AgentDisclosure } from './AgentDisclosure';
import { EASE_OUT, SPRING_PRESS, SPRING_SWAP } from './ease';

export type ToolApprovalStatus =
  | 'pending'
  | 'approving'
  | 'approved'
  | 'denied'
  | 'running'
  | 'complete'
  | 'error';

export interface ToolApprovalProps {
  tool: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  /** Raw tool input shown in the collapsible mono viewport. */
  code?: string;
  /** Label on the disclosure trigger (donor default: "View details"). */
  detailsLabel?: ReactNode;
  status?: ToolApprovalStatus;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onApprove?: () => void;
  approveLabel?: ReactNode;
  onAlwaysAllow?: () => void;
  alwaysAllowLabel?: ReactNode;
  alwaysAllowDisabled?: boolean;
  onDeny?: () => void;
  denyLabel?: ReactNode;
  className?: string;
}

function getStatusCopy(status: ToolApprovalStatus) {
  if (status === 'approving') return 'Approving';
  if (status === 'approved') return 'Approved';
  if (status === 'denied') return 'Denied';
  if (status === 'running') return 'Running';
  if (status === 'complete') return 'Completed';
  if (status === 'error') return 'Failed';
  return 'Approval required';
}

function getStatusBadgeClass(status: ToolApprovalStatus) {
  if (status === 'pending') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400';
  }
  if (status === 'approving' || status === 'running') {
    return 'border-primary/30 bg-primary/10 text-primary';
  }
  if (status === 'approved' || status === 'complete') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  }
  return 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400';
}

export function ToolApproval({
  tool,
  title = 'Allow this tool to run?',
  description,
  code,
  detailsLabel = 'View details',
  status = 'pending',
  open,
  defaultOpen = false,
  onOpenChange,
  onApprove,
  approveLabel = 'Allow once',
  onAlwaysAllow,
  alwaysAllowLabel = 'Always allow',
  alwaysAllowDisabled = false,
  onDeny,
  denyLabel = 'Deny',
  className,
}: ToolApprovalProps) {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const detailsId = `${baseId}-details`;
  const previousStatus = useRef(status);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const currentOpen = open ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, open],
  );
  const busy = status === 'approving' || status === 'running';
  const pending = status === 'pending';
  const error = status === 'error';

  useEffect(() => {
    if (previousStatus.current === 'pending' && status !== 'pending') {
      setOpen(false);
    }
    previousStatus.current = status;
  }, [setOpen, status]);

  return (
    <div
      data-slot="tool-approval"
      data-state={status}
      aria-busy={busy}
      className={cn(
        'w-full overflow-hidden rounded-lg border border-border/60 bg-muted/20 text-sm',
        className,
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 grid size-8 shrink-0 place-items-center rounded-md border border-border/60 bg-background text-muted-foreground',
            error && 'text-destructive',
          )}
        >
          {busy ? (
            <LoaderCircle className={cn('size-4', !reduce && 'animate-spin')} />
          ) : error ? (
            <CircleAlert className="size-4" />
          ) : status === 'denied' ? (
            <X className="size-4" />
          ) : status === 'approved' || status === 'complete' ? (
            <Check className="size-4" />
          ) : (
            <ShieldCheck className="size-4" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium text-foreground">{title}</div>
              <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                {tool}
              </div>
            </div>
            <span
              className={cn(
                'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                getStatusBadgeClass(status),
              )}
            >
              {getStatusCopy(status)}
            </span>
          </div>
          {description ? (
            <p className="mt-2 leading-5 text-muted-foreground">{description}</p>
          ) : null}

          {code ? (
            <button
              type="button"
              aria-expanded={currentOpen}
              aria-controls={detailsId}
              onClick={() => setOpen(!currentOpen)}
              className="mt-2 inline-flex items-center gap-1 rounded-md text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {detailsLabel}
              <motion.span
                aria-hidden="true"
                animate={{ rotate: currentOpen ? 180 : 0 }}
                transition={reduce ? { duration: 0 } : SPRING_SWAP}
              >
                <ChevronDown className="size-3.5" />
              </motion.span>
            </button>
          ) : null}
        </div>
      </div>

      {code ? (
        <AgentDisclosure id={detailsId} open={currentOpen}>
          <div className="mx-4 mb-4 overflow-hidden rounded-lg bg-muted/80">
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-xs leading-relaxed text-foreground/80">
              {code}
            </pre>
          </div>
        </AgentDisclosure>
      ) : null}

      <AnimatePresence initial={false}>
        {pending ? (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0.12 : 0.22, ease: EASE_OUT }}
            className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-3"
          >
            <motion.button
              type="button"
              onClick={onApprove}
              whileTap={reduce ? undefined : { scale: 0.97 }}
              transition={SPRING_PRESS}
              className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {approveLabel}
            </motion.button>
            {onAlwaysAllow ? (
              <motion.button
                type="button"
                onClick={onAlwaysAllow}
                disabled={alwaysAllowDisabled}
                whileTap={reduce || alwaysAllowDisabled ? undefined : { scale: 0.97 }}
                transition={SPRING_PRESS}
                className="rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                {alwaysAllowLabel}
              </motion.button>
            ) : null}
            <button
              type="button"
              onClick={onDeny}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {denyLabel}
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
