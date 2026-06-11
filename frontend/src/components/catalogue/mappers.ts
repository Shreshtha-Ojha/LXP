import type {
  ApiAssignment,
  ApiLearningAsset,
  ApiProgressItem,
  CatalogueCourse,
  CourseStatus,
} from './types'

interface Overlay {
  progress?: ApiProgressItem
  assignment?: ApiAssignment
}

interface DerivedStatus {
  status: CourseStatus
  progress_pct?: number
  due_date?: string | null
}

/**
 * A course's badge/progress state depends on the *viewer's* relationship to
 * it (from /progress/me and /assignments/me), not the asset record itself —
 * so it's derived once here and reused by every mapper below.
 *
 * Precedence matches CourseCard's badge rules: completed beats in-progress
 * beats an open assignment beats the default content-type badge.
 */
function deriveStatus({ progress, assignment }: Overlay): DerivedStatus {
  if (progress?.status === 'completed') return { status: 'completed' }

  if (progress?.status === 'in_progress' || progress?.status === 'started') {
    return { status: 'in_progress', progress_pct: progress.progressPct ?? 0 }
  }

  if (assignment && assignment.status !== 'completed') {
    return { status: 'assigned', due_date: assignment.dueDate }
  }

  return { status: 'not_started' }
}

/** Converts a /catalog/browse or /catalog/search asset into the CourseCard view model. */
export function assetToCourse(asset: ApiLearningAsset, overlay: Overlay = {}): CatalogueCourse {
  return {
    id: asset.id,
    title: asset.title,
    content_type: asset.contentType,
    duration_minutes: asset.durationMinutes,
    proficiency_level: asset.proficiencyLevel?.name ?? 'All levels',
    skills: asset.skills.map((skill) => skill.name),
    ...deriveStatus(overlay),
  }
}

/**
 * Converts a /progress/me row into the CourseCard view model for the
 * "Continue learning" row. `asset` (looked up from already-fetched browse
 * results) fills in duration/proficiency/skills when available — progress
 * records alone only carry title and content type.
 */
export function progressToCourse(item: ApiProgressItem, asset?: ApiLearningAsset): CatalogueCourse {
  if (asset) return assetToCourse(asset, { progress: item })

  return {
    id: item.assetId,
    title: item.assetTitle,
    content_type: item.contentType,
    status: 'in_progress',
    progress_pct: item.progressPct ?? 0,
  }
}

/**
 * Converts an /assignments/me row into the CourseCard view model for the
 * "Assigned to you" row. Returns null for path assignments (assetId is
 * null) — only individual assets render as course cards here.
 */
export function assignmentToCourse(
  assignment: ApiAssignment,
  asset?: ApiLearningAsset,
  progress?: ApiProgressItem
): CatalogueCourse | null {
  if (!assignment.assetId) return null

  if (asset) return assetToCourse(asset, { progress, assignment })

  return {
    id: assignment.assetId,
    title: assignment.title ?? 'Untitled',
    content_type: progress?.contentType ?? 'unknown',
    ...deriveStatus({ progress, assignment }),
  }
}
