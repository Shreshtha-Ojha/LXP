/**
 * Hardcoded demo data for the Learning Path Builder, per the spec — the
 * admin path list (`demoPaths`) and a seeded builder state for the
 * `system-design-101` canvas editor, derived from the learner-facing
 * `SYSTEM_DESIGN_PATH` mock in `components/path/types.ts` so both views of
 * the same path stay in sync.
 */
import { QUIZ_QUESTIONS, SYSTEM_DESIGN_PATH } from '@/components/path/types'
import {
  type AdminPathSummary,
  type BuilderContentItem,
  type BuilderNode,
  type ContentItemType,
  type PathBuilderState,
  createId,
} from './types'

export const demoPaths: AdminPathSummary[] = [
  {
    id: 'system-design-101',
    title: 'System Design',
    description:
      'From fundamentals to real-world architecture. Covers scalability, data storage, APIs, and hands-on system design challenges.',
    status: 'published',
    node_count: 9,
    duration_minutes: 360,
    total_coins: 925,
    skills: ['System Design', 'API Design'],
    created_by: 'Shreshtha Ojha',
    created_at: '2026-06-01',
  },
  {
    id: 'docker-kubernetes',
    title: 'Docker & Kubernetes',
    description: 'Container fundamentals through production-grade orchestration. Build, ship, and run applications at scale.',
    status: 'draft',
    node_count: 7,
    duration_minutes: 280,
    total_coins: 650,
    skills: ['Docker', 'Kubernetes'],
    created_by: 'Shreshtha Ojha',
    created_at: '2026-06-10',
  },
  {
    id: 'api-design-mastery',
    title: 'API Design Mastery',
    description: 'REST, GraphQL, gRPC, and beyond. Design APIs that scale, evolve, and delight developers.',
    status: 'in_review',
    node_count: 6,
    duration_minutes: 240,
    total_coins: 500,
    skills: ['API Design', 'System Design'],
    created_by: 'Rahul Sharma',
    created_at: '2026-06-08',
  },
]

/** Extracts the leading integer from strings like "18 min" — 0 if absent. */
function parseDurationMinutes(duration: string | undefined): number {
  if (!duration) return 0
  const match = duration.match(/\d+/)
  return match ? Number(match[0]) : 0
}

/** Generic placeholder questions for nodes without seeded QUIZ_QUESTIONS (node-6, node-9). */
function placeholderQuestions(topic: string, count: number): BuilderNode['questions'] {
  return Array.from({ length: count }, (_, i) => ({
    id: createId('q'),
    questionText: `Question ${i + 1} about ${topic}`,
    options: ['A', 'B', 'C', 'D'].map((label, optionIndex) => ({
      id: createId('opt'),
      text: `Option ${label}`,
      isCorrect: optionIndex === 0,
    })),
  }))
}

function buildSystemDesignState(): PathBuilderState {
  const nodes: BuilderNode[] = SYSTEM_DESIGN_PATH.nodes.map((node, index) => {
    if (node.type === 'quiz' || node.type === 'final') {
      const seeded = QUIZ_QUESTIONS[node.id]
      const topicMatch = node.items[0]?.title.match(/on (.+)$/)
      const topic = topicMatch ? topicMatch[1] : node.title.toLowerCase()
      return {
        id: createId('node'),
        type: 'quiz',
        title: node.title,
        coins: node.coins,
        items: [],
        questions: seeded
          ? seeded.map((q) => ({
              id: createId('q'),
              questionText: q.q,
              options: q.options.map((text, optionIndex) => ({
                id: createId('opt'),
                text,
                isCorrect: optionIndex === q.correct,
              })),
            }))
          : placeholderQuestions(topic, node.type === 'final' ? 15 : 5),
      }
    }

    const items: BuilderContentItem[] = node.items.map((item) => ({
      id: createId('item'),
      title: item.title,
      type: (item.type === 'quiz' ? 'article' : item.type) as ContentItemType,
      durationMinutes: parseDurationMinutes(item.duration),
      assetId: `asset-${node.index}-${index}`,
    }))

    return {
      id: createId('node'),
      type: 'content',
      title: node.title,
      coins: node.coins,
      items,
      questions: [],
    }
  })

  return {
    title: SYSTEM_DESIGN_PATH.title,
    description:
      'From fundamentals to real-world architecture. Covers scalability, data storage, APIs, and hands-on system design challenges.',
    pathType: 'competency',
    skills: [
      { id: 'skill-system-design', name: 'System Design' },
      { id: 'skill-api-design', name: 'API Design' },
    ],
    proficiencyLevel: 'Intermediate',
    durationHours: 6,
    durationMinutes: 0,
    nodes,
  }
}

const MOCK_PATH_STATES: Record<string, () => PathBuilderState> = {
  'system-design-101': buildSystemDesignState,
}

/** Returns a fresh seeded builder state for the given path id, or null if there's no mock for it. */
export function getMockPathState(pathId: string): PathBuilderState | null {
  const factory = MOCK_PATH_STATES[pathId]
  return factory ? factory() : null
}

export function getMockPathSummary(pathId: string): AdminPathSummary | null {
  return demoPaths.find((path) => path.id === pathId) ?? null
}
