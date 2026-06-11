'use client'

import { useEffect, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, ArrowRight, ArrowUpRight, Flame } from 'lucide-react'
import { api, getErrorMessage } from '@/lib/api'
import { getHomeRouteForRole } from '@/lib/auth'
import { useAuthStore } from '@/store/authStore'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'

// Field names mirror backend/src/modules/dashboard/dashboardService.js
// (GET /dashboard/me) exactly. promotion_readiness and competency_progress
// are returned as null/empty until the Skill/CareerAspiration schema lands
// in Release 2/3 — this page renders an empty state for those sections
// until then, per AGENTS.md ("do not build ahead of the current release").
interface PromotionBlockingItem {
  type: string
  description: string
  urgency: string
}

interface NextAction {
  title: string
  type: string
  duration_minutes: number | null
  closes_blocker: boolean
}

interface CompetencyProgressItem {
  name: string
  current_level: string
  required_level: string
  progress_pct: number
  gap: boolean
}

interface DashboardResponse {
  greeting: {
    name: string | null
    streak_days: number
  }
  promotion_readiness: {
    target_role: string | null
    readiness_pct: number | null
    blocking_items: PromotionBlockingItem[]
  }
  kpis: {
    skills_validated: number
    skills_total: number
    blocking_count: number
    assignments_due_soon: number
    certifications_active: number
  }
  next_actions: NextAction[]
  competency_progress: CompetencyProgressItem[]
}

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
} as const

const PILL_TONE = {
  amber: { color: COLOR.amber, bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.2)' },
  green: { color: COLOR.green, bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.2)' },
  muted: { color: COLOR.muted35, bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)' },
} as const

type PillTone = keyof typeof PILL_TONE

const BLOCKER_TYPE_LABEL: Record<string, string> = {
  assessment: 'Required',
  skill_gap: 'Skill gap',
  certification: 'Renewal due',
}

const ACTION_TYPE_LABEL: Record<string, string> = {
  assessment: 'Assessment',
  course: 'Course',
  video: 'Video',
  pdf: 'PDF',
  scorm: 'SCORM',
  article: 'Article',
  external_link: 'Link',
  path: 'Learning path',
}

async function fetchDashboard(): Promise<DashboardResponse> {
  const { data } = await api.get<DashboardResponse>('/dashboard/me')
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

function formatActionMeta(action: NextAction): string {
  const parts = [ACTION_TYPE_LABEL[action.type] ?? action.type]
  if (action.duration_minutes != null) parts.push(formatDuration(action.duration_minutes))
  if (action.closes_blocker) parts.push('closes blocker')
  return parts.join(' · ')
}

function summarizeBlockingItems(items: PromotionBlockingItem[]): string {
  if (items.length === 0) return "You're on track — nothing is currently blocking your readiness"

  const skillGaps = items.filter((item) => item.type === 'skill_gap').length
  const assessments = items.filter((item) => item.type === 'assessment').length

  const parts: string[] = []
  if (assessments > 0) parts.push(`${assessments} assessment${assessments === 1 ? '' : 's'}`)
  if (skillGaps > 0) parts.push(`${skillGaps} skill gap${skillGaps === 1 ? '' : 's'}`)

  if (parts.length === 0) return `${items.length} item${items.length === 1 ? '' : 's'} blocking your readiness`
  return `${parts.join(' and ')} blocking your readiness`
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

function PanelEmptyRow({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 py-6 text-center text-sm" style={{ color: COLOR.muted35 }}>
      {children}
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

function PromotionBanner({ promo }: { promo: DashboardResponse['promotion_readiness'] }) {
  const hasReadiness = promo.target_role != null && promo.readiness_pct != null

  return (
    <div
      className="flex w-full items-center gap-4 rounded-[10px] px-5 py-4"
      style={{ backgroundColor: 'rgba(124,106,247,0.08)', border: '0.5px solid rgba(124,106,247,0.2)' }}
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px]"
        style={{ backgroundColor: 'rgba(124,106,247,0.15)', border: '0.5px solid rgba(124,106,247,0.25)' }}
      >
        <ArrowUpRight className="h-5 w-5" style={{ color: COLOR.accent }} />
      </div>

      <div className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-wide" style={{ color: COLOR.accentEyebrow }}>
          Promotion readiness
        </div>
        {hasReadiness ? (
          <>
            <div className="mt-0.5 text-sm font-medium" style={{ color: COLOR.accentTitle }}>
              {promo.target_role} — you&apos;re closer than you think
            </div>
            <div className="mt-0.5 text-xs" style={{ color: COLOR.muted35 }}>
              {summarizeBlockingItems(promo.blocking_items)}
            </div>
          </>
        ) : (
          <>
            <div className="mt-0.5 text-sm font-medium" style={{ color: COLOR.accentTitle }}>
              Set a target role to see your promotion readiness
            </div>
            <div className="mt-0.5 text-xs" style={{ color: COLOR.muted35 }}>
              Once a target role is set, we&apos;ll show what&apos;s blocking your next promotion here
            </div>
          </>
        )}
      </div>

      {hasReadiness && (
        <div className="ml-auto flex shrink-0 flex-col items-end gap-1.5">
          <div className="text-[22px] font-medium" style={{ color: COLOR.accentTitle }}>
            {promo.readiness_pct}%
          </div>
          <div className="h-1 w-20 overflow-hidden rounded-full" style={{ backgroundColor: 'rgba(124,106,247,0.15)' }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${promo.readiness_pct}%`, backgroundColor: COLOR.accent }}
            />
          </div>
          <Link href="/growth" className="text-[11px]" style={{ color: 'rgba(124,106,247,0.6)' }}>
            View full path →
          </Link>
        </div>
      )}
    </div>
  )
}

function BlockingGrowthPanel({ items }: { items: PromotionBlockingItem[] }) {
  return (
    <Panel>
      <PanelHeader title="What's blocking my growth" action={{ label: 'See all', href: '/growth' }} />
      {items.length === 0 ? (
        <PanelEmptyRow>Nothing blocking your growth right now</PanelEmptyRow>
      ) : (
        items.map((item, index) => (
          <div
            key={`${item.type}-${index}`}
            className="flex items-center gap-3 px-4 py-3"
            style={index < items.length - 1 ? { borderBottom: `0.5px solid ${COLOR.hairline}` } : undefined}
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: item.urgency === 'required' ? COLOR.amber : COLOR.muted25 }}
            />
            <span className="flex-1 text-sm text-fg">{item.description}</span>
            <Pill
              label={BLOCKER_TYPE_LABEL[item.type] ?? 'Action needed'}
              tone={item.urgency === 'required' ? 'amber' : 'muted'}
            />
          </div>
        ))
      )}
    </Panel>
  )
}

function NextActionsPanel({ actions }: { actions: NextAction[] }) {
  const items = actions.slice(0, 3)

  return (
    <Panel>
      <PanelHeader title="What to do next" />
      <div className="flex flex-col gap-2 p-3">
        {items.length === 0 ? (
          <PanelEmptyRow>Nothing assigned right now</PanelEmptyRow>
        ) : (
          items.map((action, index) => (
            <div
              key={`${action.title}-${index}`}
              className="flex cursor-pointer items-center gap-3 rounded-[7px] px-3 py-2.5"
              style={{ backgroundColor: 'rgba(255,255,255,0.02)', border: '0.5px solid rgba(255,255,255,0.06)' }}
            >
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium"
                style={{ backgroundColor: 'rgba(124,106,247,0.15)', color: COLOR.accent }}
              >
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-fg">{action.title}</div>
                <div className="mt-0.5 text-xs" style={{ color: COLOR.muted35 }}>
                  {formatActionMeta(action)}
                </div>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0" style={{ color: COLOR.muted25 }} />
            </div>
          ))
        )}
      </div>
    </Panel>
  )
}

function CompetencyPanel({ targetRole, items }: { targetRole: string | null; items: CompetencyProgressItem[] }) {
  return (
    <Panel>
      <PanelHeader
        title={`Competency progress${targetRole ? ` — toward ${targetRole}` : ''}`}
        action={{ label: 'View full profile', href: '/growth' }}
      />
      {items.length === 0 ? (
        <PanelEmptyRow>Your competency profile will appear here once skill validation begins</PanelEmptyRow>
      ) : (
        items.map((item, index) => (
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
            <Pill label={item.gap ? 'Gap' : 'Met'} tone={item.gap ? 'amber' : 'green'} />
          </div>
        ))
      )}
    </Panel>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const activeRole = useAuthStore((state) => state.activeRole)

  // Reporting managers and above use the team dashboard, not this
  // associate-focused view — bounce them there on load.
  const belongsOnTeamDashboard = getHomeRouteForRole(activeRole) === '/team'

  useEffect(() => {
    if (belongsOnTeamDashboard) {
      router.replace('/team')
    }
  }, [belongsOnTeamDashboard, router])

  const {
    data,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['dashboard-me'],
    queryFn: fetchDashboard,
    enabled: !belongsOnTeamDashboard,
  })

  if (belongsOnTeamDashboard || isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <EmptyState
        icon={AlertCircle}
        heading="Couldn't load your dashboard"
        subtext={error ? getErrorMessage(error) : undefined}
      />
    )
  }

  const { skills_validated, skills_total, blocking_count, assignments_due_soon, certifications_active } = data.kpis
  const skillsPct = skills_total > 0 ? (skills_validated / skills_total) * 100 : 0

  const now = new Date()
  const greetingWord = getGreetingWord(now.getHours())
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long' })
  const displayName = data.greeting.name ?? 'there'

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
        <div
          className="flex items-center gap-1.5 rounded-[20px] px-3 py-1 text-[13px] font-medium"
          style={{ color: COLOR.amber, backgroundColor: 'rgba(245,158,11,0.1)', border: '0.5px solid rgba(245,158,11,0.2)' }}
        >
          <Flame className="h-3.5 w-3.5" />
          {data.greeting.streak_days}-day streak
        </div>
      </div>

      {/* Section 2 — promotion readiness banner */}
      <PromotionBanner promo={data.promotion_readiness} />

      {/* Section 3 — KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Skills validated"
          value={skills_total > 0 ? `${skills_validated}` : '—'}
          valueSub={skills_total > 0 ? `/ ${skills_total}` : undefined}
          delta={
            skills_total === 0
              ? 'Not yet tracked'
              : skills_validated >= skills_total
                ? 'All required skills validated'
                : `${skills_total - skills_validated} remaining`
          }
          deltaColor={skills_total > 0 && skills_validated >= skills_total ? COLOR.green : COLOR.muted35}
          progress={skillsPct}
          progressColor={COLOR.accent}
        />
        <KpiCard
          label="Blocking my promotion"
          value={`${blocking_count}`}
          valueColor={blocking_count > 0 ? COLOR.amber : COLOR.fg}
          delta={blocking_count > 0 ? `${blocking_count} item${blocking_count === 1 ? '' : 's'} need attention` : 'Nothing blocking you'}
          deltaColor={blocking_count > 0 ? COLOR.amber : COLOR.green}
          progress={blocking_count > 0 ? 100 : 0}
          progressColor="rgba(245,158,11,0.4)"
        />
        <KpiCard
          label="Assigned — due soon"
          value={`${assignments_due_soon}`}
          valueSub={assignments_due_soon === 1 ? 'assignment' : 'assignments'}
          delta={assignments_due_soon > 0 ? 'Due within your reminder window' : 'Nothing due soon'}
          deltaColor={assignments_due_soon > 0 ? COLOR.amber : COLOR.muted35}
          progress={assignments_due_soon > 0 ? 100 : 0}
          progressColor={COLOR.amber}
        />
        <KpiCard
          label="Certifications"
          value={`${certifications_active}`}
          valueSub="active"
          delta={certifications_active > 0 ? `${certifications_active} active` : 'Not yet tracked'}
          deltaColor={COLOR.muted35}
          progress={certifications_active > 0 ? 100 : 0}
          progressColor="rgba(255,255,255,0.15)"
        />
      </div>

      {/* Section 4 — two column panels */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <BlockingGrowthPanel items={data.promotion_readiness.blocking_items} />
        <NextActionsPanel actions={data.next_actions} />
      </div>

      {/* Section 5 — competency progress */}
      <CompetencyPanel targetRole={data.promotion_readiness.target_role} items={data.competency_progress} />
    </div>
  )
}
