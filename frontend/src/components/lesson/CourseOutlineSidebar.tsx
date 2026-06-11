'use client'

import { useRouter } from 'next/navigation'
import { CheckCircle2, Lock } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'
import { LESSON_COLORS as COLOR } from './colors'
import type { OutlineLesson } from './types'

function OutlineItem({ lesson, onNavigate }: { lesson: OutlineLesson; onNavigate: (assetId: string) => void }) {
  const isCompleted = lesson.status === 'completed'
  const isActive = lesson.status === 'active'
  const isLocked = lesson.status === 'locked'
  const isClickable = !isLocked && !isActive

  const titleColor = isCompleted
    ? COLOR.greenText60
    : isActive
      ? COLOR.accentTitle
      : isLocked
        ? COLOR.muted20
        : COLOR.muted35

  const icon = isCompleted ? (
    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" style={{ color: COLOR.green }} />
  ) : isLocked ? (
    <Lock className="h-3 w-3 shrink-0" style={{ color: COLOR.muted20 }} />
  ) : (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ border: `1.5px solid ${isActive ? COLOR.accentTitle : COLOR.muted35}` }}
    />
  )

  const item = (
    <div
      role="button"
      tabIndex={isClickable ? 0 : -1}
      aria-disabled={!isClickable}
      onClick={() => isClickable && onNavigate(lesson.id)}
      onKeyDown={(event) => {
        if (isClickable && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onNavigate(lesson.id)
        }
      }}
      className={cn(
        'flex h-8 items-center gap-2 px-4 text-[12px] transition-colors outline-none',
        isLocked ? 'cursor-not-allowed' : 'cursor-pointer'
      )}
      style={{
        color: titleColor,
        borderLeft: isActive ? `2px solid ${COLOR.accent}` : '2px solid transparent',
        backgroundColor: isActive ? COLOR.accentBg06 : 'transparent',
      }}
    >
      {icon}
      <span className="truncate">{lesson.title}</span>
    </div>
  )

  if (!isLocked) return item

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{item}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={6}
          className="z-50 rounded-md px-2.5 py-1.5 text-[11px]"
          style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.border07}`, color: COLOR.muted70 }}
        >
          Complete previous lesson first
          <Tooltip.Arrow style={{ fill: COLOR.card }} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export interface CourseOutlineSidebarProps {
  lessons: OutlineLesson[]
  className?: string
}

export function CourseOutlineSidebar({ lessons, className }: CourseOutlineSidebarProps) {
  const router = useRouter()

  return (
    <aside
      className={cn('w-[200px] shrink-0 overflow-y-auto py-5', className)}
      style={{ backgroundColor: COLOR.chrome, borderRight: `0.5px solid ${COLOR.border05}` }}
    >
      <div className="px-4 text-[10px] font-medium uppercase tracking-wide" style={{ color: COLOR.muted20 }}>
        In this course
      </div>
      <Tooltip.Provider delayDuration={200}>
        <div className="mt-2">
          {lessons.map((lesson) => (
            <OutlineItem key={lesson.id} lesson={lesson} onNavigate={(assetId) => router.push(`/learn/${assetId}/lesson`)} />
          ))}
        </div>
      </Tooltip.Provider>
    </aside>
  )
}
