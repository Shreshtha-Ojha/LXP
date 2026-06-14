/**
 * Shared types for the Team manager screens (`/team`) — the team dashboard
 * and the assign-learning modal both read these.
 */

import { SYSTEM_DESIGN_PATH } from '@/components/path/types'

export type PipelineStatus = 'ready' | 'in_progress' | 'at_risk'

/** Field names mirror backend/src/modules/dashboard/dashboardService.js's promotion_pipeline rows. */
export interface PromotionPipelineEntry {
  user_id: string
  name: string
  initials: string
  target_role: string
  readiness_pct: number
  pct_color: string
  bar_color: string
  avatar_bg: string
  avatar_color: string
  status: PipelineStatus
}

/**
 * Minimal shape AssignLearningModal needs to render a team-member row.
 * `PromotionPipelineEntry` has every one of these fields, so a
 * `PromotionPipelineEntry[]` can be passed directly as `teamMembers`.
 */
export interface AssignTeamMember {
  user_id: string
  initials: string
  name: string
  target_role: string
  readiness_pct: number
  status: PipelineStatus
  avatar_bg: string
  avatar_color: string
}

export type AssignableContentKind = 'asset' | 'path'

/** What the user picked in step 1 of AssignLearningModal — either a catalog asset or a learning path. */
export interface AssignableContent {
  id: string
  title: string
  content_type: string
  duration_minutes: number | null
  type: AssignableContentKind
}

/** The hardcoded "System Design" learning path — shown as a pinned option in the assign modal's search dropdown. */
export const SYSTEM_DESIGN_CONTENT: AssignableContent = {
  id: SYSTEM_DESIGN_PATH.id,
  title: SYSTEM_DESIGN_PATH.title,
  content_type: 'learning_path',
  duration_minutes: 360,
  type: 'path',
}
