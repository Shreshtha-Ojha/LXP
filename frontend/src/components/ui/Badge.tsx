import { type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export type BadgeStatus = 'validated' | 'pending' | 'gap' | 'met'

const statusStyles: Record<BadgeStatus, string> = {
  validated: 'bg-success/10 text-success border-success/20',
  met: 'bg-success/10 text-success border-success/20',
  pending: 'bg-warning/10 text-warning border-warning/20',
  gap: 'bg-danger/10 text-danger border-danger/20',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status: BadgeStatus
}

export function Badge({ status, className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border-hairline px-2 py-0.5 text-xs font-medium capitalize',
        statusStyles[status],
        className
      )}
      {...props}
    />
  )
}
