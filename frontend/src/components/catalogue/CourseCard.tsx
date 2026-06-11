'use client'

import { type ReactNode, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SkillChip } from '@/components/ui/SkillChip'
import { CATALOGUE_COLORS as COLOR } from './colors'
import type { CatalogueCourse } from './types'

const CONTENT_TYPE_LABELS: Record<string, string> = {
  video: 'Video',
  pdf: 'PDF',
  article: 'Article',
  scorm: 'SCORM',
}

function formatContentTypeLabel(contentType: string): string {
  return CONTENT_TYPE_LABELS[contentType] ?? contentType.charAt(0).toUpperCase() + contentType.slice(1)
}

// Mirrors the dashboard's formatDuration (app/(app)/dashboard/page.tsx) so
// durations read consistently across the app.
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`
}

function formatDueLabel(dueDate: string): string {
  const due = new Date(dueDate)
  const today = new Date()
  due.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)
  const days = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (days < 0) return 'Overdue'
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due in 1 day'
  return `Due in ${days} days`
}

type StatusTagTone = 'success' | 'warning' | 'accent'

const TONE_STYLES: Record<StatusTagTone, { color: string; backgroundColor: string; border: string }> = {
  success: { color: COLOR.success, backgroundColor: COLOR.successBg, border: `0.5px solid ${COLOR.successBorder}` },
  warning: { color: COLOR.warning, backgroundColor: COLOR.warningBg, border: `0.5px solid ${COLOR.warningBorder}` },
  accent: { color: COLOR.accent, backgroundColor: COLOR.accentBadgeBg, border: `0.5px solid ${COLOR.accentBadgeBorder}` },
}

function StatusTag({ tone, children }: { tone: StatusTagTone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium" style={TONE_STYLES[tone]}>
      {children}
    </span>
  )
}

/**
 * Top-left status tag. Precedence follows the spec: a completed course
 * always shows "Completed", an in-progress course shows no tag (the
 * progress bar at the bottom carries that signal instead), an open
 * assignment with a due date shows "Due in X days", and everything else
 * falls back to the content-type badge.
 */
function getStatusTag(course: CatalogueCourse): ReactNode | null {
  if (course.status === 'completed') return <StatusTag tone="success">Completed</StatusTag>
  if (course.status === 'in_progress') return null
  if (course.status === 'assigned' && course.due_date) {
    return <StatusTag tone="warning">{formatDueLabel(course.due_date)}</StatusTag>
  }
  return <StatusTag tone="accent">{formatContentTypeLabel(course.content_type)}</StatusTag>
}

export interface CourseCardProps {
  course: CatalogueCourse
  className?: string
}

export function CourseCard({ course, className }: CourseCardProps) {
  const router = useRouter()
  const skills = course.skills ?? []
  const visibleSkills = skills.slice(0, 2)
  const extraSkillCount = skills.length - visibleSkills.length
  const statusTag = getStatusTag(course)

  function navigateToAsset() {
    router.push(`/learn/${course.id}`)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      navigateToAsset()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={navigateToAsset}
      onKeyDown={handleKeyDown}
      className={cn(
        'flex h-full cursor-pointer flex-col rounded-[10px] px-5 py-4 transition-colors hover:border-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        className
      )}
      style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.cardBorder}` }}
    >
      {statusTag && <div className="mb-2.5">{statusTag}</div>}

      <h3 className="line-clamp-2 text-sm font-medium text-white" style={{ lineHeight: 1.4 }}>
        {course.title}
      </h3>

      <div className="mt-2 flex items-center gap-3 text-xs" style={{ color: COLOR.muted30 }}>
        {course.duration_minutes != null && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDuration(course.duration_minutes)}
          </span>
        )}
        {course.proficiency_level && (
          <span className="flex items-center gap-1">
            <Zap className="h-3 w-3" />
            {course.proficiency_level}
          </span>
        )}
      </div>

      {visibleSkills.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {visibleSkills.map((skill) => (
            <SkillChip key={skill} status="unvalidated">
              {skill}
            </SkillChip>
          ))}
          {extraSkillCount > 0 && (
            <span className="text-xs" style={{ color: COLOR.muted30 }}>
              +{extraSkillCount} more
            </span>
          )}
        </div>
      )}

      {course.status === 'in_progress' && (
        <div className="mt-auto pt-3">
          <div className="h-[3px] w-full overflow-hidden rounded-full" style={{ backgroundColor: COLOR.muted07 }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, course.progress_pct ?? 0))}%`, backgroundColor: COLOR.accent }}
            />
          </div>
          <div className="mt-1.5 text-[11px]" style={{ color: COLOR.muted35 }}>
            {course.progress_pct ?? 0}% complete
          </div>
        </div>
      )}
    </div>
  )
}
