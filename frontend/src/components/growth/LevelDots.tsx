import { GROWTH_COLORS as COLOR } from './colors'
import { TOTAL_PROFICIENCY_LEVELS } from './utils'

/** Renders ● ● ○ ○ — `filled` dots (0-4) are accent-coloured, the rest are muted. */
export function LevelDots({ filled }: { filled: number }) {
  const clamped = Math.min(TOTAL_PROFICIENCY_LEVELS, Math.max(0, filled))

  return (
    <div className="flex items-center gap-1" aria-hidden="true">
      {Array.from({ length: TOTAL_PROFICIENCY_LEVELS }).map((_, index) => (
        <span
          key={index}
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: index < clamped ? COLOR.accent : COLOR.muted10 }}
        />
      ))}
    </div>
  )
}
