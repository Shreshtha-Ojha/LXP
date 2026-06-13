'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle } from 'lucide-react'
import { api, getErrorMessage } from '@/lib/api'
import { EmptyState } from '@/components/ui/EmptyState'
import type { ProgressResponse } from '@/components/catalogue/types'
import { GROWTH_COLORS as COLOR } from '@/components/growth/colors'
import { DeclareSkillModal } from '@/components/growth/DeclareSkillModal'
import { LearningActivityPanel } from '@/components/growth/LearningActivityPanel'
import { mockSkills, mockSummary } from '@/components/growth/mockData'
import { SkillGapPanel } from '@/components/growth/SkillGapPanel'
import { SkillInventoryPanel, type SkillRowAction } from '@/components/growth/SkillInventoryPanel'
import { StatCard } from '@/components/growth/StatCard'
import type {
  DashboardStreakResponse,
  GapAnalysisResponse,
  SkillInventoryItem,
  SkillInventoryResponse,
} from '@/components/growth/types'
import { extractProficiencyLevels } from '@/components/growth/utils'

async function fetchInventory(): Promise<SkillInventoryResponse> {
  const { data } = await api.get<SkillInventoryResponse>('/skills/inventory')
  return data
}

async function fetchGapAnalysis(): Promise<GapAnalysisResponse> {
  const { data } = await api.get<GapAnalysisResponse>('/skills/gap-analysis')
  return data
}

async function fetchProgress(): Promise<ProgressResponse> {
  const { data } = await api.get<ProgressResponse>('/progress/me')
  return data
}

/** Shares the ['dashboard-me'] cache entry with the dashboard page — only `greeting.streak_days` is read here. */
async function fetchDashboardStreak(): Promise<DashboardStreakResponse> {
  const { data } = await api.get<DashboardStreakResponse>('/dashboard/me')
  return data
}

const TOAST_DURATION_MS = 4000

const ROW_ACTION_MESSAGE: Record<SkillRowAction, string> = {
  update_level: 'Updating your level',
  add_evidence: 'Adding evidence',
  request_validation: 'Requesting validation',
}

export default function GrowthPage() {
  const [modalOpen, setModalOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const inventoryQuery = useQuery({ queryKey: ['skills-inventory'], queryFn: fetchInventory })
  const gapQuery = useQuery({ queryKey: ['skills-gap-analysis'], queryFn: fetchGapAnalysis })
  const progressQuery = useQuery({ queryKey: ['progress-me'], queryFn: fetchProgress })
  const dashboardQuery = useQuery({ queryKey: ['dashboard-me'], queryFn: fetchDashboardStreak })

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), TOAST_DURATION_MS)
    return () => clearTimeout(timer)
  }, [toast])

  const realSkills = useMemo(() => inventoryQuery.data?.skills ?? [], [inventoryQuery.data])
  const usingMockInventory = inventoryQuery.data !== undefined && realSkills.length === 0
  const skills: SkillInventoryItem[] = usingMockInventory ? mockSkills : realSkills
  const summary = usingMockInventory ? mockSummary : inventoryQuery.data?.summary

  // Proficiency level ids for the declare modal come only from the real
  // inventory (there is no dedicated /proficiency-levels endpoint) — never
  // from mock data, whose level ids don't exist server-side.
  const knownLevels = useMemo(() => extractProficiencyLevels(realSkills), [realSkills])

  const progress = progressQuery.data?.progress ?? []
  const streakDays = dashboardQuery.data?.greeting.streak_days ?? 0

  if (inventoryQuery.isError && !inventoryQuery.data) {
    return (
      <EmptyState
        icon={AlertCircle}
        heading="Couldn't load your growth data"
        subtext={getErrorMessage(inventoryQuery.error)}
      />
    )
  }

  const gapsCount = summary?.skills_with_gaps ?? 0
  const isLoadingSummary = inventoryQuery.isLoading
  const skillGapsColor = isLoadingSummary ? COLOR.pageTitle : gapsCount > 0 ? COLOR.red : COLOR.green
  const skillGapsDelta = isLoadingSummary ? '' : gapsCount > 0 ? 'below required level' : 'all requirements met'

  function handleRowAction(action: SkillRowAction, skill: SkillInventoryItem) {
    setToast(`${ROW_ACTION_MESSAGE[action]} for "${skill.skill_name}" isn't available yet — coming in a future release.`)
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-medium" style={{ color: COLOR.pageTitle }}>
            My growth
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: COLOR.muted35 }}>
            Your skills, gaps, and development progress
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="shrink-0 rounded-md px-3.5 py-2 text-[13px] font-medium transition-colors hover:bg-[rgba(124,106,247,0.08)]"
          style={{ color: COLOR.accentGhostText, border: `0.5px solid ${COLOR.accentGhostBorder}` }}
        >
          Declare a skill
        </button>
      </div>

      {/* Section 1 — summary */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCard label="Total skills" value={isLoadingSummary ? '—' : summary?.total_skills ?? 0} delta="in your inventory" />
        <StatCard
          label="Validated"
          value={isLoadingSummary ? '—' : summary?.validated ?? 0}
          valueColor={COLOR.green}
          delta="confirmed by your manager"
        />
        <StatCard
          label="Pending"
          value={isLoadingSummary ? '—' : summary?.pending ?? 0}
          valueColor={COLOR.amber}
          delta="awaiting validation"
        />
        <StatCard label="Skill gaps" value={isLoadingSummary ? '—' : gapsCount} valueColor={skillGapsColor} delta={skillGapsDelta} />
      </div>

      {/* Section 2 — skill inventory */}
      <SkillInventoryPanel
        skills={skills}
        isLoading={inventoryQuery.isLoading}
        onRowAction={handleRowAction}
        onDeclareClick={() => setModalOpen(true)}
      />

      {/* Section 3 — skill gap analysis (hidden entirely if there are no gaps) */}
      {gapQuery.data && <SkillGapPanel data={gapQuery.data} knownLevels={knownLevels} />}

      {/* Section 4 — learning activity */}
      <LearningActivityPanel progress={progress} streakDays={streakDays} isLoading={progressQuery.isLoading} />

      <DeclareSkillModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onDeclared={() => setToast('Skill declared — your manager will be notified')}
        proficiencyLevels={knownLevels}
      />

      {toast && (
        <div
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[8px] px-4 py-2.5 text-[13px] shadow-lg"
          style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.cardBorder}`, color: COLOR.pageTitle }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}
