'use client'

import { useEffect, useMemo, type KeyboardEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Flame, Target } from 'lucide-react'
import { api } from '@/lib/api'
import { getHomeRouteForRole } from '@/lib/auth'
import { useAuthStore } from '@/store/authStore'
import { usePathProgressStore } from '@/store/pathProgressStore'
import { Spinner } from '@/components/ui/Spinner'
import type { ApiAssignment, AssignmentsResponse, RecommendationItem, RecommendationsResponse } from '@/components/catalogue/types'
import type { GapAnalysisResponse, MetRequirement, SkillGap } from '@/components/growth/types'
import { mockCompetencyProgress, mockKpis, mockNextActions } from '@/components/dashboard/mockData'
import type { BlockerDisplay, CompetencyProgressItem, DashboardResponse, NextActionDisplay } from '@/components/dashboard/types'

// Field names mirror backend/src/modules/dashboard/dashboardService.js
// (GET /dashboard/me) exactly. promotion_readiness, next_actions, and
// competency_progress are Release 0 placeholders — this page now sources
// "what to do next", "what's blocking my growth", and "skills required" from
// /skills/recommendations, /assignments/me, and /skills/gap-analysis instead.

const COLOR = {
  fg: '#f2f2f3',
  card: '#161618',
  cardBorder: 'rgba(255,255,255,0.07)',
  hairline: 'rgba(255,255,255,0.05)',
  greeting: '#e2e0f9',
  muted35: 'rgba(255,255,255,0.35)',
  muted30: 'rgba(255,255,255,0.3)',
  muted25: 'rgba(255,255,255,0.25)',
  trackMuted: 'rgba(255,255,255,0.06)',
  accent: '#7C6AF7',
  accentTitle: '#c4bbfb',
  accentEyebrow: 'rgba(124,106,247,0.7)',
  amber: '#f59e0b',
  green: '#4ade80',
  greenSubtle: 'rgba(74,222,128,0.6)',
  red: '#f87171',
} as const

const PILL_TONE = {
  amber: { color: COLOR.amber, bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.2)' },
  green: { color: COLOR.green, bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.2)' },
  red: { color: COLOR.red, bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.2)' },
  muted: { color: COLOR.muted35, bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)' },
} as const

type PillTone = keyof typeof PILL_TONE

async function fetchDashboard(): Promise<DashboardResponse> {
  const { data } = await api.get<DashboardResponse>('/dashboard/me')
  return data
}

async function fetchRecommendations(): Promise<RecommendationsResponse> {
  const { data } = await api.get<RecommendationsResponse>('/skills/recommendations')
  return data
}

async function fetchAssignments(): Promise<AssignmentsResponse> {
  const { data } = await api.get<AssignmentsResponse>('/assignments/me')
  return data
}

async function fetchGapAnalysis(): Promise<GapAnalysisResponse> {
  const { data } = await api.get<GapAnalysisResponse>('/skills/gap-analysis')
  return data
}

function getGreetingWord(hour: number): string {
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`
}

function formatDueDate(dueDate: string): string {
  return new Date(dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// --- gap-analysis -> "Skills required" panel rows ---------------------------

/**
 * progress_pct is derived from current/required level_order rather than a
 * hardcoded scale (e.g. "/4") — proficiency_levels is a per-tenant
 * configurable table, so the number of levels isn't fixed (CLAUDE.md Rule 1).
 */
function gapToCompetencyItem(gap: SkillGap): CompetencyProgressItem {
  return {
    name: gap.skill_name,
    current_level: gap.current_level ?? 'Not started',
    required_level: gap.required_level,
    progress_pct: Math.min(100, ((gap.current_level_order ?? 0) / gap.required_level_order) * 100),
    gap: true,
  }
}

function metToCompetencyItem(met: MetRequirement): CompetencyProgressItem {
  return {
    name: met.skill_name,
    current_level: met.current_level ?? 'Not started',
    required_level: met.required_level,
    progress_pct: Math.min(100, ((met.current_level_order ?? 0) / met.required_level_order) * 100),
    gap: false,
  }
}

// --- recommendations / assignments -> "What to do next" rows ----------------

function assignmentToNextAction(assignment: ApiAssignment): NextActionDisplay {
  const mandatoryLabel = assignment.isMandatory ? 'mandatory' : 'optional'
  const meta = assignment.dueDate ? `Due ${formatDueDate(assignment.dueDate)} · ${mandatoryLabel}` : mandatoryLabel
  return {
    title: assignment.title ?? 'Untitled assignment',
    typeLabel: 'Assignment',
    typeColor: COLOR.amber,
    meta,
    href: '/learn',
  }
}

function recommendationToNextAction(item: RecommendationItem): NextActionDisplay {
  const meta = item.duration_minutes != null ? `${formatDuration(item.duration_minutes)} · ${item.reason}` : item.reason
  return {
    title: item.title,
    typeLabel: 'Course',
    typeColor: COLOR.accent,
    meta,
    href: `/learn/${item.asset_id}`,
  }
}

/** Logs a query failure once (Technical Requirements: silent fallback + console.error only, no error UI). */
function useLogQueryError(label: string, error: unknown) {
  useEffect(() => {
    if (error) console.error(`[dashboard] ${label} failed`, error)
  }, [label, error])
}

// --- presentational helpers -------------------------------------------------

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[9px]" style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.cardBorder}` }}>
      {children}
    </div>
  )
}

function PanelHeader({ title, action }: { title: string; action?: { label: string; href: string } }) {
  return (
    <div
      className="flex items-center justify-between px-4 py-3"
      style={{ borderBottom: `0.5px solid ${COLOR.hairline}` }}
    >
      <h2 className="text-[13px] font-medium text-fg">{title}</h2>
      {action && (
        <Link href={action.href} className="text-xs" style={{ color: COLOR.accent }}>
          {action.label}
        </Link>
      )}
    </div>
  )
}

function Pill({ label, tone }: { label: string; tone: PillTone }) {
  const { color, bg, border } = PILL_TONE[tone]
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ color, backgroundColor: bg, border: `0.5px solid ${border}` }}
    >
      {label}
    </span>
  )
}

function MiniBar({ value, color, height = 3 }: { value: number; color: string; height?: number }) {
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div className="mt-2.5 w-full overflow-hidden rounded-full" style={{ height, backgroundColor: COLOR.trackMuted }}>
      <div className="h-full rounded-full" style={{ width: `${clamped}%`, backgroundColor: color }} />
    </div>
  )
}

interface KpiCardProps {
  label: string
  value: string
  valueSub?: string
  valueColor?: string
  delta: string
  deltaColor: string
  progress: number
  progressColor: string
}

function KpiCard({ label, value, valueSub, valueColor = COLOR.fg, delta, deltaColor, progress, progressColor }: KpiCardProps) {
  return (
    <Panel>
      <div className="px-4 py-3.5">
        <div className="text-[11px]" style={{ color: COLOR.muted30 }}>
          {label}
        </div>
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className="text-2xl font-medium" style={{ color: valueColor }}>
            {value}
          </span>
          {valueSub && (
            <span className="text-sm" style={{ color: COLOR.muted30 }}>
              {valueSub}
            </span>
          )}
        </div>
        <div className="mt-1 text-xs" style={{ color: deltaColor }}>
          {delta}
        </div>
        <MiniBar value={progress} color={progressColor} />
      </div>
    </Panel>
  )
}

function SkillProgressBanner({ gapAnalysis }: { gapAnalysis: GapAnalysisResponse | undefined }) {
  const hasTargetRole = gapAnalysis?.target_role != null
  const metCount = gapAnalysis?.met.length ?? 0
  const totalRequired = metCount + (gapAnalysis?.gaps.length ?? 0)
  const readinessPct = gapAnalysis?.readiness_pct ?? 0

  return (
    <div
      className="flex w-full items-center gap-4 rounded-[10px] px-5 py-4"
      style={{ backgroundColor: 'rgba(124,106,247,0.08)', border: '0.5px solid rgba(124,106,247,0.2)' }}
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px]"
        style={{ backgroundColor: 'rgba(124,106,247,0.15)', border: '0.5px solid rgba(124,106,247,0.25)' }}
      >
        <Target className="h-5 w-5" style={{ color: COLOR.accent }} />
      </div>

      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-wide" style={{ color: COLOR.accentEyebrow }}>
          Skill progress
        </div>
        {hasTargetRole ? (
          <>
            <div className="mt-0.5 text-sm font-medium" style={{ color: COLOR.accentTitle }}>
              {gapAnalysis?.target_role} — skills you&apos;re building toward
            </div>
            <div className="mt-0.5 text-xs" style={{ color: COLOR.muted35 }}>
              You have {metCount} of {totalRequired} required skills at the right level
            </div>
          </>
        ) : (
          <>
            <div className="mt-0.5 text-sm font-medium" style={{ color: COLOR.accentTitle }}>
              Set a target role to see your skill progress
            </div>
            <div className="mt-0.5 text-xs" style={{ color: COLOR.muted35 }}>
              Once a target role is set, we&apos;ll show which skills you still need here
            </div>
          </>
        )}
      </div>

      {hasTargetRole && (
        <div className="ml-auto flex shrink-0 flex-col items-end gap-1.5">
          <div className="text-[22px] font-medium" style={{ color: COLOR.accentTitle }}>
            {readinessPct}%
          </div>
          <div className="h-1 w-20 overflow-hidden rounded-full" style={{ backgroundColor: 'rgba(124,106,247,0.15)' }}>
            <div className="h-full rounded-full" style={{ width: `${readinessPct}%`, backgroundColor: COLOR.accent }} />
          </div>
          <Link href="/growth" className="text-[11px]" style={{ color: 'rgba(124,106,247,0.6)' }}>
            View skill gaps →
          </Link>
        </div>
      )}
    </div>
  )
}

function BlockingGrowthPanel({ items }: { items: BlockerDisplay[] }) {
  const visible = items.slice(0, 3)

  return (
    <Panel>
      <PanelHeader title="What's blocking my growth" action={{ label: 'See all', href: '/growth' }} />
      {visible.length === 0 ? (
        <div className="flex items-center justify-center gap-2 px-4 py-6">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: COLOR.green }} />
          <span className="text-[13px]" style={{ color: COLOR.greenSubtle }}>
            Nothing blocking your growth right now
          </span>
        </div>
      ) : (
        visible.map((item, index) => (
          <div
            key={item.key}
            className="flex items-center gap-3 px-4 py-3"
            style={index < visible.length - 1 ? { borderBottom: `0.5px solid ${COLOR.hairline}` } : undefined}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: PILL_TONE[item.tone].color }} />
            <span className="flex-1 text-sm text-fg">{item.description}</span>
            <Pill label={item.tag} tone={item.tone} />
          </div>
        ))
      )}
    </Panel>
  )
}

function NextActionsPanel({ items }: { items: NextActionDisplay[] }) {
  const router = useRouter()
  const visible = items.slice(0, 3)

  function navigateTo(href: string) {
    router.push(href)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>, href: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      navigateTo(href)
    }
  }

  return (
    <Panel>
      <PanelHeader title="What to do next" />
      <div className="flex flex-col gap-2 p-3">
        {visible.map((item, index) => (
          <div
            key={`${item.title}-${index}`}
            role="button"
            tabIndex={0}
            onClick={() => navigateTo(item.href)}
            onKeyDown={(event) => handleKeyDown(event, item.href)}
            className="flex cursor-pointer items-center gap-3 rounded-[7px] px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{ backgroundColor: 'rgba(255,255,255,0.02)', border: '0.5px solid rgba(255,255,255,0.06)' }}
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium"
              style={{ backgroundColor: 'rgba(124,106,247,0.15)', color: COLOR.accent }}
            >
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-fg">{item.title}</div>
              <div className="mt-0.5 text-xs" style={{ color: COLOR.muted35 }}>
                <span style={{ color: item.typeColor }}>{item.typeLabel}</span> · {item.meta}
              </div>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0" style={{ color: COLOR.muted25 }} />
          </div>
        ))}
      </div>
    </Panel>
  )
}

function CompetencyPanel({
  targetRole,
  items,
  usingMock,
}: {
  targetRole: string | null
  items: CompetencyProgressItem[]
  usingMock: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <Panel>
        <PanelHeader
          title={targetRole ? `Skills required for ${targetRole}` : 'Skills required'}
          action={{ label: 'View full profile', href: '/growth' }}
        />
        {items.map((item, index) => (
          <div
            key={item.name}
            className="flex items-center gap-4 px-4 py-3"
            style={index < items.length - 1 ? { borderBottom: `0.5px solid ${COLOR.hairline}` } : undefined}
          >
            <span className="w-[140px] shrink-0 truncate text-sm text-fg">{item.name}</span>
            <div className="h-1 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: COLOR.trackMuted }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${item.progress_pct}%`, backgroundColor: item.gap ? COLOR.amber : COLOR.accent }}
              />
            </div>
            <span className="w-20 shrink-0 text-right text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {item.current_level}
            </span>
            <Pill label={item.gap ? 'Needs work' : 'Achieved'} tone={item.gap ? 'amber' : 'green'} />
          </div>
        ))}
      </Panel>
      {usingMock && (
        <p className="text-[12px]" style={{ color: COLOR.muted30 }}>
          Set your target role to see personalised gaps
        </p>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const activeRole = useAuthStore((state) => state.activeRole)
  const coinTotal = usePathProgressStore((state) => state.coinTotal)

  // Reporting managers and above use the team dashboard, not this
  // associate-focused view — bounce them there on load.
  const belongsOnTeamDashboard = getHomeRouteForRole(activeRole) === '/team'

  useEffect(() => {
    if (belongsOnTeamDashboard) {
      router.replace('/team')
    }
  }, [belongsOnTeamDashboard, router])

  const dashboardQuery = useQuery({
    queryKey: ['dashboard-me'],
    queryFn: fetchDashboard,
    enabled: !belongsOnTeamDashboard,
    staleTime: 2 * 60 * 1000,
  })
  const recommendationsQuery = useQuery({
    queryKey: ['recommendations'],
    queryFn: fetchRecommendations,
    enabled: !belongsOnTeamDashboard,
    staleTime: 5 * 60 * 1000,
  })
  const assignmentsQuery = useQuery({
    queryKey: ['assignments-me'],
    queryFn: fetchAssignments,
    enabled: !belongsOnTeamDashboard,
    staleTime: 2 * 60 * 1000,
  })
  const gapAnalysisQuery = useQuery({
    queryKey: ['gap-analysis'],
    queryFn: fetchGapAnalysis,
    enabled: !belongsOnTeamDashboard,
    staleTime: 5 * 60 * 1000,
  })

  useLogQueryError('dashboard-me', dashboardQuery.error)
  useLogQueryError('recommendations', recommendationsQuery.error)
  useLogQueryError('assignments-me', assignmentsQuery.error)
  useLogQueryError('gap-analysis', gapAnalysisQuery.error)

  // "What to do next" — most overdue assignment, then gap-based
  // recommendations, then a second recommendation or the next assignment.
  // Falls back to mock data only when nothing real is available at all.
  const nextActionItems = useMemo<NextActionDisplay[]>(() => {
    const assignments = assignmentsQuery.data?.assignments ?? []
    const recommendations = recommendationsQuery.data ?? []
    const openAssignments = assignments.filter((a) => a.status !== 'completed')

    const overdueAssignments = openAssignments
      .filter((a) => a.isOverdue)
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))

    const items: NextActionDisplay[] = []
    const usedAssignmentIds = new Set<string>()

    if (overdueAssignments[0]) {
      items.push(assignmentToNextAction(overdueAssignments[0]))
      usedAssignmentIds.add(overdueAssignments[0].id)
    }

    if (recommendations[0]) items.push(recommendationToNextAction(recommendations[0]))

    if (recommendations[1]) {
      items.push(recommendationToNextAction(recommendations[1]))
    } else {
      const nextAssignment = openAssignments
        .filter((a) => !usedAssignmentIds.has(a.id))
        .sort((a, b) => {
          if (!a.dueDate) return 1
          if (!b.dueDate) return -1
          return a.dueDate.localeCompare(b.dueDate)
        })[0]
      if (nextAssignment) items.push(assignmentToNextAction(nextAssignment))
    }

    return items.length > 0 ? items : mockNextActions
  }, [assignmentsQuery.data, recommendationsQuery.data])

  // "What's blocking my growth" — overdue assignments (red) first, then
  // gap-analysis skill gaps (amber). An empty combined list is a genuinely
  // positive state, not a missing-data one, so there's no mock fallback here.
  const blockerItems = useMemo<BlockerDisplay[]>(() => {
    const assignments = assignmentsQuery.data?.assignments ?? []
    const gaps = gapAnalysisQuery.data?.gaps ?? []

    const overdueBlockers: BlockerDisplay[] = assignments
      .filter((a) => a.isOverdue && a.status !== 'completed')
      .map((a) => ({
        key: `overdue-${a.id}`,
        description: `${a.title ?? 'Untitled assignment'} — overdue`,
        tag: 'Overdue',
        tone: 'red',
      }))

    const gapBlockers: BlockerDisplay[] = gaps.map((gap) => ({
      key: `gap-${gap.skill_name}`,
      description: `${gap.skill_name} — need ${gap.required_level} level`,
      tag: 'Skill gap',
      tone: 'amber',
    }))

    return [...overdueBlockers, ...gapBlockers]
  }, [assignmentsQuery.data, gapAnalysisQuery.data])

  // "Skills required for X" — gap-analysis gaps + met requirements, falling
  // back to mock data when there's no target role / requirements configured.
  const { competencyItems, usingMockCompetency } = useMemo(() => {
    const gaps = gapAnalysisQuery.data?.gaps ?? []
    const met = gapAnalysisQuery.data?.met ?? []
    if (gaps.length === 0 && met.length === 0) {
      return { competencyItems: mockCompetencyProgress, usingMockCompetency: true }
    }
    return {
      competencyItems: [...gaps.map(gapToCompetencyItem), ...met.map(metToCompetencyItem)],
      usingMockCompetency: false,
    }
  }, [gapAnalysisQuery.data])

  if (belongsOnTeamDashboard) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  // KPI cards never block on the dashboard query — show mock values
  // immediately and swap in real values as each query resolves.
  const kpis = dashboardQuery.data?.kpis
  const skillsValidated = kpis?.skills_validated ?? mockKpis.skills_validated
  const skillsTotal = kpis?.skills_total ?? mockKpis.skills_total
  const blockingCount = gapAnalysisQuery.data?.gaps.length ?? mockKpis.blocking_count
  const assignmentsDueSoon = kpis?.assignments_due_soon ?? mockKpis.assignments_due_soon
  const certificationsActive = kpis?.certifications_active ?? mockKpis.certifications_active
  const skillsPct = skillsTotal > 0 ? (skillsValidated / skillsTotal) * 100 : 0

  const now = new Date()
  const greetingWord = getGreetingWord(now.getHours())
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' })
  const displayName = dashboardQuery.data?.greeting.name ?? 'there'
  const streakDays = dashboardQuery.data?.greeting.streak_days ?? 0

  return (
    <div className="flex flex-col gap-5">
      {/* Section 1 — top bar */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[18px] font-medium" style={{ color: COLOR.greeting }}>
            Good {greetingWord}, {displayName}
          </span>
          <span className="ml-2 text-[18px]" style={{ color: COLOR.muted35 }}>
            {dayName}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-1.5 rounded-[20px] px-3 py-1 text-[13px] font-medium"
            style={{ color: COLOR.amber, backgroundColor: 'rgba(245,158,11,0.1)', border: '0.5px solid rgba(245,158,11,0.2)' }}
          >
            <Flame className="h-3.5 w-3.5" />
            {streakDays}-day streak
          </div>
          <div
            className="flex items-center gap-1.5 rounded-[20px] px-3 py-1 text-[13px] font-medium"
            style={{ color: COLOR.amber, backgroundColor: 'rgba(245,158,11,0.08)', border: '0.5px solid rgba(245,158,11,0.15)' }}
          >
            💰 {coinTotal} coins
          </div>
        </div>
      </div>

      {/* Section 2 — skill progress banner */}
      <SkillProgressBanner gapAnalysis={gapAnalysisQuery.data} />

      {/* Section 3 — KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Skills validated"
          value={skillsTotal > 0 ? `${skillsValidated}` : '—'}
          valueSub={skillsTotal > 0 ? `/ ${skillsTotal}` : undefined}
          delta={
            skillsTotal === 0
              ? 'Not yet tracked'
              : skillsValidated >= skillsTotal
                ? 'All required skills validated'
                : `${skillsTotal - skillsValidated} remaining`
          }
          deltaColor={skillsTotal > 0 && skillsValidated >= skillsTotal ? COLOR.green : COLOR.muted35}
          progress={skillsPct}
          progressColor={COLOR.accent}
        />
        <KpiCard
          label="Skill gaps to close"
          value={`${blockingCount}`}
          valueColor={blockingCount > 0 ? COLOR.amber : COLOR.fg}
          delta={blockingCount > 0 ? `${blockingCount} skill${blockingCount === 1 ? '' : 's'} need work` : 'Nothing blocking you'}
          deltaColor={blockingCount > 0 ? COLOR.amber : COLOR.green}
          progress={blockingCount > 0 ? 100 : 0}
          progressColor="rgba(245,158,11,0.4)"
        />
        <KpiCard
          label="Assigned — due soon"
          value={`${assignmentsDueSoon}`}
          valueSub={assignmentsDueSoon === 1 ? 'assignment' : 'assignments'}
          delta={assignmentsDueSoon > 0 ? 'Due within your reminder window' : 'Nothing due soon'}
          deltaColor={assignmentsDueSoon > 0 ? COLOR.amber : COLOR.muted35}
          progress={assignmentsDueSoon > 0 ? 100 : 0}
          progressColor={COLOR.amber}
        />
        <KpiCard
          label="Certifications"
          value={`${certificationsActive}`}
          valueSub="active"
          delta={certificationsActive > 0 ? `${certificationsActive} active` : 'Not yet tracked'}
          deltaColor={COLOR.muted35}
          progress={certificationsActive > 0 ? 100 : 0}
          progressColor="rgba(255,255,255,0.15)"
        />
      </div>

      {/* Section 4 — two column panels */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <BlockingGrowthPanel items={blockerItems} />
        <NextActionsPanel items={nextActionItems} />
      </div>

      {/* Section 5 — competency progress */}
      <CompetencyPanel
        targetRole={gapAnalysisQuery.data?.target_role ?? null}
        items={competencyItems}
        usingMock={usingMockCompetency}
      />
    </div>
  )
}
