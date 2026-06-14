/**
 * localStorage persistence for in-progress path builder work.
 *
 * `path_builder_draft` holds the wizard's working state (new path) so a
 * refresh mid-wizard doesn't lose progress — cleared on publish/save per the
 * spec. `path_canvas_draft:<pathId>` holds the canvas editor's autosave for
 * an existing path (the "localStorage save for demo — real API save in next
 * sprint" stand-in noted on the edit page).
 */
import { type PathBuilderState } from './types'

const WIZARD_DRAFT_KEY = 'path_builder_draft'

export function saveWizardDraft(state: PathBuilderState): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(WIZARD_DRAFT_KEY, JSON.stringify(state))
}

export function loadWizardDraft(): PathBuilderState | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(WIZARD_DRAFT_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as PathBuilderState
  } catch {
    return null
  }
}

export function clearWizardDraft(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(WIZARD_DRAFT_KEY)
}

function canvasDraftKey(pathId: string): string {
  return `path_canvas_draft:${pathId}`
}

export function saveCanvasDraft(pathId: string, state: PathBuilderState): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(canvasDraftKey(pathId), JSON.stringify(state))
}

export function loadCanvasDraft(pathId: string): PathBuilderState | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(canvasDraftKey(pathId))
  if (!raw) return null
  try {
    return JSON.parse(raw) as PathBuilderState
  } catch {
    return null
  }
}
