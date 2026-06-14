'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUp, Award, ChevronDown, Flag, Target, X, type LucideIcon } from 'lucide-react'
import { api } from '@/lib/api'
import { BUILDER_COLORS as COLOR } from './colors'
import { PATH_TYPES, PROFICIENCY_LEVELS, type BuilderSkill, type PathBuilderState, type PathType } from './types'

const TITLE_MAX = 80
const DESCRIPTION_MAX = 300

interface SkillGroup {
  category_name: string
  skills: BuilderSkill[]
}

const PATH_TYPE_ICONS: Record<PathType, LucideIcon> = {
  competency: Target,
  career: ArrowUp,
  certification: Award,
  strategic: Flag,
}

const FIELD_INPUT_STYLE = { backgroundColor: COLOR.inputBg, border: `0.5px solid ${COLOR.inputBorder}` }

export interface Step1DetailsProps {
  state: PathBuilderState
  onUpdate: (patch: Partial<PathBuilderState>) => void
}

export function Step1Details({ state, onUpdate }: Step1DetailsProps) {
  const [isSkillPickerOpen, setIsSkillPickerOpen] = useState(false)
  const [skillQuery, setSkillQuery] = useState('')
  const pickerRef = useRef<HTMLDivElement>(null)

  const { data: skillGroups } = useQuery({
    queryKey: ['skills-all'],
    queryFn: async () => (await api.get<SkillGroup[]>('/skills/all')).data,
  })

  useEffect(() => {
    if (!isSkillPickerOpen) return

    function handleClickOutside(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setIsSkillPickerOpen(false)
      }
    }

    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [isSkillPickerOpen])

  function toggleSkill(skill: BuilderSkill) {
    const isSelected = state.skills.some((s) => s.id === skill.id)
    onUpdate({
      skills: isSelected ? state.skills.filter((s) => s.id !== skill.id) : [...state.skills, skill],
    })
  }

  function removeSkill(skillId: string) {
    onUpdate({ skills: state.skills.filter((s) => s.id !== skillId) })
  }

  const query = skillQuery.trim().toLowerCase()
  const filteredGroups = (skillGroups ?? [])
    .map((group) => ({
      ...group,
      skills: query ? group.skills.filter((skill) => skill.name.toLowerCase().includes(query)) : group.skills,
    }))
    .filter((group) => group.skills.length > 0)

  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" style={{ color: COLOR.muted50 }}>
          Path title
        </label>
        <input
          type="text"
          value={state.title}
          onChange={(event) => onUpdate({ title: event.target.value.slice(0, TITLE_MAX) })}
          placeholder="e.g. System Design Mastery"
          maxLength={TITLE_MAX}
          className="h-10 w-full rounded-md px-3 text-sm text-white placeholder:text-[rgba(255,255,255,0.3)] focus:outline-none"
          style={FIELD_INPUT_STYLE}
        />
        <div className="text-right text-[11px]" style={{ color: COLOR.muted30 }}>
          {state.title.length}/{TITLE_MAX}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" style={{ color: COLOR.muted50 }}>
          Description
        </label>
        <textarea
          rows={3}
          value={state.description}
          onChange={(event) => onUpdate({ description: event.target.value.slice(0, DESCRIPTION_MAX) })}
          placeholder="What will learners get from this path?"
          maxLength={DESCRIPTION_MAX}
          className="w-full resize-none rounded-md px-3 py-2 text-sm text-white placeholder:text-[rgba(255,255,255,0.3)] focus:outline-none"
          style={FIELD_INPUT_STYLE}
        />
        <div className="text-right text-[11px]" style={{ color: COLOR.muted30 }}>
          {state.description.length}/{DESCRIPTION_MAX}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" style={{ color: COLOR.muted50 }}>
          Path type
        </label>
        <div className="grid grid-cols-2 gap-3">
          {PATH_TYPES.map((type) => {
            const Icon = PATH_TYPE_ICONS[type.value]
            const selected = state.pathType === type.value
            return (
              <button
                key={type.value}
                type="button"
                onClick={() => onUpdate({ pathType: type.value })}
                className="flex flex-col items-start gap-2 rounded-[10px] p-3 text-left transition-colors"
                style={
                  selected
                    ? { backgroundColor: COLOR.accentBg10, border: `0.5px solid ${COLOR.accentBorder35}` }
                    : { backgroundColor: COLOR.muted03, border: `0.5px solid ${COLOR.muted08}` }
                }
              >
                <Icon className="h-4 w-4" style={{ color: selected ? COLOR.accent : COLOR.muted45 }} />
                <div className="text-sm font-medium" style={{ color: selected ? COLOR.accentTitle : COLOR.pageTitle }}>
                  {type.label}
                </div>
                <div className="text-[11px]" style={{ color: COLOR.muted35 }}>
                  {type.description}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" style={{ color: COLOR.muted50 }}>
          Target skills
        </label>
        <div ref={pickerRef} className="relative">
          <button
            type="button"
            onClick={() => setIsSkillPickerOpen((prev) => !prev)}
            className="flex h-10 w-full items-center justify-between rounded-md px-3 text-sm transition-colors"
            style={{ ...FIELD_INPUT_STYLE, color: state.skills.length > 0 ? COLOR.pageTitle : COLOR.muted35 }}
          >
            {state.skills.length > 0 ? `${state.skills.length} skill${state.skills.length === 1 ? '' : 's'} selected` : 'Select skills...'}
            <ChevronDown className="h-4 w-4" style={{ color: COLOR.muted30 }} />
          </button>

          {isSkillPickerOpen && (
            <div
              className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md p-2"
              style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.inputBorder}` }}
            >
              <input
                type="text"
                value={skillQuery}
                onChange={(event) => setSkillQuery(event.target.value)}
                placeholder="Search skills..."
                className="mb-2 h-8 w-full rounded-md px-2 text-xs text-white placeholder:text-[rgba(255,255,255,0.3)] focus:outline-none"
                style={{ backgroundColor: COLOR.locked, border: `0.5px solid ${COLOR.inputBorder}` }}
              />
              {filteredGroups.length === 0 && (
                <div className="px-2 py-1.5 text-xs" style={{ color: COLOR.muted30 }}>
                  No skills found
                </div>
              )}
              {filteredGroups.map((group) => (
                <div key={group.category_name} className="mb-2">
                  <div className="px-1 py-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: COLOR.muted30 }}>
                    {group.category_name}
                  </div>
                  {group.skills.map((skill) => {
                    const selected = state.skills.some((s) => s.id === skill.id)
                    return (
                      <button
                        key={skill.id}
                        type="button"
                        onClick={() => toggleSkill(skill)}
                        className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-xs transition-colors hover:bg-[rgba(255,255,255,0.04)]"
                        style={{ color: selected ? COLOR.accentTitle : COLOR.muted45 }}
                      >
                        {skill.name}
                        {selected && <span>✓</span>}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {state.skills.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {state.skills.map((skill) => (
              <span
                key={skill.id}
                className="inline-flex items-center gap-1 rounded-[20px] px-2.5 py-1 text-xs"
                style={{ backgroundColor: COLOR.accentBg15, color: '#9d8ff7', border: `0.5px solid ${COLOR.accentBorder20}` }}
              >
                {skill.name}
                <button type="button" onClick={() => removeSkill(skill.id)} aria-label={`Remove ${skill.name}`} className="flex items-center">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" style={{ color: COLOR.muted50 }}>
          Proficiency level
        </label>
        <div className="flex gap-2">
          {PROFICIENCY_LEVELS.map((level) => {
            const selected = state.proficiencyLevel === level
            return (
              <button
                key={level}
                type="button"
                onClick={() => onUpdate({ proficiencyLevel: level })}
                className="flex-1 rounded-full px-3 py-2 text-xs font-medium transition-colors"
                style={
                  selected
                    ? { backgroundColor: COLOR.pillActiveBg, border: `0.5px solid ${COLOR.pillActiveBorder}`, color: COLOR.accentTitle }
                    : { backgroundColor: COLOR.muted04, border: `0.5px solid ${COLOR.muted10}`, color: COLOR.muted45 }
                }
              >
                {level}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" style={{ color: COLOR.muted50 }}>
          Estimated duration
        </label>
        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-1">
            <input
              type="number"
              min={0}
              value={state.durationHours}
              onChange={(event) => onUpdate({ durationHours: Math.max(0, Math.floor(Number(event.target.value) || 0)) })}
              className="h-10 w-20 rounded-md px-3 text-sm text-white focus:outline-none"
              style={FIELD_INPUT_STYLE}
            />
            <span className="text-[11px]" style={{ color: COLOR.muted30 }}>
              hours
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <input
              type="number"
              min={0}
              max={59}
              value={state.durationMinutes}
              onChange={(event) =>
                onUpdate({ durationMinutes: Math.min(59, Math.max(0, Math.floor(Number(event.target.value) || 0))) })
              }
              className="h-10 w-20 rounded-md px-3 text-sm text-white focus:outline-none"
              style={FIELD_INPUT_STYLE}
            />
            <span className="text-[11px]" style={{ color: COLOR.muted30 }}>
              minutes
            </span>
          </div>
        </div>
        <p className="text-[11px]" style={{ color: COLOR.muted30 }}>
          Will be calculated automatically as you add nodes
        </p>
      </div>
    </div>
  )
}
