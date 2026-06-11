'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Award, Check, Clock, type LucideIcon, Star, Zap } from 'lucide-react'
import { api, getErrorMessage } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkillChip } from '@/components/ui/SkillChip'
import { Spinner } from '@/components/ui/Spinner'
import { CourseCard } from '@/components/catalogue/CourseCard'
import { mockCourses } from '@/components/catalogue/mockCourses'
import type { ApiLearningAsset, ApiProgressItem, ProgressResponse } from '@/components/catalogue/types'

const COLOR = {
  green: '#4ade80',
  greenBg: 'rgba(74,222,128,0.12)',
  greenBorder: 'rgba(74,222,128,0.3)',
  greenEyebrow: 'rgba(74,222,128,0.7)',
  pageTitle: '#e2e0f9',
  muted35: 'rgba(255,255,255,0.35)',
  card: '#161618',
  cardBorder: 'rgba(255,255,255,0.07)',
  violet: '#9d8ff7',
  accent: '#7c6af7',
  accentCardBg: 'rgba(124,106,247,0.06)',
  accentCardBorder: 'rgba(124,106,247,0.2)',
  accentTileBg: 'rgba(124,106,247,0.15)',
  accentEyebrow: 'rgba(124,106,247,0.6)',
  accentTitle: '#c4bbfb',
} as const

async function fetchAsset(assetId: string): Promise<ApiLearningAsset> {
  const { data } = await api.get<ApiLearningAsset>(`/content/assets/${assetId}`)
  return data
}

async function fetchProgress(): Promise<ProgressResponse> {
  const { data } = await api.get<ProgressResponse>('/progress/me')
  return data
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface AchievementBadge {
  name: string
  description: string
}

// Badge criteria are placeholders — there's no Achievement entity/config yet
// (CLAUDE.md Rule 1), so this mirrors the mockLesson forward-looking pattern
// in lesson/page.tsx until a real achievements module lands.
function getAchievementBadge(
  allProgress: ApiProgressItem[],
  asset: ApiLearningAsset,
  current: ApiProgressItem | undefined
): AchievementBadge | null {
  const completedCount = allProgress.filter((item) => item.status === 'completed').length

  if (completedCount <= 1) {
    return { name: 'First step', description: 'You completed your first course on the platform' }
  }

  if (current?.timeSpentMinutes != null && asset.durationMinutes != null && current.timeSpentMinutes < asset.durationMinutes) {
    return { name: 'Fast learner', description: 'You finished this course faster than the estimated time' }
  }

  return null
}

interface StatCardProps {
  icon: LucideIcon
  label: string
  value: string
  valueColor?: string
}

function StatCard({ icon: Icon, label, value, valueColor }: StatCardProps) {
  return (
    <div
      className="flex-1 rounded-[9px] text-center"
      style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.cardBorder}`, padding: '0.875rem' }}
    >
      <Icon className="mx-auto h-4 w-4" style={{ color: COLOR.muted35 }} />
      <div className="mt-1.5 text-[11px]" style={{ color: COLOR.muted35 }}>
        {label}
      </div>
      <div className="mt-0.5 text-[14px] font-medium" style={{ color: valueColor ?? COLOR.pageTitle }}>
        {value}
      </div>
    </div>
  )
}

export default function CourseCompletePage() {
  const { assetId } = useParams<{ assetId: string }>()

  const assetQuery = useQuery({ queryKey: ['asset', assetId], queryFn: () => fetchAsset(assetId) })
  const progressQuery = useQuery({ queryKey: ['progress-me'], queryFn: fetchProgress })

  if (assetQuery.isLoading || progressQuery.isLoading) {
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
  const allProgress = progressQuery.data?.progress ?? []
  const progress = allProgress.find((item) => item.assetId === assetId)

  const completionDate = formatDate(progress?.completedAt ?? new Date().toISOString())
  const timeSpent = progress?.timeSpentMinutes ?? asset.durationMinutes
  const badge = getAchievementBadge(allProgress, asset, progress)

  // /recommendations/learning doesn't exist yet — use mock fixtures (excluding
  // this course) until that endpoint lands, same forward-looking approach as
  // mockLesson in lesson/page.tsx.
  const recommendations = mockCourses.filter((course) => course.id !== assetId).slice(0, 2)

  return (
    <div className="mx-auto flex flex-col" style={{ maxWidth: 560, padding: '3rem 0' }}>
      {/* Section 1 — achievement moment */}
      <div className="flex flex-col items-center">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-full"
          style={{ backgroundColor: COLOR.greenBg, border: `1.5px solid ${COLOR.greenBorder}` }}
        >
          <Check className="h-7 w-7" style={{ color: COLOR.green }} />
        </div>
        <div
          className="mt-4 text-[11px] font-medium uppercase tracking-wide"
          style={{ color: COLOR.greenEyebrow, marginBottom: '0.75rem' }}
        >
          Course complete
        </div>
        <h1 className="text-center text-[22px] font-medium" style={{ color: COLOR.pageTitle }}>
          {asset.title}
        </h1>
        <div className="mt-1 text-center text-[13px]" style={{ color: COLOR.muted35 }}>
          Completed {completionDate}
        </div>
      </div>

      {/* Section 2 — stats row */}
      <div className="mt-8 flex gap-3">
        <StatCard icon={Clock} label="Time spent" value={timeSpent != null ? `${timeSpent} min` : '—'} />
        <StatCard icon={Zap} label="Difficulty" value={asset.proficiencyLevel?.name ?? '—'} />
        <StatCard icon={Star} label="Skills earned" value={`${asset.skills.length}`} valueColor={COLOR.violet} />
      </div>

      {/* Section 3 — skills earned */}
      {asset.skills.length > 0 && (
        <div className="mt-8">
          <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: COLOR.muted35, marginBottom: '0.5rem' }}>
            Skills developed
          </div>
          <div className="flex flex-wrap gap-1.5">
            {asset.skills.map((skill) => (
              <SkillChip key={skill.id} status="validated">
                {skill.name}
              </SkillChip>
            ))}
          </div>
          <div className="mt-2 text-[12px]" style={{ color: COLOR.muted35 }}>
            Added to your skill inventory
          </div>
        </div>
      )}

      {/* Section 4 — achievement badge */}
      {badge && (
        <div
          className="mt-8 flex items-center gap-3 rounded-[10px]"
          style={{ backgroundColor: COLOR.accentCardBg, border: `0.5px solid ${COLOR.accentCardBorder}`, padding: '1rem 1.25rem' }}
        >
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px]"
            style={{ backgroundColor: COLOR.accentTileBg }}
          >
            <Award className="h-5 w-5" style={{ color: COLOR.accent }} />
          </div>
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide" style={{ color: COLOR.accentEyebrow }}>
              Achievement unlocked
            </div>
            <div className="mt-0.5 text-[13px] font-medium" style={{ color: COLOR.accentTitle }}>
              {badge.name}
            </div>
            <div className="mt-0.5 text-[12px]" style={{ color: COLOR.muted35 }}>
              {badge.description}
            </div>
          </div>
        </div>
      )}

      {/* Section 5 — what's next */}
      {recommendations.length > 0 && (
        <div className="mt-8">
          <div className="mb-3 text-[13px] font-medium" style={{ color: COLOR.pageTitle }}>
            Continue your growth
          </div>
          <div className="grid grid-cols-2 gap-3">
            {recommendations.map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </div>
        </div>
      )}

      {/* Section 6 — action buttons */}
      <div className="mt-8 flex justify-center gap-2.5">
        <Link href="/learn">
          <Button variant="primary">Back to learning</Button>
        </Link>
        <Link href="/growth">
          <Button variant="ghost">View my growth</Button>
        </Link>
      </div>
    </div>
  )
}
