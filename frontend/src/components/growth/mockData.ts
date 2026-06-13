import type { SkillInventoryItem, SkillInventorySummary } from './types'

/**
 * Fallback inventory shown when GET /skills/inventory returns no rows (e.g.
 * a freshly seeded tenant where no associate has declared a skill yet) —
 * lets the page demonstrate every visual state (validated / self-declared /
 * pending / gap / met) without a populated database. Per the design spec,
 * this only replaces an *empty* successful response, never a loading or
 * error state.
 */
const MOCK_LEVEL_IDS: Record<string, string> = {
  Beginner: 'mock-level-1',
  Intermediate: 'mock-level-2',
  Advanced: 'mock-level-3',
  Expert: 'mock-level-4',
}

function level(name: string, levelOrder: number) {
  return { id: MOCK_LEVEL_IDS[name], name, level_order: levelOrder }
}

export const mockSkills: SkillInventoryItem[] = [
  {
    id: 'mock-1',
    skill_name: 'API Design',
    category: 'Backend',
    current_level: level('Advanced', 3),
    required_level: null,
    status: 'validated',
    source: 'self_declared',
    has_gap: false,
    gap_levels: 0,
    declared_at: '2026-04-02T00:00:00.000Z',
    validated_at: '2026-04-10T00:00:00.000Z',
  },
  {
    id: 'mock-2',
    skill_name: 'Kubernetes',
    category: 'Cloud & Infrastructure',
    current_level: level('Beginner', 1),
    required_level: level('Intermediate', 2),
    status: 'self_declared',
    source: 'self_declared',
    has_gap: true,
    gap_levels: 1,
    declared_at: '2026-05-12T00:00:00.000Z',
    validated_at: null,
  },
  {
    id: 'mock-3',
    skill_name: 'System Design',
    category: 'Architecture',
    current_level: level('Intermediate', 2),
    required_level: level('Advanced', 3),
    status: 'pending_validation',
    source: 'self_declared',
    has_gap: true,
    gap_levels: 1,
    declared_at: '2026-05-28T00:00:00.000Z',
    validated_at: null,
  },
  {
    id: 'mock-4',
    skill_name: 'OWASP/Security',
    category: 'Security',
    current_level: level('Advanced', 3),
    required_level: null,
    status: 'validated',
    source: 'self_declared',
    has_gap: false,
    gap_levels: 0,
    declared_at: '2026-03-15T00:00:00.000Z',
    validated_at: '2026-03-20T00:00:00.000Z',
  },
  {
    id: 'mock-5',
    skill_name: 'Docker',
    category: 'DevOps',
    current_level: level('Intermediate', 2),
    required_level: null,
    status: 'self_declared',
    source: 'self_declared',
    has_gap: false,
    gap_levels: 0,
    declared_at: '2026-05-30T00:00:00.000Z',
    validated_at: null,
  },
]

export const mockSummary: SkillInventorySummary = {
  total_skills: mockSkills.length,
  validated: mockSkills.filter((s) => s.status === 'validated').length,
  pending: mockSkills.filter((s) => s.status === 'pending_validation').length,
  self_declared: mockSkills.filter((s) => s.status === 'self_declared').length,
  skills_with_gaps: mockSkills.filter((s) => s.has_gap).length,
  skills_meeting_requirements: mockSkills.filter((s) => s.required_level && !s.has_gap).length,
}
