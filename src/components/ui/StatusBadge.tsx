import { cn } from '@/lib/utils'
import type { DeviceStatus } from '@/types/database'

const STATUS_CONFIG: Record<DeviceStatus, { label: string; color: string; bg: string; dot: string }> = {
  available: {
    label: 'متاح',
    color: 'text-available',
    bg: 'bg-available/10',
    dot: 'bg-available',
  },
  busy: {
    label: 'مشغول',
    color: 'text-busy',
    bg: 'bg-busy/10',
    dot: 'bg-busy',
  },
  maintenance: {
    label: 'صيانة',
    color: 'text-maintenance',
    bg: 'bg-maintenance/10',
    dot: 'bg-maintenance',
  },
}

interface StatusBadgeProps {
  status: DeviceStatus
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold',
        config.color,
        config.bg,
        className
      )}
    >
      <span className={cn('w-2 h-2 rounded-full', config.dot)} />
      {config.label}
    </span>
  )
}
