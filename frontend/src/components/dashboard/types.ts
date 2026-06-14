/**
 * Shared types for the Associate Dashboard (`/dashboard`).
 *
 * `DashboardResponse` mirrors the subset of
 * backend/src/modules/dashboard/dashboardService.js's GET /dashboard/me
 * response that this page still reads directly (greeting + kpis) —
 * promotion_readiness, next_actions, and competency_progress are Release 0
 * placeholders superseded here by /skills/gap-analysis and
 * /skills/recommendations (see CHANGE 3/4/6 in the dashboard wiring work).
 */

export interface DashboardKpis {
  skills_validated: number
  skills_total: number
  blocking_count: number
  assignments_due_soon: number
  certifications_active: number
}

export interface DashboardResponse {
  greeting: {
    name: string | null
    streak_days: number
  }
  kpis: DashboardKpis
}

/** A row in the "Skills required for X" panel — one gap or met requirement. */
export interface CompetencyProgressItem {
  name: string
  current_level: string
  required_level: string
  progress_pct: number
  gap: boolean
}

/** A row in "What to do next" — combines /skills/recommendations and /assignments/me. */
export interface NextActionDisplay {
  title: string
  typeLabel: string
  typeColor: string
  meta: string
  href: string
}

/** A row in "What's blocking my growth" — gap-driven (amber) or overdue-assignment-driven (red). */
export interface BlockerDisplay {
  key: string
  description: string
  tag: string
  tone: 'amber' | 'red'
}
