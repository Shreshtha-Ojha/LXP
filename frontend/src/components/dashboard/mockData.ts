import type { CompetencyProgressItem, DashboardKpis, NextActionDisplay } from './types'

/**
 * Fallback dashboard data shown while real data is loading or when a query
 * returns an empty result (e.g. no target role set yet, no gap-based
 * recommendations, nothing assigned). Lets the page render its full layout
 * immediately — optimistic UI per the dashboard wiring spec — and is
 * replaced in place once the corresponding query resolves with data.
 */

const AMBER = '#f59e0b'
const VIOLET = '#7C6AF7'

export const mockKpis: DashboardKpis = {
  skills_validated: 4,
  skills_total: 7,
  blocking_count: 2,
  assignments_due_soon: 2,
  certifications_active: 1,
}

export const mockNextActions: NextActionDisplay[] = [
  {
    title: 'Complete the Kubernetes security review',
    typeLabel: 'Assignment',
    typeColor: AMBER,
    meta: 'Due in 2 days · mandatory',
    href: '/learn',
  },
  {
    title: 'Kubernetes Fundamentals',
    typeLabel: 'Course',
    typeColor: VIOLET,
    meta: '45 min · Closes gap in Kubernetes',
    href: '/learn',
  },
  {
    title: 'System Design Deep Dive',
    typeLabel: 'Course',
    typeColor: VIOLET,
    meta: '1.5h · Closes gap in System Design',
    href: '/learn',
  },
]

export const mockCompetencyProgress: CompetencyProgressItem[] = [
  { name: 'Kubernetes', current_level: 'Beginner', required_level: 'Intermediate', progress_pct: 50, gap: true },
  { name: 'System Design', current_level: 'Intermediate', required_level: 'Advanced', progress_pct: 67, gap: true },
  { name: 'API Design', current_level: 'Advanced', required_level: 'Advanced', progress_pct: 100, gap: false },
  { name: 'OWASP/Security', current_level: 'Advanced', required_level: 'Intermediate', progress_pct: 100, gap: false },
]
