'use client'

import { useMemo } from 'react'
import type { ApiProgressItem } from '@/components/catalogue/types'
import { GROWTH_COLORS as COLOR } from './colors'
import { StatCard } from './StatCard'
import { formatContentTypeLabel, formatHoursLearned, formatShortDate, getContentTypeIcon, isSameMonth } from './utils'

const RECENT_COMPLETIONS_LIMIT = 5

type CompletedProgressItem = ApiProgressItem & { completedAt: string }

function isCompleted(item: ApiProgressItem): item is CompletedProgressItem {
  return item.completedAt !== null
}

export interface LearningActivityPanelProps {
  progress: ApiProgressItem[]
  streakDays: number
  isLoading: boolean
}

export function LearningActivityPanel({ progress, streakDays, isLoading }: LearningActivityPanelProps) {
  const completions = useMemo(
    () =>
      progress
        .filter(isCompleted)
        .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()),
    [progress]
  )

  const completionsThisMonth = useMemo(() => {
    const now = new Date()
    return completions.filter((item) => isSameMonth(item.completedAt, now)).length
  }, [completions])

  const totalMinutes = useMemo(
    () => completions.reduce((sum, item) => sum + (item.timeSpentMinutes ?? 0), 0),
    [completions]
  )

  const recent = completions.slice(0, RECENT_COMPLETIONS_LIMIT)

  return (
    <div className="rounded-[10px] p-5" style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.cardBorder}` }}>
      <h2 className="text-[14px] font-medium" style={{ color: COLOR.pageTitle }}>
        Learning activity
      </h2>

      <div className="mt-3 grid grid-cols-3 gap-2.5">
        <StatCard label="This month" value={isLoading ? '—' : completionsThisMonth} delta="completions" />
        <StatCard label="Hours learned" value={isLoading ? '—' : formatHoursLearned(totalMinutes)} delta="all time" />
        <StatCard label="Current streak" value={isLoading ? '—' : streakDays} delta={streakDays === 1 ? 'day' : 'days'} />
      </div>

      <div className="mt-4">
        <div className="mb-2 text-[12px]" style={{ color: COLOR.muted35 }}>
          Recent completions
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-1.5">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-8 animate-pulse rounded-[6px]" style={{ backgroundColor: COLOR.muted03 }} />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <p className="text-[12px]" style={{ color: COLOR.muted30 }}>
            No completed courses yet — finish a course to see it here.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {recent.map((item) => {
              const Icon = getContentTypeIcon(item.contentType)
              return (
                <div
                  key={item.assetId}
                  className="flex items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-[12px]"
                  style={{ backgroundColor: COLOR.muted02 }}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: COLOR.muted30 }} />
                  <span className="min-w-0 flex-1 truncate" style={{ color: COLOR.muted45 }}>
                    {item.assetTitle}
                  </span>
                  <span className="shrink-0 text-[11px]" style={{ color: COLOR.muted30 }}>
                    {formatContentTypeLabel(item.contentType)} · {formatShortDate(item.completedAt)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
