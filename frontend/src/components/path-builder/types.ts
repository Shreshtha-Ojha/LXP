/**
 * Shared types and helpers for the Learning Path Builder
 * (`/admin/paths`, `/admin/paths/new`, `/admin/paths/[pathId]/edit`).
 *
 * `PathBuilderState` is the wizard's local working copy — camelCase, no
 * server ids required until save. `toCreatePayload` converts it to the
 * snake_case shape `POST /learning-paths` (nodes variant) expects. Persisted
 * to localStorage under `path_builder_draft` (see storage.ts) so a refresh
 * mid-wizard doesn't lose progress, per AGENTS.md ("write tests/persist
 * alongside the code, not after").
 */

export type PathStatus = 'draft' | 'published' | 'in_review' | 'retired'
export type PathType = 'competency' | 'career' | 'certification' | 'strategic'
export type ProficiencyLevelName = 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert'
export type BuilderNodeType = 'content' | 'quiz'

/** Mirrors learning_assets.content_type (migration 009). */
export type ContentItemType = 'video' | 'article' | 'pdf' | 'scorm' | 'external_link'

export const PATH_TYPES: { value: PathType; label: string; description: string }[] = [
  { value: 'competency', label: 'Competency', description: 'Builds specific skills toward a proficiency level' },
  { value: 'career', label: 'Career', description: 'Prepares for a target role' },
  { value: 'certification', label: 'Certification', description: 'Prepares for an external cert exam' },
  { value: 'strategic', label: 'Strategic', description: 'Org-wide priority learning' },
]

export const PROFICIENCY_LEVELS: ProficiencyLevelName[] = ['Beginner', 'Intermediate', 'Advanced', 'Expert']

export interface BuilderSkill {
  id: string
  name: string
}

export interface BuilderContentItem {
  id: string
  title: string
  type: ContentItemType
  durationMinutes: number | null
  /** Set when sourced from the catalogue search — references an existing learning_asset. */
  assetId?: string
  /** Set for "paste a link" items — the source video/article URL. */
  externalUrl?: string
  /** Set for "write an article" items — the article body (markdown-ish: ## headings, > callouts). */
  body?: string
}

export interface BuilderQuestionOption {
  id: string
  text: string
  isCorrect: boolean
}

export interface BuilderQuestion {
  id: string
  questionText: string
  options: BuilderQuestionOption[]
}

export interface BuilderNode {
  id: string
  type: BuilderNodeType
  title: string
  coins: number
  items: BuilderContentItem[]
  questions: BuilderQuestion[]
}

export interface PathBuilderState {
  title: string
  description: string
  pathType: PathType | null
  skills: BuilderSkill[]
  proficiencyLevel: ProficiencyLevelName | null
  durationHours: number
  durationMinutes: number
  nodes: BuilderNode[]
}

/** Row shape for the `/admin/paths` list — mirrors GET /learning-paths. */
export interface AdminPathSummary {
  id: string
  title: string
  description: string
  status: PathStatus
  node_count: number
  duration_minutes: number
  total_coins: number
  skills: string[]
  created_by: string
  created_at: string
}

// ---------------------------------------------------------------------------
// ID generation & factories
// ---------------------------------------------------------------------------

let idCounter = 0

/** Stable-enough client-side ids for wizard state (never sent as real PKs). */
export function createId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`
}

export function createEmptyPathState(): PathBuilderState {
  return {
    title: '',
    description: '',
    pathType: null,
    skills: [],
    proficiencyLevel: null,
    durationHours: 0,
    durationMinutes: 0,
    nodes: [],
  }
}

export function createContentNode(): BuilderNode {
  return { id: createId('node'), type: 'content', title: '', coins: 50, items: [], questions: [] }
}

export function createQuizNode(): BuilderNode {
  return { id: createId('node'), type: 'quiz', title: 'Knowledge check', coins: 75, items: [], questions: [] }
}

export function createQuestion(): BuilderQuestion {
  return {
    id: createId('q'),
    questionText: '',
    options: [0, 1, 2, 3].map(() => ({ id: createId('opt'), text: '', isCorrect: false })),
  }
}

// ---------------------------------------------------------------------------
// Derived totals
// ---------------------------------------------------------------------------

export function totalCoins(nodes: BuilderNode[]): number {
  return nodes.reduce((sum, node) => sum + (node.coins || 0), 0)
}

/** Sum of content-item durations across all nodes — quiz nodes contribute 0. */
export function totalDurationMinutes(nodes: BuilderNode[]): number {
  return nodes.reduce(
    (sum, node) => sum + node.items.reduce((itemSum, item) => itemSum + (item.durationMinutes ?? 0), 0),
    0
  )
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}

export function nodeTypeLabel(node: BuilderNode): string {
  return node.type === 'quiz'
    ? `Quiz node · ${node.questions.length} question${node.questions.length === 1 ? '' : 's'}`
    : `Content node · ${node.items.length} item${node.items.length === 1 ? '' : 's'}`
}

/** A question is "complete" once it has text and exactly one correct option with text. */
export function isQuestionValid(question: BuilderQuestion): boolean {
  const correctOptions = question.options.filter((option) => option.isCorrect && option.text.trim() !== '')
  return question.questionText.trim() !== '' && correctOptions.length === 1
}

// ---------------------------------------------------------------------------
// Validation for the review step
// ---------------------------------------------------------------------------

export interface ReviewCheck {
  label: string
  met: boolean
  /** Warnings render amber and don't block publishing; failures render red-ish via `met: false`. */
  isWarning?: boolean
}

export function getReviewChecks(state: PathBuilderState): ReviewCheck[] {
  const hasQuizNode = state.nodes.some((node) => node.type === 'quiz')
  const allNodesPopulated = state.nodes.every((node) =>
    node.type === 'quiz' ? node.questions.length > 0 : node.items.length > 0
  )

  return [
    { label: 'Path has a title and description', met: state.title.trim() !== '' && state.description.trim() !== '' },
    { label: 'At least 2 nodes added', met: state.nodes.length >= 2 },
    { label: 'No quiz nodes (recommended but not required)', met: hasQuizNode, isWarning: true },
    { label: 'All nodes have at least 1 content item or question', met: state.nodes.length > 0 && allNodesPopulated },
    { label: 'Skills tagged', met: state.skills.length > 0 },
  ]
}

// ---------------------------------------------------------------------------
// API payload conversion — POST /learning-paths (nodes variant)
// ---------------------------------------------------------------------------

export interface CreatePathNodeItemPayload {
  asset_id?: string
  title?: string
  content_type?: ContentItemType
  duration_minutes?: number | null
  external_url?: string
  body?: string
  item_order: number
}

export interface CreatePathNodeQuestionOptionPayload {
  text: string
  is_correct: boolean
  option_order: number
}

export interface CreatePathNodeQuestionPayload {
  question_text: string
  question_order: number
  options: CreatePathNodeQuestionOptionPayload[]
}

export interface CreatePathNodePayload {
  title: string
  type: BuilderNodeType
  node_order: number
  coins: number
  items: CreatePathNodeItemPayload[]
  questions: CreatePathNodeQuestionPayload[]
}

export interface CreatePathWithNodesPayload {
  title: string
  description: string
  path_type: PathType
  proficiency_level_name: ProficiencyLevelName | null
  skill_ids: string[]
  estimated_duration_minutes: number
  nodes: CreatePathNodePayload[]
}

export function toCreatePayload(state: PathBuilderState): CreatePathWithNodesPayload {
  return {
    title: state.title.trim(),
    description: state.description.trim(),
    path_type: state.pathType ?? 'competency',
    proficiency_level_name: state.proficiencyLevel,
    skill_ids: state.skills.map((skill) => skill.id),
    estimated_duration_minutes: totalDurationMinutes(state.nodes) || state.durationHours * 60 + state.durationMinutes,
    nodes: state.nodes.map((node, nodeIndex) => ({
      title: node.title.trim(),
      type: node.type,
      node_order: nodeIndex + 1,
      coins: node.coins,
      items: node.items.map((item, itemIndex) => ({
        asset_id: item.assetId,
        title: item.assetId ? undefined : item.title,
        content_type: item.assetId ? undefined : item.type,
        duration_minutes: item.durationMinutes,
        external_url: item.externalUrl,
        body: item.body,
        item_order: itemIndex + 1,
      })),
      questions: node.questions.map((question, questionIndex) => ({
        question_text: question.questionText.trim(),
        question_order: questionIndex + 1,
        options: question.options.map((option, optionIndex) => ({
          text: option.text.trim(),
          is_correct: option.isCorrect,
          option_order: optionIndex + 1,
        })),
      })),
    })),
  }
}
