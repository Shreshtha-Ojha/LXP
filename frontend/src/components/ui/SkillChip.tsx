import { type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export type SkillChipStatus = 'validated' | 'declared' | 'pending' | 'unvalidated'

const statusStyles: Record<SkillChipStatus, string> = {
  validated: 'bg-success/10 text-success border-success/20',
  declared: 'bg-accent/10 text-accent border-accent/20',
  pending: 'bg-warning/10 text-warning border-warning/20',
  unvalidated: 'bg-surface-hover text-fg-muted border-border',
}

const dotStyles: Record<SkillChipStatus, string> = {
  validated: 'bg-success',
  declared: 'bg-accent',
  pending: 'bg-warning',
  unvalidated: 'bg-fg-subtle',
}

export interface SkillChipProps extends HTMLAttributes<HTMLSpanElement> {
  status: SkillChipStatus
}

export function SkillChip({ status, className, children, ...props }: SkillChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border-hairline px-2.5 py-1 text-xs font-medium',
        statusStyles[status],
        className
      )}
      {...props}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dotStyles[status])} />
      {children}
    </span>
  )
}
