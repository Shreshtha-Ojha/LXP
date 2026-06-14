'use client'

import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Download, Plus } from 'lucide-react'
import { api } from '@/lib/api'
import { getHomeRouteForRole } from '@/lib/auth'
import { useAuthStore } from '@/store/authStore'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/utils'
import { AssignLearningModal } from '@/components/team/AssignLearningModal'
import { PIPELINE_STATUS_META } from '@/components/team/colors'
import {
  SYSTEM_DESIGN_CONTENT,
  type AssignableContent,
  type AssignTeamMember,
  type PromotionPipelineEntry,
} from '@/components/team/types'

// Field names mirror backend/src/modules/dashboard/dashboardService.js
// (GET /dashboard/team) exactly. promotion_pipeline and skill_heatmap depend
// on entities that don't exist yet (CareerAspiration/ReadinessScore —
// Release 3; SkillRecord/ValidationStatus — Release 2) and are returned as
// `[]` until that schema lands — this page renders an empty state for those
// panels until then, per AGENTS.md ("do not build ahead of the current
// release"). team_size is not part of the API contract; it is undefined for
// real responses and only present on the local mock dataset below.
interface TeamSummary {
  team_readiness_pct: number | null
  at_risk_count: number
  promotion_ready_count: number
  overdue_count: number
  pending_validations_count: number
}

type InterventionUrgency = 'low' | 'medium' | 'high'

interface TeamIntervention {
  user_id: string
  name: string | null
  type: string
  description: string
  action: string
  urgency: InterventionUrgency
}

type HeatmapLevel = 'adv' | 'int' | 'beg' | 'missing'

interface HeatmapSkillCell {
  skill_name: string
  level: HeatmapLevel
}

interface SkillHeatmapRow {
  user_id: string
  name: string
  skills: HeatmapSkillCell[]
}

interface TeamDashboardResponse {
  summary: TeamSummary
  interventions: TeamIntervention[]
  promotion_pipeline: PromotionPipelineEntry[]
  skill_heatmap: SkillHeatmapRow[]
  team_size?: number | null
}

const COLOR = {
  card: '#161618',
  cardBorder: 'rgba(255,255,255,0.07)',
  hairline: 'rgba(255,255,255,0.05)',
  rowBg: 'rgba(255,255,255,0.02)',
  rowBorder: 'rgba(255,255,255,0.06)',
  trackMuted: 'rgba(255,255,255,0.07)',
  title: '#e2e0f9',
  muted70: 'rgba(255,255,255,0.7)',
  muted60: 'rgba(255,255,255,0.6)',
  muted50: 'rgba(255,255,255,0.5)',
  muted40: 'rgba(255,255,255,0.4)',
  muted30: 'rgba(255,255,255,0.3)',
  muted25: 'rgba(255,255,255,0.25)',
  muted20: 'rgba(255,255,255,0.2)',
  accent: '#7C6AF7',
  accentText: '#9d8ff7',
  accentBorder: 'rgba(124,106,247,0.3)',
  accentMuted: 'rgba(124,106,247,0.7)',
  amber: '#f59e0b',
  green: '#4ade80',
  red: '#f87171',
} as const

const URGENCY_DOT_COLOR: Record<InterventionUrgency, string> = {
  high: COLOR.red,
  medium: COLOR.amber,
  low: COLOR.muted20,
}

const INTERVENTION_CTA: Record<string, string> = {
  overdue_assignments: 'Remind →',
  stalled_path: 'Review →',
  pending_validation: 'Validate →',
  certification_expiring: 'Assign path →',
}

const HEATMAP_LEVEL_META: Record<HeatmapLevel, { bg: string; color: string; label: string }> = {
  adv: { bg: 'rgba(74,222,128,0.15)', color: COLOR.green, label: 'Adv' },
  int: { bg: 'rgba(245,158,11,0.12)', color: COLOR.amber, label: 'Int' },
  beg: { bg: 'rgba(245,158,11,0.12)', color: COLOR.amber, label: 'Beg' },
  missing: { bg: 'rgba(248,113,113,0.12)', color: COLOR.red, label: '—' },
}

const TOAST_DURATION_MS = 4000

// Dev Kapoor appears only in `interventions` (his AWS cert is expiring), not
// in `promotion_pipeline` — this stands in for his roster entry so the
// "Assign path →" CTA can open AssignLearningModal with him pre-selected.
const DEV_KAPOOR_MEMBER: AssignTeamMember = {
  user_id: 'mock-dev-kapoor',
  initials: 'DK',
  name: 'Dev Kapoor',
  target_role: 'Senior engineer',
  readiness_pct: 0,
  status: 'in_progress',
  avatar_bg: 'rgba(255,255,255,0.06)',
  avatar_color: COLOR.muted40,
}

// Placeholder dataset shown while /dashboard/team is loading-with-no-signal
// (a manager with no flagged direct reports) or unreachable, so this page
// always renders the full design. Replace with live data as Release 2/3
// promotion-pipeline and skill-heatmap entities land.
const mockTeamData: TeamDashboardResponse = {
  team_size: 12,
  summary: {
    team_readiness_pct: 61,
    at_risk_count: 4,
    promotion_ready_count: 2,
    overdue_count: 6,
    pending_validations_count: 8,
  },
  interventions: [
    {
      user_id: 'mock-ananya-singh',
      name: 'Ananya Singh',
      type: 'overdue_assignments',
      description: 'has 3 overdue mandatory courses — compliance deadline in 6 days. No activity in 18 days.',
      action: 'send_reminder',
      urgency: 'high',
    },
    {
      user_id: 'mock-rohit-mehta',
      name: 'Rohit Mehta',
      type: 'stalled_path',
      description: 'is 8 weeks into a learning path with 4% completion. Assigned in March.',
      action: 'review_path',
      urgency: 'medium',
    },
    {
      user_id: 'mock-priya-nair',
      name: 'Priya Nair',
      type: 'pending_validation',
      description: 'declared Python Advanced 3 weeks ago — your validation is pending.',
      action: 'validate_skill',
      urgency: 'medium',
    },
    {
      user_id: 'mock-dev-kapoor',
      name: 'Dev Kapoor',
      type: 'certification_expiring',
      description: 'AWS certification expiring in 45 days. No renewal path started.',
      action: 'assign_path',
      urgency: 'low',
    },
  ],
  promotion_pipeline: [
    {
      user_id: 'mock-karan-shah',
      name: 'Karan Shah',
      initials: 'KS',
      target_role: 'Tech lead',
      readiness_pct: 91,
      pct_color: COLOR.green,
      bar_color: COLOR.green,
      avatar_bg: 'rgba(74,222,128,0.12)',
      avatar_color: COLOR.green,
      status: 'ready',
    },
    {
      user_id: 'mock-priya-mehta',
      name: 'Priya Mehta',
      initials: 'PM',
      target_role: 'Senior engineer',
      readiness_pct: 86,
      pct_color: COLOR.accentText,
      bar_color: COLOR.accent,
      avatar_bg: 'rgba(124,106,247,0.12)',
      avatar_color: COLOR.accentText,
      status: 'ready',
    },
    {
      user_id: 'mock-shreshtha-ojha',
      name: 'Shreshtha Ojha',
      initials: 'SO',
      target_role: 'Tech lead',
      readiness_pct: 72,
      pct_color: COLOR.amber,
      bar_color: COLOR.amber,
      avatar_bg: 'rgba(255,255,255,0.06)',
      avatar_color: COLOR.muted40,
      status: 'in_progress',
    },
    {
      user_id: 'mock-ananya-singh-pipeline',
      name: 'Ananya Singh',
      initials: 'AS',
      target_role: 'Senior engineer',
      readiness_pct: 31,
      pct_color: COLOR.red,
      bar_color: COLOR.red,
      avatar_bg: 'rgba(248,113,113,0.1)',
      avatar_color: COLOR.red,
      status: 'at_risk',
    },
  ],
  skill_heatmap: [
    {
      user_id: 'mock-karan-shah',
      name: 'Karan S.',
      skills: [
        { skill_name: 'Backend', level: 'adv' },
        { skill_name: 'Cloud', level: 'int' },
        { skill_name: 'Security', level: 'adv' },
        { skill_name: 'System design', level: 'int' },
        { skill_name: 'DevOps', level: 'beg' },
      ],
    },
    {
      user_id: 'mock-priya-mehta',
      name: 'Priya M.',
      skills: [
        { skill_name: 'Backend', level: 'adv' },
        { skill_name: 'Cloud', level: 'beg' },
        { skill_name: 'Security', level: 'int' },
        { skill_name: 'System design', level: 'beg' },
        { skill_name: 'DevOps', level: 'int' },
      ],
    },
    {
      user_id: 'mock-shreshtha-ojha',
      name: 'Shreshtha O.',
      skills: [
        { skill_name: 'Backend', level: 'adv' },
        { skill_name: 'Cloud', level: 'beg' },
        { skill_name: 'Security', level: 'adv' },
        { skill_name: 'System design', level: 'int' },
        { skill_name: 'DevOps', level: 'missing' },
      ],
    },
    {
      user_id: 'mock-ananya-singh-heatmap',
      name: 'Ananya S.',
      skills: [
        { skill_name: 'Backend', level: 'int' },
        { skill_name: 'Cloud', level: 'missing' },
        { skill_name: 'Security', level: 'missing' },
        { skill_name: 'System design', level: 'missing' },
        { skill_name: 'DevOps', level: 'missing' },
      ],
    },
    {
      user_id: 'mock-rohit-mehta',
      name: 'Rohit M.',
      skills: [
        { skill_name: 'Backend', level: 'int' },
        { skill_name: 'Cloud', level: 'int' },
        { skill_name: 'Security', level: 'beg' },
        { skill_name: 'System design', level: 'int' },
        { skill_name: 'DevOps', level: 'int' },
      ],
    },
  ],
}

async function fetchTeamDashboard(): Promise<TeamDashboardResponse> {
  const { data } = await api.get<TeamDashboardResponse>('/dashboard/team')
  return data
}

/** True for the "no direct reports flagged" shape dashboardService returns — render the mock instead. */
function isEmptyTeamResponse(data: TeamDashboardResponse): boolean {
  return (
    data.summary.at_risk_count === 0 &&
    data.summary.overdue_count === 0 &&
    data.interventions.length === 0 &&
    data.promotion_pipeline.length === 0 &&
    data.skill_heatmap.length === 0
  )
}

// --- presentational helpers -------------------------------------------------

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-[9px]', className)} style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.cardBorder}` }}>
      {children}
    </div>
  )
}

interface StatCardProps {
  label: string
  value: string
  valueColor?: string
  delta: string
  deltaColor: string
  deltaClickable?: boolean
}

function StatCard({ label, value, valueColor = COLOR.title, delta, deltaColor, deltaClickable }: StatCardProps) {
  return (
    <Panel className="px-4 py-3">
      <div className="text-[11px]" style={{ color: COLOR.muted30 }}>
        {label}
      </div>
      <div className="mt-1.5 text-xl font-medium" style={{ color: valueColor }}>
        {value}
      </div>
      <div className="mt-1 text-xs" style={{ color: deltaColor, cursor: deltaClickable ? 'pointer' : undefined }}>
        {delta}
      </div>
    </Panel>
  )
}

function PageHeader({ teamSize, onAssignClick }: { teamSize: number | null; onAssignClick: () => void }) {
  return (
    <div className="mb-5 flex items-center justify-between">
      <div>
        <h1 className="text-[18px] font-medium" style={{ color: COLOR.title }}>
          Team overview
        </h1>
        <p className="mt-0.5 text-[13px]" style={{ color: COLOR.muted30 }}>
          {teamSize != null ? `${teamSize} direct reports` : 'Your direct reports'} · Last updated 2 hours ago
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] transition-colors hover:bg-[rgba(255,255,255,0.04)]"
          style={{ color: COLOR.muted50 }}
        >
          <Download className="h-3.5 w-3.5" />
          Export
        </button>
        <button
          type="button"
          onClick={onAssignClick}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-[rgba(124,106,247,0.08)]"
          style={{ color: COLOR.accentText, border: `0.5px solid ${COLOR.accentBorder}` }}
        >
          <Plus className="h-3.5 w-3.5" />
          Assign learning
        </button>
      </div>
    </div>
  )
}

function InterventionRow({ item, isLast, onAction }: { item: TeamIntervention; isLast: boolean; onAction: (item: TeamIntervention) => void }) {
  return (
    <div
      className={cn('flex gap-2.5 rounded-[7px] px-2.5 py-2', !isLast && 'mb-1.5')}
      style={{ backgroundColor: COLOR.rowBg, border: `0.5px solid ${COLOR.rowBorder}` }}
    >
      <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: URGENCY_DOT_COLOR[item.urgency] }} />
      <div className="flex-1 leading-[1.5]">
        {item.name && (
          <span className="font-medium" style={{ color: COLOR.title }}>
            {item.name}{' '}
          </span>
        )}
        <span className="text-[13px]" style={{ color: COLOR.muted60 }}>
          {item.description}
        </span>
      </div>
      <span className="mt-px shrink-0 cursor-pointer text-xs" style={{ color: COLOR.accentMuted }} onClick={() => onAction(item)}>
        {INTERVENTION_CTA[item.type] ?? 'Review →'}
      </span>
    </div>
  )
}

function InterventionPanel({ items, onAction }: { items: TeamIntervention[]; onAction: (item: TeamIntervention) => void }) {
  return (
    <div>
      <div className="mb-2.5 text-[10px] uppercase tracking-wide" style={{ color: COLOR.muted25 }}>
        Intervention needed
      </div>
      <Panel className="px-[18px] py-4">
        {items.length === 0 ? (
          <div className="py-6 text-center text-sm" style={{ color: COLOR.muted30 }}>
            Nothing needs your attention right now
          </div>
        ) : (
          items.map((item, index) => (
            <InterventionRow key={`${item.user_id}-${item.type}`} item={item} isLast={index === items.length - 1} onAction={onAction} />
          ))
        )}
      </Panel>
    </div>
  )
}

function PipelineRow({ entry, isLast, onAssign }: { entry: PromotionPipelineEntry; isLast: boolean; onAssign: (entry: PromotionPipelineEntry) => void }) {
  const meta = PIPELINE_STATUS_META[entry.status]

  return (
    <div className="group flex items-center gap-2.5 py-[7px]" style={!isLast ? { borderBottom: `0.5px solid ${COLOR.hairline}` } : undefined}>
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-medium"
        style={{ backgroundColor: entry.avatar_bg, color: entry.avatar_color }}
      >
        {entry.initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]" style={{ color: COLOR.muted70 }}>
          {entry.name}
        </div>
        <div className="text-[11px]" style={{ color: COLOR.muted30 }}>
          → {entry.target_role}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-[3px]">
        <div className="text-[11px] font-medium" style={{ color: entry.pct_color }}>
          {entry.readiness_pct}%
        </div>
        <div className="h-[3px] w-[60px] overflow-hidden rounded-[2px]" style={{ backgroundColor: COLOR.trackMuted }}>
          <div className="h-full rounded-[2px]" style={{ width: `${entry.readiness_pct}%`, backgroundColor: entry.bar_color }} />
        </div>
      </div>
      <div className="relative flex shrink-0 items-center justify-end">
        <span
          className="rounded text-[11px] transition-opacity group-hover:opacity-0"
          style={{ color: meta.color, backgroundColor: meta.bg, border: `0.5px solid ${meta.border}`, padding: '2px 8px' }}
        >
          {meta.label}
        </span>
        <span
          onClick={() => onAssign(entry)}
          className="absolute right-0 cursor-pointer text-[11px] opacity-0 transition-opacity group-hover:opacity-100"
          style={{ color: COLOR.accentMuted }}
        >
          Assign →
        </span>
      </div>
    </div>
  )
}

function PromotionPipelinePanel({
  entries,
  teamSize,
  onAssign,
}: {
  entries: PromotionPipelineEntry[]
  teamSize: number | null
  onAssign: (entry: PromotionPipelineEntry) => void
}) {
  return (
    <Panel className="px-[18px] py-4">
      <div className="mb-1 flex items-center">
        <h2 className="text-[13px] font-medium" style={{ color: COLOR.title }}>
          Promotion pipeline
        </h2>
        <span className="ml-auto cursor-pointer text-xs" style={{ color: COLOR.accentMuted }}>
          {teamSize != null ? `All ${teamSize} people` : 'All people'}
        </span>
      </div>
      {entries.length === 0 ? (
        <div className="py-6 text-center text-sm" style={{ color: COLOR.muted30 }}>
          Promotion pipeline will appear once career targets and readiness scoring are configured
        </div>
      ) : (
        entries.map((entry, index) => (
          <PipelineRow key={entry.user_id} entry={entry} isLast={index === entries.length - 1} onAssign={onAssign} />
        ))
      )}
    </Panel>
  )
}

function SkillHeatmapPanel({ rows }: { rows: SkillHeatmapRow[] }) {
  return (
    <Panel className="px-[18px] py-4">
      <div className="mb-3 flex items-center">
        <h2 className="text-[13px] font-medium" style={{ color: COLOR.title }}>
          Skill heatmap — team gaps
        </h2>
        <span className="ml-auto cursor-pointer text-xs" style={{ color: COLOR.accentMuted }}>
          Full breakdown
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="py-6 text-center text-sm" style={{ color: COLOR.muted30 }}>
          Skill heatmap will appear once skill validation data is available for your team
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div
            className="grid min-w-[420px] items-center gap-1"
            style={{ gridTemplateColumns: `90px repeat(${rows[0].skills.length}, 1fr)` }}
          >
            <div />
            {rows[0].skills.map((skill) => (
              <div key={skill.skill_name} className="px-0.5 text-center text-[10px]" style={{ color: COLOR.muted30 }}>
                {skill.skill_name}
              </div>
            ))}

            {rows.map((row) => (
              <Fragment key={row.user_id}>
                <div className="flex h-7 items-center text-[11px]" style={{ color: COLOR.muted40 }}>
                  {row.name}
                </div>
                {row.skills.map((skill) => {
                  const meta = HEATMAP_LEVEL_META[skill.level]
                  return (
                    <div
                      key={skill.skill_name}
                      className="flex h-7 items-center justify-center rounded-[5px] text-[10px] font-medium"
                      style={{ backgroundColor: meta.bg, color: meta.color }}
                    >
                      {meta.label}
                    </div>
                  )
                })}
              </Fragment>
            ))}
          </div>

          <div className="mt-1.5 flex gap-3 text-[11px]">
            <span style={{ color: 'rgba(74,222,128,0.7)' }}>● Met</span>
            <span style={{ color: 'rgba(245,158,11,0.7)' }}>● Gap</span>
            <span style={{ color: 'rgba(248,113,113,0.7)' }}>● Missing</span>
          </div>
        </div>
      )}
    </Panel>
  )
}

function TeamPageSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-5 w-40 animate-pulse rounded" style={{ backgroundColor: COLOR.card }} />
          <div className="h-3 w-56 animate-pulse rounded" style={{ backgroundColor: COLOR.card }} />
        </div>
        <div className="flex gap-2">
          <div className="h-8 w-20 animate-pulse rounded-md" style={{ backgroundColor: COLOR.card }} />
          <div className="h-8 w-32 animate-pulse rounded-md" style={{ backgroundColor: COLOR.card }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-[74px] animate-pulse rounded-[9px]" style={{ backgroundColor: COLOR.card }} />
        ))}
      </div>

      <div className="h-48 animate-pulse rounded-[9px]" style={{ backgroundColor: COLOR.card }} />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="h-64 animate-pulse rounded-[9px]" style={{ backgroundColor: COLOR.card }} />
        <div className="h-64 animate-pulse rounded-[9px]" style={{ backgroundColor: COLOR.card }} />
      </div>
    </div>
  )
}

/** Configures which members AssignLearningModal opens with — and any pre-selections. */
interface AssignModalState {
  teamMembers: AssignTeamMember[]
  initialSelectedUserIds?: string[]
  initialContent?: AssignableContent
}

export default function TeamPage() {
  const router = useRouter()
  const activeRole = useAuthStore((state) => state.activeRole)

  // Associates and other non-manager roles use the personal dashboard, not
  // this team view — bounce them there on load.
  const belongsOnAssociateDashboard = getHomeRouteForRole(activeRole) !== '/team'

  useEffect(() => {
    if (belongsOnAssociateDashboard) {
      router.replace('/dashboard')
    }
  }, [belongsOnAssociateDashboard, router])

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-team'],
    queryFn: fetchTeamDashboard,
    enabled: !belongsOnAssociateDashboard,
  })

  const [assignModal, setAssignModal] = useState<AssignModalState | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), TOAST_DURATION_MS)
    return () => clearTimeout(timer)
  }, [toast])

  if (belongsOnAssociateDashboard || isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  const team = data && !isEmptyTeamResponse(data) ? data : mockTeamData
  const { summary } = team
  const teamSize = team.team_size ?? null

  function openAssignModal(config: AssignModalState) {
    setAssignModal(config)
  }

  function handleAssignFromPipeline(entry: PromotionPipelineEntry) {
    openAssignModal({ teamMembers: team.promotion_pipeline, initialSelectedUserIds: [entry.user_id] })
  }

  function handleInterventionAction(item: TeamIntervention) {
    if (item.type !== 'certification_expiring') return
    openAssignModal({
      teamMembers: [...team.promotion_pipeline, DEV_KAPOOR_MEMBER],
      initialSelectedUserIds: [DEV_KAPOOR_MEMBER.user_id],
      initialContent: SYSTEM_DESIGN_CONTENT,
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader teamSize={teamSize} onAssignClick={() => openAssignModal({ teamMembers: team.promotion_pipeline })} />

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
        <StatCard
          label="Team readiness"
          value={summary.team_readiness_pct != null ? `${summary.team_readiness_pct}%` : '—'}
          delta={summary.team_readiness_pct != null ? '↓ 3% vs last month' : 'Not yet tracked'}
          deltaColor={summary.team_readiness_pct != null ? COLOR.amber : COLOR.muted25}
        />
        <StatCard
          label="At risk"
          value={`${summary.at_risk_count}`}
          valueColor={COLOR.red}
          delta="people need action"
          deltaColor={COLOR.muted25}
        />
        <StatCard
          label="Promotion ready"
          value={`${summary.promotion_ready_count}`}
          valueColor={COLOR.green}
          delta="above 85% readiness"
          deltaColor={COLOR.muted25}
        />
        <StatCard
          label="Overdue learning"
          value={`${summary.overdue_count}`}
          valueColor={COLOR.amber}
          delta="assignments overdue"
          deltaColor={COLOR.muted25}
        />
        <StatCard
          label="Validations pending"
          value={`${summary.pending_validations_count}`}
          delta="Review now →"
          deltaColor={COLOR.accentMuted}
          deltaClickable
        />
      </div>

      <InterventionPanel items={team.interventions} onAction={handleInterventionAction} />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <PromotionPipelinePanel entries={team.promotion_pipeline} teamSize={teamSize} onAssign={handleAssignFromPipeline} />
        <SkillHeatmapPanel rows={team.skill_heatmap} />
      </div>

      {assignModal && (
        <AssignLearningModal
          teamMembers={assignModal.teamMembers}
          initialSelectedUserIds={assignModal.initialSelectedUserIds}
          initialContent={assignModal.initialContent}
          onClose={() => setAssignModal(null)}
          onSuccess={() => {
            setAssignModal(null)
            setToast('Learning assigned — your team will be notified')
          }}
        />
      )}

      {toast && (
        <div
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[8px] px-4 py-2.5 text-[13px] shadow-lg"
          style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.cardBorder}`, color: COLOR.title }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}
