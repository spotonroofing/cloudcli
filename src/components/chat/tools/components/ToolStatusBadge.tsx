import { Badge, type BadgeStatus } from '../../../../shared/view/ui';

export type ToolStatus = 'running' | 'completed' | 'error' | 'denied';

const STATUS_CONFIG: Record<ToolStatus, { label: string; status: BadgeStatus }> = {
  running: { label: 'Running', status: 'loading' },
  completed: { label: 'Completed', status: 'success' },
  error: { label: 'Error', status: 'danger' },
  denied: { label: 'Denied', status: 'warning' },
};

interface ToolStatusBadgeProps {
  status: ToolStatus;
  className?: string;
}

export function ToolStatusBadge({ status, className }: ToolStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  return (
    <Badge status={config.status} size="sm" contentKey={status} className={className}>
      {config.label}
    </Badge>
  );
}
