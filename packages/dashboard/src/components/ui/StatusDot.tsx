import { cn } from '@/lib/utils';

type AgentStatus = 'active' | 'paused' | 'inactive';

const STATUS_COLORS: Record<AgentStatus, string> = {
  active: 'bg-green-400',
  paused: 'bg-yellow-400',
  inactive: 'bg-prism-muted',
};

interface StatusDotProps {
  status: AgentStatus | string;
  className?: string;
}

export function StatusDot({ status, className }: StatusDotProps) {
  const color = STATUS_COLORS[status as AgentStatus] ?? 'bg-prism-muted';
  return <span className={cn('h-1.5 w-1.5 rounded-full', color, className)} />;
}
