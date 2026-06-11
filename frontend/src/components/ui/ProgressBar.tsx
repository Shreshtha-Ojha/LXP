import { cn } from '@/lib/utils'

type ProgressBarColor = 'accent' | 'success' | 'warning' | 'danger'

const colorStyles: Record<ProgressBarColor, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
}

export interface ProgressBarProps {
  /** 0-100 */
  value: number
  /**
   * Fill colour. Pass the colour that corresponds to the value's meaning
   * (e.g. a completion threshold from config) — this component does not
   * decide thresholds itself.
   */
  color?: ProgressBarColor
  className?: string
}

export function ProgressBar({ value, color = 'accent', className }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value))

  return (
    <div
      className={cn('h-1 w-full overflow-hidden rounded-full bg-surface-hover', className)}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn('h-full rounded-full transition-[width]', colorStyles[color])}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}
