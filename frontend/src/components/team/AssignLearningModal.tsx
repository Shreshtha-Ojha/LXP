'use client'

import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { api } from '@/lib/api'
import { Spinner } from '@/components/ui/Spinner'
import { ContentSearchField } from './ContentSearchField'
import { TeamMemberSelectList } from './TeamMemberSelectList'
import { TEAM_COLORS as COLOR } from './colors'
import type { AssignableContent, AssignTeamMember } from './types'

const SUCCESS_CLOSE_DELAY_MS = 1500
const FAILURE_MESSAGE = 'Failed to assign to some members. Please try again.'

export interface AssignLearningModalProps {
  teamMembers: AssignTeamMember[]
  onClose: () => void
  onSuccess: () => void
  /** Pre-checks these user ids when the modal opens (e.g. "Assign" from a single person row). */
  initialSelectedUserIds?: string[]
  /** Pre-fills step 1 (e.g. "Assign path" pre-selects the System Design path). */
  initialContent?: AssignableContent
}

/** Mirrors assignmentService.createAssignment's input contract — `target.user_ids` resolves to one assignment row per user, in a single transaction. */
interface CreateAssignmentInput {
  asset_id?: string
  path_id?: string
  target: { type: 'users'; user_ids: string[] }
  is_mandatory: boolean
  due_date?: string
  note?: string
}

export function AssignLearningModal({ teamMembers, onClose, onSuccess, initialSelectedUserIds, initialContent }: AssignLearningModalProps) {
  const [selectedContent, setSelectedContent] = useState<AssignableContent | null>(initialContent ?? null)
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(() => new Set(initialSelectedUserIds))
  const [isMandatory, setIsMandatory] = useState(true)
  const [dueDate, setDueDate] = useState('')
  const [note, setNote] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [succeeded, setSucceeded] = useState(false)

  useEffect(() => {
    function handleEsc(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [onClose])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  // Show the success state briefly, then hand control back to the caller (closes + shows the toast).
  useEffect(() => {
    if (!succeeded) return
    const timer = setTimeout(onSuccess, SUCCESS_CLOSE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [succeeded, onSuccess])

  function toggleMember(userId: string) {
    setSelectedUserIds((current) => {
      const next = new Set(current)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  function toggleAll() {
    setSelectedUserIds((current) => {
      const allSelected = teamMembers.length > 0 && teamMembers.every((member) => current.has(member.user_id))
      return allSelected ? new Set() : new Set(teamMembers.map((member) => member.user_id))
    })
  }

  const canSubmit = selectedContent !== null && selectedUserIds.size > 0 && !isSubmitting

  async function handleSubmit() {
    if (!selectedContent || selectedUserIds.size === 0) return

    setIsSubmitting(true)
    setSubmitError(null)

    const payload: CreateAssignmentInput = {
      target: { type: 'users', user_ids: Array.from(selectedUserIds) },
      is_mandatory: isMandatory,
      due_date: dueDate || undefined,
      note: note.trim() || undefined,
    }
    if (selectedContent.type === 'path') payload.path_id = selectedContent.id
    else payload.asset_id = selectedContent.id

    try {
      await api.post('/assignments', payload)
      setSucceeded(true)
    } catch {
      setSubmitError(FAILURE_MESSAGE)
    } finally {
      setIsSubmitting(false)
    }
  }

  let summaryPrimary = ''
  let summarySecondary: string | null = null
  if (selectedContent && selectedUserIds.size > 0) {
    summaryPrimary = `Assigning to ${selectedUserIds.size} ${selectedUserIds.size === 1 ? 'person' : 'people'}`
    summarySecondary = selectedContent.title
  } else if (selectedContent) {
    summaryPrimary = 'Select team members'
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
      style={{ backgroundColor: COLOR.overlay }}
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex h-screen w-screen flex-col overflow-y-auto p-6 sm:h-auto sm:max-h-[90vh] sm:w-[560px] sm:max-w-[calc(100vw-2rem)] sm:rounded-xl"
        style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.muted10}` }}
      >
        {succeeded ? (
          <SuccessState count={selectedUserIds.size} />
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-[16px] font-medium" style={{ color: COLOR.title }}>
                  Assign learning
                </h2>
                <p className="mt-0.5 text-[13px]" style={{ color: COLOR.muted35 }}>
                  Assign a course or path to your team
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                style={{ backgroundColor: COLOR.muted04, border: `0.5px solid ${COLOR.muted08}`, color: COLOR.muted40 }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <ContentSearchField selected={selectedContent} onSelect={setSelectedContent} />

            <TeamMemberSelectList members={teamMembers} selectedIds={selectedUserIds} onToggle={toggleMember} onToggleAll={toggleAll} />

            <AssignmentSettings
              isMandatory={isMandatory}
              onMandatoryChange={setIsMandatory}
              dueDate={dueDate}
              onDueDateChange={setDueDate}
              note={note}
              onNoteChange={setNote}
            />

            <div className="mt-6 flex items-center justify-between pt-4" style={{ borderTop: `0.5px solid ${COLOR.cardBorder}` }}>
              <div>
                {summaryPrimary && (
                  <div className="text-[13px]" style={{ color: summarySecondary ? COLOR.muted50 : COLOR.muted30 }}>
                    {summaryPrimary}
                  </div>
                )}
                {summarySecondary && (
                  <div className="mt-0.5 text-[12px]" style={{ color: COLOR.accentMuted }}>
                    {summarySecondary}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md px-3.5 py-2 text-[13px] transition-colors hover:bg-[rgba(255,255,255,0.04)]"
                  style={{ color: COLOR.muted50 }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ backgroundColor: COLOR.accent }}
                >
                  {isSubmitting && <Spinner className="h-3.5 w-3.5 text-white" />}
                  Assign
                </button>
              </div>
            </div>

            {submitError && (
              <p className="mt-2 text-right text-[13px]" style={{ color: COLOR.red }}>
                {submitError}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

interface AssignmentSettingsProps {
  isMandatory: boolean
  onMandatoryChange: (value: boolean) => void
  dueDate: string
  onDueDateChange: (value: string) => void
  note: string
  onNoteChange: (value: string) => void
}

function AssignmentSettings({ isMandatory, onMandatoryChange, dueDate, onDueDateChange, note, onNoteChange }: AssignmentSettingsProps) {
  return (
    <div className="mt-5">
      <div className="flex items-center justify-between py-2.5" style={{ borderBottom: `0.5px solid ${COLOR.muted06}` }}>
        <div>
          <div className="text-[13px]" style={{ color: COLOR.title }}>
            Mandatory
          </div>
          <div className="text-[12px]" style={{ color: COLOR.muted30 }}>
            Associates must complete this
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isMandatory}
          onClick={() => onMandatoryChange(!isMandatory)}
          className="relative h-5 w-9 shrink-0 rounded-full transition-colors"
          style={{ backgroundColor: isMandatory ? COLOR.accent : COLOR.muted10 }}
        >
          <span
            className="absolute top-0.5 h-4 w-4 rounded-full transition-all"
            style={{ backgroundColor: COLOR.white, left: isMandatory ? '18px' : '2px' }}
          />
        </button>
      </div>

      <div className="flex items-center justify-between py-2.5" style={{ borderBottom: `0.5px solid ${COLOR.muted06}` }}>
        <div>
          <div className="text-[13px]" style={{ color: COLOR.title }}>
            Due date
          </div>
          <div className="text-[12px]" style={{ color: COLOR.muted30 }}>
            Optional — leave blank for no deadline
          </div>
        </div>
        <input
          type="date"
          value={dueDate}
          onChange={(event) => onDueDateChange(event.target.value)}
          className="rounded-md px-2.5 py-[5px] text-[13px] outline-none"
          style={{ backgroundColor: COLOR.inputBg, border: `0.5px solid ${COLOR.inputBorder}`, color: COLOR.title, width: '140px', colorScheme: 'dark' }}
        />
      </div>

      <div className="pt-2.5">
        <label className="mb-1.5 block text-[12px]" style={{ color: COLOR.muted50 }}>
          Note (optional)
        </label>
        <textarea
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          rows={3}
          placeholder="Why are you assigning this? Any context for your team..."
          className="w-full resize-none rounded-[7px] px-3 py-2 text-[13px] outline-none"
          style={{ backgroundColor: COLOR.inputBg, border: `0.5px solid ${COLOR.inputBorder}`, color: COLOR.title }}
        />
      </div>
    </div>
  )
}

function SuccessState({ count }: { count: number }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: COLOR.greenBg10, color: COLOR.green }}>
        <Check className="h-5 w-5" />
      </div>
      <div className="text-[16px] font-medium" style={{ color: COLOR.title }}>
        Learning assigned!
      </div>
      <div className="text-[13px]" style={{ color: COLOR.muted40 }}>
        {count} team member{count === 1 ? '' : 's'} will be notified
      </div>
    </div>
  )
}
