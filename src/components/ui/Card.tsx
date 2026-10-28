import { cn } from '@/lib/utils'

interface CardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
  hoverable?: boolean
}

export function Card({ children, className, onClick, hoverable }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-card border border-card-border rounded-lg p-4',
        hoverable && 'cursor-pointer hover:border-primary/50 transition-colors duration-150',
        onClick && 'cursor-pointer',
        className
      )}
    >
      {children}
    </div>
  )
}

interface StatCardProps {
  title: string
  value: string | number
  icon?: React.ReactNode
  className?: string
  valueClassName?: string
}

export function StatCard({ title, value, icon, className, valueClassName }: StatCardProps) {
  return (
    <Card className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-on-surface-variant">{title}</span>
        {icon && <span className="text-on-surface-variant">{icon}</span>}
      </div>
      <span className={cn('font-display text-2xl font-bold tabular-nums text-on-surface', valueClassName)}>
        {value}
      </span>
    </Card>
  )
}
