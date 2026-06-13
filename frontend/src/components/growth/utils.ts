import { FileText, Link2, Package, Play, type LucideIcon } from 'lucide-react'
import { GROWTH_COLORS as COLOR } from './colors'
import type { ApiProficiencyLevel, SkillStatus } from './types'

// ---------------------------------------------------------------------------
// Status -> pill styling (skill inventory rows)
// ---------------------------------------------------------------------------

export const STATUS_LABEL: Record<SkillStatus, string> = {
  validated: 'Validated',
  self_declared: 'Self declared',
  pending_validation: 'Pending',
  rejected: 'Rejected',
}

export interface PillTone {
  color: string
  background: string
  border: string
}

export const STATUS_PILL_TONE: Record<SkillStatus, PillTone> = {
  validated: { color: COLOR.green, background: COLOR.greenBg10, border: COLOR.greenBorder20 },
  self_declared: { color: COLOR.accentGhostText, background: COLOR.accentBg10, border: COLOR.accentBorder20 },
  pending_validation: { color: COLOR.amber, background: COLOR.amberBg10, border: COLOR.amberBorder20 },
  rejected: { color: COLOR.red, background: COLOR.redBg10, border: COLOR.redBorder20 },
}

// ---------------------------------------------------------------------------
// Proficiency level ordering
// ---------------------------------------------------------------------------

export const TOTAL_PROFICIENCY_LEVELS = 4

/**
 * Fallback level_order by name, used only when a level name from
 * gap-analysis (which returns names, not ids/level_order) can't be matched
 * against a level from the inventory response. Matches the standard seed in
 * migrations/009_create_content_foundation.sql.
 */
const FALLBACK_LEVEL_ORDER: Record<string, number> = {
  Beginner: 1,
  Intermediate: 2,
  Advanced: 3,
  Expert: 4,
}

/** Every distinct proficiency level (id/name/level_order) seen across a skill inventory. */
export function extractProficiencyLevels(
  skills: { current_level: ApiProficiencyLevel | null; required_level: ApiProficiencyLevel | null }[]
): ApiProficiencyLevel[] {
  const byName = new Map<string, ApiProficiencyLevel>()
  for (const skill of skills) {
    if (skill.current_level) byName.set(skill.current_level.name, skill.current_level)
    if (skill.required_level) byName.set(skill.required_level.name, skill.required_level)
  }
  return Array.from(byName.values()).sort((a, b) => a.level_order - b.level_order)
}

/** Resolve a level name (e.g. from gap-analysis) to its 1-4 level_order. */
export function getLevelOrder(levelName: string | null, knownLevels: ApiProficiencyLevel[]): number {
  if (!levelName) return 0
  const match = knownLevels.find((level) => level.name === levelName)
  if (match) return match.level_order
  return FALLBACK_LEVEL_ORDER[levelName] ?? 0
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Mirrors the dashboard's formatDuration (app/(app)/dashboard/page.tsx). */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`
}

/** Always expressed in hours, even for sub-hour totals (e.g. "0.5h", "12h"). */
export function formatHoursLearned(minutes: number): string {
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`
}

export function formatShortDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function isSameMonth(dateString: string, reference: Date): boolean {
  const date = new Date(dateString)
  return date.getFullYear() === reference.getFullYear() && date.getMonth() === reference.getMonth()
}

// ---------------------------------------------------------------------------
// Content type -> icon/label (recommended content cards)
// ---------------------------------------------------------------------------

const CONTENT_TYPE_ICON: Record<string, LucideIcon> = {
  video: Play,
  pdf: FileText,
  article: FileText,
  scorm: Package,
  external_link: Link2,
}

export const CONTENT_TYPE_LABEL: Record<string, string> = {
  video: 'Video',
  pdf: 'PDF',
  article: 'Article',
  scorm: 'SCORM',
  external_link: 'Link',
}

export function getContentTypeIcon(contentType: string): LucideIcon {
  return CONTENT_TYPE_ICON[contentType] ?? FileText
}

export function formatContentTypeLabel(contentType: string): string {
  return CONTENT_TYPE_LABEL[contentType] ?? contentType.charAt(0).toUpperCase() + contentType.slice(1)
}
