'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Globe,
  Lock,
  PlayCircle,
  Zap,
} from 'lucide-react'
import { api, getErrorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { SkillChip } from '@/components/ui/SkillChip'
import { Spinner } from '@/components/ui/Spinner'
import { CATALOGUE_COLORS as COLOR } from '@/components/catalogue/colors'
import type {
  ApiAssignment,
  ApiLearningAsset,
  ApiProgressItem,
  AssignmentsResponse,
  ProgressResponse,
} from '@/components/catalogue/types'

// "Completed" green from the dashboard's local palette (#4ade80) — not yet
// part of CATALOGUE_COLORS, kept local until a shared token exists.
const GREEN = '#4ade80'

const CONTENT_TYPE_LABELS: Record<string, string> = {
  video: 'Video',
  pdf: 'PDF',
  article: 'Article',
  scorm: 'SCORM',
}

function formatContentTypeLabel(contentType: string): string {
  return CONTENT_TYPE_LABELS[contentType] ?? contentType.charAt(0).toUpperCase() + contentType.slice(1)
}

// Mirrors CourseCard's formatDuration so durations read consistently across the app.
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`
}

function formatRemainingTime(durationMinutes: number | null | undefined, progressPct: number): string | null {
  if (durationMinutes == null) return null
  const remaining = Math.round(durationMinutes * (1 - progressPct / 100))
  if (remaining <= 0) return null
  return formatDuration(remaining)
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface AssetLesson {
  id: string
  title: string
  duration_minutes?: number | null
  content_type?: string
  status: 'completed' | 'locked' | 'available'
}

// `lessons` is an optional, forward-looking field — /content/assets/:id
// doesn't return SCORM module structure yet, so Section 3 only renders once
// a future release adds it to the asset response.
type CourseAsset = ApiLearningAsset & { lessons?: AssetLesson[] }

async function fetchAsset(assetId: string): Promise<CourseAsset> {
  const { data } = await api.get<CourseAsset>(`/content/assets/${assetId}`)
  return data
}

async function fetchProgress(): Promise<ProgressResponse> {
  const { data } = await api.get<ProgressResponse>('/progress/me')
  return data
}

async function fetchAssignments(): Promise<AssignmentsResponse> {
  const { data } = await api.get<AssignmentsResponse>('/assignments/me')
  return data
}

async function startAsset(assetId: string): Promise<void> {
  await api.post('/progress/events', { asset_id: assetId, event_type: 'started' })
}

// --- presentational helpers -------------------------------------------------

function LessonRow({ lesson, order, isLast }: { lesson: AssetLesson; order: number; isLast: boolean }) {
  const isCompleted = lesson.status === 'completed'
  const isLocked = lesson.status === 'locked'
  const isReadType = lesson.content_type === 'article' || lesson.content_type === 'pdf'

  return (
    <div
      className="flex items-center gap-3 py-2.5"
      style={!isLast ? { borderBottom: '0.5px solid rgba(255,255,255,0.05)' } : undefined}
    >
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium"
        style={{ backgroundColor: COLOR.muted07, color: COLOR.muted35 }}
      >
        {order}
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]" style={{ color: isCompleted ? COLOR.muted35 : COLOR.white }}>
          {lesson.title}
        </div>
        {lesson.duration_minutes != null && (
          <div className="mt-0.5 text-[12px]" style={{ color: COLOR.muted35 }}>
            {formatDuration(lesson.duration_minutes)}
          </div>
        )}
      </div>

      {isCompleted ? (
        <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: GREEN }} />
      ) : isLocked ? (
        <Lock className="h-4 w-4 shrink-0" style={{ color: COLOR.muted35 }} />
      ) : isReadType ? (
        <BookOpen className="h-4 w-4 shrink-0" style={{ color: COLOR.muted35 }} />
      ) : (
        <PlayCircle className="h-4 w-4 shrink-0" style={{ color: COLOR.muted35 }} />
      )}
    </div>
  )
}

interface EnrollmentCardProps {
  asset: CourseAsset
  progress?: ApiProgressItem
  assignment?: ApiAssignment
  onStart: () => void
  isStarting: boolean
}

function EnrollmentCard({ asset, progress, assignment, onStart, isStarting }: EnrollmentCardProps) {
  const isCompleted = progress?.status === 'completed'
  const isInProgress = progress?.status === 'in_progress' || progress?.status === 'started'
  const progressPct = progress?.progressPct ?? 0
  const hasOpenAssignment = !!assignment && assignment.status !== 'completed'
  const remaining = formatRemainingTime(asset.durationMinutes, progressPct)

  return (
    <div className="rounded-[10px] p-5" style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.cardBorder}` }}>
      {!isCompleted && !isInProgress && hasOpenAssignment && assignment?.dueDate && (
        <div
          className="mb-3 rounded-md px-3 py-2 text-center text-xs font-medium"
          style={{ color: COLOR.warning, backgroundColor: COLOR.warningBg, border: `0.5px solid ${COLOR.warningBorder}` }}
        >
          Due {formatDate(assignment.dueDate)}
        </div>
      )}

      {isCompleted ? (
        <>
          <div className="flex justify-center">
            <CheckCircle2 className="h-8 w-8" style={{ color: GREEN }} />
          </div>
          <div className="mt-2 text-center text-[13px] font-medium" style={{ color: GREEN }}>
            Completed
          </div>
          <Button variant="ghost" className="mt-4 h-10 w-full" onClick={onStart}>
            Review again
          </Button>
          {progress?.completedAt && (
            <div className="mt-2 text-center text-[12px]" style={{ color: COLOR.muted35 }}>
              Completed {formatDate(progress.completedAt)}
            </div>
          )}
        </>
      ) : isInProgress ? (
        <>
          <div className="mb-1.5 flex items-center justify-between text-[11px]" style={{ color: COLOR.muted35 }}>
            <span>Progress</span>
            <span>{progressPct}%</span>
          </div>
          <ProgressBar value={progressPct} color="accent" />

          <Button variant="primary" className="mt-3 h-10 w-full" onClick={onStart} disabled={isStarting}>
            {isStarting && <Spinner className="h-4 w-4 text-white" />}
            Continue learning
          </Button>
          <div className="mt-2 text-center text-[12px]" style={{ color: COLOR.muted35 }}>
            {progressPct}% complete{remaining ? ` · ${remaining} left` : ''}
          </div>
        </>
      ) : (
        <>
          <Button variant="primary" className="h-10 w-full" onClick={onStart} disabled={isStarting}>
            {isStarting && <Spinner className="h-4 w-4 text-white" />}
            Start learning
          </Button>
          {asset.durationMinutes != null && (
            <div className="mt-2 text-center text-[12px]" style={{ color: COLOR.muted35 }}>
              Estimated time: {formatDuration(asset.durationMinutes)}
            </div>
          )}
        </>
      )}

      {hasOpenAssignment && assignment?.note && (
        <div
          className="mt-4 pt-4 text-[12px]"
          style={{ color: COLOR.muted35, borderTop: `0.5px solid ${COLOR.muted07}` }}
        >
          {assignment.note}
        </div>
      )}
    </div>
  )
}

export default function CourseDetailPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { assetId } = useParams<{ assetId: string }>()
  const [aboutOpen, setAboutOpen] = useState(true)

  const assetQuery = useQuery({ queryKey: ['asset', assetId], queryFn: () => fetchAsset(assetId) })
  const progressQuery = useQuery({ queryKey: ['progress-me'], queryFn: fetchProgress })
  const assignmentsQuery = useQuery({ queryKey: ['assignments-me'], queryFn: fetchAssignments })

  const startMutation = useMutation({
    mutationFn: () => startAsset(assetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['progress-me'] })
      router.push(`/learn/${assetId}/lesson`)
    },
  })

  if (assetQuery.isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  if (assetQuery.isError || !assetQuery.data) {
    return (
      <EmptyState
        icon={AlertCircle}
        heading="Couldn't load this course"
        subtext={assetQuery.error ? getErrorMessage(assetQuery.error) : undefined}
      />
    )
  }

  const asset = assetQuery.data
  const progress = progressQuery.data?.progress.find((item) => item.assetId === assetId)
  const assignment = assignmentsQuery.data?.assignments.find((item) => item.assetId === assetId)

  const lessons = asset.lessons ?? []
  const showLessons = lessons.length > 0 && (asset.contentType === 'scorm' || lessons.length > 1)

  return (
    <div className="flex flex-col gap-5">
      {/* Section 1 — breadcrumb + back */}
      <div className="flex items-center gap-1.5 text-xs" style={{ color: COLOR.muted35 }}>
        <Link href="/learn" className="flex items-center gap-1.5 transition-colors hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" />
          Learn
        </Link>
        <ChevronRight className="h-3 w-3 shrink-0" />
        <span className="truncate">{asset.title}</span>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Left column */}
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {/* Section 2 — course header */}
          <div>
            <span
              className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium"
              style={{ color: COLOR.accent, backgroundColor: COLOR.accentBadgeBg, border: `0.5px solid ${COLOR.accentBadgeBorder}` }}
            >
              {formatContentTypeLabel(asset.contentType)}
            </span>

            <h1 className="mt-3 text-[22px] font-medium" style={{ color: COLOR.pageTitle, letterSpacing: '-0.02em' }}>
              {asset.title}
            </h1>

            {asset.description && (
              <p className="mt-2 mb-6 text-[15px]" style={{ color: 'rgba(255,255,255,0.55)', lineHeight: 1.7 }}>
                {asset.description}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-4 text-[13px]" style={{ color: COLOR.muted35 }}>
              {asset.durationMinutes != null && (
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  {formatDuration(asset.durationMinutes)}
                </span>
              )}
              {asset.proficiencyLevel && (
                <span className="flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5" />
                  {asset.proficiencyLevel.name}
                </span>
              )}
              {asset.language && (
                <span className="flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5" />
                  {asset.language}
                </span>
              )}
            </div>

            {asset.skills.length > 0 && (
              <div className="mt-6">
                <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: COLOR.muted35 }}>
                  Skills you&apos;ll develop
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {asset.skills.map((skill) => (
                    <SkillChip key={skill.id} status="unvalidated">
                      {skill.name}
                    </SkillChip>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Section 3 — lessons / content list */}
          {showLessons && (
            <div>
              <h2 className="text-[14px] font-medium text-fg">What&apos;s in this course</h2>
              <div className="mt-2">
                {lessons.map((lesson, index) => (
                  <LessonRow key={lesson.id} lesson={lesson} order={index + 1} isLast={index === lessons.length - 1} />
                ))}
              </div>
            </div>
          )}

          {/* Section 4 — about this course */}
          <div>
            <button
              type="button"
              onClick={() => setAboutOpen((open) => !open)}
              className="flex w-full items-center justify-between py-1 text-left"
            >
              <h2 className="text-[14px] font-medium text-fg">About this course</h2>
              <ChevronDown
                className={cn('h-4 w-4 transition-transform', aboutOpen && 'rotate-180')}
                style={{ color: COLOR.muted35 }}
              />
            </button>

            {aboutOpen && (
              <div className="mt-3 flex flex-col gap-4">
                {asset.description && (
                  <p className="text-[15px]" style={{ color: 'rgba(255,255,255,0.55)', lineHeight: 1.7 }}>
                    {asset.description}
                  </p>
                )}

                {(asset.version != null || asset.effectiveFrom) && (
                  <div className="flex flex-col gap-1 text-[12px]" style={{ color: COLOR.muted35 }}>
                    {asset.version != null && <span>Version {asset.version}</span>}
                    {asset.effectiveFrom && <span>Effective {formatDate(asset.effectiveFrom)}</span>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right column — enrollment card */}
        <div className="w-full lg:sticky lg:top-20 lg:w-[280px] lg:shrink-0">
          <EnrollmentCard
            asset={asset}
            progress={progress}
            assignment={assignment}
            onStart={() => startMutation.mutate()}
            isStarting={startMutation.isPending}
          />
        </div>
      </div>
    </div>
  )
}
