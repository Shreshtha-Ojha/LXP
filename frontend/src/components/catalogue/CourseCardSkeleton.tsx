import { CATALOGUE_COLORS as COLOR } from './colors'

/** Pulsing placeholder matching CourseCard's layout, shown while catalogue data loads. */
export function CourseCardSkeleton() {
  return (
    <div
      className="flex h-full flex-col rounded-[10px] px-5 py-4"
      style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.cardBorder}` }}
    >
      <div className="h-4 w-16 animate-pulse rounded-full" style={{ backgroundColor: COLOR.muted07 }} />

      <div className="mt-3 h-[14px] w-full animate-pulse rounded" style={{ backgroundColor: COLOR.muted07 }} />
      <div className="mt-1.5 h-[14px] w-2/3 animate-pulse rounded" style={{ backgroundColor: COLOR.muted07 }} />

      <div className="mt-3 flex gap-3">
        <div className="h-3 w-12 animate-pulse rounded" style={{ backgroundColor: COLOR.muted07 }} />
        <div className="h-3 w-16 animate-pulse rounded" style={{ backgroundColor: COLOR.muted07 }} />
      </div>

      <div className="mt-3 flex gap-1.5">
        <div className="h-5 w-20 animate-pulse rounded-md" style={{ backgroundColor: COLOR.muted07 }} />
        <div className="h-5 w-24 animate-pulse rounded-md" style={{ backgroundColor: COLOR.muted07 }} />
      </div>
    </div>
  )
}
