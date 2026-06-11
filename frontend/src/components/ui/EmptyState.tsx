import { type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './Button'

export interface EmptyStateProps {
  icon: LucideIcon
  heading: string
  subtext?: string
  cta?: {
    label: string
    onClick: () => void
  }
  className?: string
}

export function EmptyState({ icon: Icon, heading, subtext, cta, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border-hairline border-border bg-surface px-6 py-12 text-center',
        className
      )}
    >
      <Icon className="h-8 w-8 text-fg-subtle" strokeWidth={1.5} />
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-fg">{heading}</h3>
        {subtext && <p className="text-sm text-fg-muted">{subtext}</p>}
      </div>
      {cta && (
        <Button variant="primary" size="sm" onClick={cta.onClick} className="mt-2">
          {cta.label}
        </Button>
      )}
    </div>
  )
}
