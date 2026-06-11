/**
 * Shared types for the Learning Catalogue (`/learn`).
 *
 * `CatalogueCourse` is the view model `CourseCard` renders — it matches the
 * shape of the mock data in the design spec (snake_case, flattened) so the
 * card never needs to know whether a course came from `/catalog/browse`,
 * `/catalog/search`, `/assignments/me`, or `/progress/me`. `mappers.ts`
 * converts each API response into this shape.
 */

export type CourseStatus = 'not_started' | 'in_progress' | 'completed' | 'assigned'

export interface CatalogueCourse {
  id: string
  title: string
  content_type: string
  duration_minutes?: number | null
  proficiency_level?: string | null
  skills?: string[]
  status: CourseStatus
  progress_pct?: number
  due_date?: string | null
}

// ---------------------------------------------------------------------------
// API response shapes (mirrors backend serializers — camelCase)
// ---------------------------------------------------------------------------

export interface ApiSkill {
  id: string
  name: string
}

export interface ApiProficiencyLevel {
  id: string
  name: string
  levelOrder: number
}

/** Mirrors contentService.serializeAsset — used by /catalog/search and /catalog/browse. */
export interface ApiLearningAsset {
  id: string
  tenantId: string
  title: string
  description: string | null
  contentType: string
  proficiencyLevel: ApiProficiencyLevel | null
  durationMinutes: number | null
  language: string | null
  version: number | string | null
  status: string
  effectiveFrom: string | null
  effectiveTo: string | null
  authorUserId: string | null
  storageUrl: string | null
  externalUrl: string | null
  tags: string[]
  skills: ApiSkill[]
  createdAt: string
  updatedAt: string
}

export interface CatalogSearchResponse {
  ok: boolean
  results: ApiLearningAsset[]
  total: number
  page: number
  limit: number
}

export interface CatalogBrowseResponse {
  ok: boolean
  recently_added: ApiLearningAsset[]
  by_skill: { skill: ApiSkill; assets: ApiLearningAsset[] }[]
  recommended: ApiLearningAsset[]
}

/** Mirrors assignmentService.serializeAssignment — used by /assignments/me. */
export interface ApiAssignment {
  id: string
  tenantId: string
  assetId: string | null
  pathId: string | null
  title: string | null
  assignedTo: string
  assignedBy: string
  dueDate: string | null
  isMandatory: boolean
  status: string
  isOverdue: boolean
  note: string | null
  createdAt: string
}

export interface AssignmentsResponse {
  assignments: ApiAssignment[]
}

/** Mirrors progressService.getMyProgress row shape — used by /progress/me. */
export interface ApiProgressItem {
  assetId: string
  assetTitle: string
  contentType: string
  status: string
  progressPct: number | null
  positionSeconds: number | null
  lastEventAt: string
  completedAt: string | null
  score: number | null
  timeSpentMinutes: number | null
}

export interface ProgressResponse {
  progress: ApiProgressItem[]
}
