/**
 * Shared types for the My Growth screen (`/growth`).
 *
 * Mirrors backend/src/modules/skills/skillService.js response shapes
 * exactly (snake_case, as returned over the wire) — there is no mapper
 * layer here because these screens consume the skills API directly.
 */

export interface ApiProficiencyLevel {
  id: string
  name: string
  level_order: number
}

export type SkillStatus = 'self_declared' | 'pending_validation' | 'validated' | 'rejected'

/** One row of GET /skills/inventory's `skills` array. */
export interface SkillInventoryItem {
  id: string
  skill_name: string
  category: string | null
  current_level: ApiProficiencyLevel | null
  required_level: ApiProficiencyLevel | null
  status: SkillStatus
  source: string
  has_gap: boolean
  gap_levels: number
  declared_at: string
  validated_at: string | null
}

export interface SkillInventorySummary {
  total_skills: number
  validated: number
  pending: number
  self_declared: number
  skills_with_gaps: number
  skills_meeting_requirements: number
}

export interface SkillInventoryResponse {
  skills: SkillInventoryItem[]
  summary: SkillInventorySummary
}

/** One entry of GET /skills/gap-analysis's `gaps[].recommended_content`. */
export interface RecommendedContentItem {
  id: string
  title: string
  content_type: string
  duration_minutes: number | null
}

export interface SkillGap {
  skill_name: string
  current_level: string | null
  required_level: string
  gap_levels: number
  recommended_content: RecommendedContentItem[]
}

export interface MetRequirement {
  skill_name: string
  current_level: string | null
  required_level: string
}

export interface GapAnalysisResponse {
  target_role: string | null
  readiness_pct: number
  gaps: SkillGap[]
  met: MetRequirement[]
}

/** One option in GET /skills/all (a bare array, not wrapped in an object). */
export interface SkillOption {
  id: string
  name: string
}

export interface SkillGroup {
  category_name: string
  skills: SkillOption[]
}

export type AllSkillsResponse = SkillGroup[]

/** POST /skills/declare request body. */
export interface DeclareSkillInput {
  skill_id: string
  current_level_id: string
  evidence_url?: string
  note?: string
}

/** Minimal shape of GET /dashboard/me used only for the streak tile. */
export interface DashboardStreakResponse {
  greeting: {
    streak_days: number
  }
}

export type InventoryFilter = 'all' | 'validated' | 'pending' | 'gaps'
