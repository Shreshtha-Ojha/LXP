import { GROWTH_COLORS as COLOR } from './colors'

export interface StatCardProps {
  label: string
  value: number | string
  valueColor?: string
  delta: string
  deltaColor?: string
}

export function StatCard({ label, value, valueColor = COLOR.pageTitle, delta, deltaColor = COLOR.muted35 }: StatCardProps) {
  return (
    <div className="rounded-[10px] px-4 py-3.5" style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.cardBorder}` }}>
      <div className="text-[11px]" style={{ color: COLOR.muted30 }}>
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-medium" style={{ color: valueColor }}>
        {value}
      </div>
      <div className="mt-1 text-xs" style={{ color: deltaColor }}>
        {delta}
      </div>
    </div>
  )
}
