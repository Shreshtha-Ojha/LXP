'use client'

import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { api, getErrorMessage } from '@/lib/api'
import { GROWTH_COLORS as COLOR } from './colors'
import type { AllSkillsResponse, ApiProficiencyLevel, DeclareSkillInput } from './types'

async function fetchAllSkills(): Promise<AllSkillsResponse> {
  const { data } = await api.get<AllSkillsResponse>('/skills/all')
  return data
}

const FIELD_STYLE = {
  backgroundColor: COLOR.inputBg,
  border: `0.5px solid ${COLOR.inputBorder}`,
  color: COLOR.pageTitle,
} as const

export interface DeclareSkillModalProps {
  open: boolean
  onClose: () => void
  /** Called after a successful POST /skills/declare — the inventory has already been invalidated. */
  onDeclared: () => void
  /**
   * Levels the caller already has ids for (derived from /skills/inventory —
   * there is no dedicated proficiency-levels endpoint). May be a subset of
   * Beginner/Intermediate/Advanced/Expert if the tenant's inventory hasn't
   * surfaced every level yet.
   */
  proficiencyLevels: ApiProficiencyLevel[]
}

export function DeclareSkillModal({ open, onClose, onDeclared, proficiencyLevels }: DeclareSkillModalProps) {
  const queryClient = useQueryClient()

  const [skillId, setSkillId] = useState('')
  const [levelId, setLevelId] = useState('')
  const [evidenceUrl, setEvidenceUrl] = useState('')
  const [note, setNote] = useState('')

  const skillsQuery = useQuery({
    queryKey: ['skills-all'],
    queryFn: fetchAllSkills,
    enabled: open,
  })

  const declareMutation = useMutation({
    mutationFn: (input: DeclareSkillInput) => api.post('/skills/declare', input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['skills-inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['skills-gap-analysis'] }),
      ])
      resetForm()
      onDeclared()
      onClose()
    },
  })

  function resetForm() {
    setSkillId('')
    setLevelId('')
    setEvidenceUrl('')
    setNote('')
    declareMutation.reset()
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      resetForm()
      onClose()
    }
  }

  function handleSubmit() {
    if (!skillId || !levelId) return
    declareMutation.mutate({
      skill_id: skillId,
      current_level_id: levelId,
      evidence_url: evidenceUrl.trim() || undefined,
      note: note.trim() || undefined,
    })
  }

  const canSubmit = skillId !== '' && levelId !== '' && !declareMutation.isPending

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 backdrop-blur-sm" style={{ backgroundColor: COLOR.overlay }} />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-xl p-6"
          style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.inputBorder}` }}
        >
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-[16px] font-medium" style={{ color: COLOR.pageTitle }}>
              Declare a skill
            </Dialog.Title>
            <Dialog.Close aria-label="Close" style={{ color: COLOR.muted35 }}>
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Declare a skill and your current proficiency level for manager validation.
          </Dialog.Description>

          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-[12px]" style={{ color: COLOR.muted45 }}>
                Skill
              </label>
              <select
                value={skillId}
                onChange={(event) => setSkillId(event.target.value)}
                className="w-full rounded-[7px] px-3 py-2 text-[13px] outline-none"
                style={FIELD_STYLE}
              >
                <option value="" disabled>
                  {skillsQuery.isLoading ? 'Loading skills…' : 'Select a skill'}
                </option>
                {(skillsQuery.data ?? []).map((group) => (
                  <optgroup key={group.category_name} label={group.category_name}>
                    {group.skills.map((skill) => (
                      <option key={skill.id} value={skill.id}>
                        {skill.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-[12px]" style={{ color: COLOR.muted45 }}>
                Your current level
              </label>
              {proficiencyLevels.length > 0 ? (
                <div className="grid grid-cols-4 gap-2">
                  {proficiencyLevels.map((level) => {
                    const selected = levelId === level.id
                    return (
                      <button
                        key={level.id}
                        type="button"
                        onClick={() => setLevelId(level.id)}
                        className="rounded-[7px] px-2 py-2 text-center text-[12px] transition-colors"
                        style={
                          selected
                            ? { backgroundColor: COLOR.accentBg12, border: `0.5px solid ${COLOR.accentBorder40}`, color: COLOR.accentTitle }
                            : { backgroundColor: COLOR.muted06, border: `0.5px solid ${COLOR.muted10}`, color: COLOR.muted45 }
                        }
                      >
                        {level.name}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="text-[12px]" style={{ color: COLOR.muted35 }}>
                  No proficiency levels available yet — declare your first skill once your inventory has data.
                </p>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-[12px]" style={{ color: COLOR.muted45 }}>
                Evidence URL (optional)
              </label>
              <input
                type="url"
                value={evidenceUrl}
                onChange={(event) => setEvidenceUrl(event.target.value)}
                placeholder="Link to your work, GitHub, or certificate"
                className="w-full rounded-[7px] px-3 py-2 text-[13px] outline-none"
                style={FIELD_STYLE}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[12px]" style={{ color: COLOR.muted45 }}>
                Note to your manager
              </label>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                placeholder="Brief description of your experience with this skill"
                className="w-full resize-none rounded-[7px] px-3 py-2 text-[13px] outline-none"
                style={FIELD_STYLE}
              />
            </div>

            {declareMutation.isError && (
              <p className="text-[12px]" style={{ color: COLOR.red }}>
                {getErrorMessage(declareMutation.error)}
              </p>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="w-full rounded-[7px] py-2.5 text-[13px] font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: COLOR.accent }}
            >
              {declareMutation.isPending ? 'Submitting…' : 'Submit for validation'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
