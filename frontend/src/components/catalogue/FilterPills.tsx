'use client'

import { type ReactNode } from 'react'
import { CATALOGUE_COLORS as COLOR } from './colors'

export type ContentTypeFilter = 'all' | 'video' | 'pdf' | 'article' | 'scorm'
export type ProficiencyFilter = 'Beginner' | 'Intermediate' | 'Advanced'

const CONTENT_TYPE_OPTIONS: { value: ContentTypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'video', label: 'Video' },
  { value: 'pdf', label: 'PDF' },
  { value: 'article', label: 'Article' },
  { value: 'scorm', label: 'SCORM' },
]

const PROFICIENCY_OPTIONS: ProficiencyFilter[] = ['Beginner', 'Intermediate', 'Advanced']

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 whitespace-nowrap rounded-full px-3.5 py-[5px] text-xs font-medium transition-colors"
      style={
        active
          ? { backgroundColor: COLOR.pillActiveBg, border: `0.5px solid ${COLOR.pillActiveBorder}`, color: COLOR.accentTitle }
          : { backgroundColor: COLOR.muted04, border: `0.5px solid ${COLOR.muted10}`, color: COLOR.muted45 }
      }
    >
      {children}
    </button>
  )
}

export interface FilterPillsProps {
  contentType: ContentTypeFilter
  onContentTypeChange: (value: ContentTypeFilter) => void
  proficiency: ProficiencyFilter | null
  onProficiencyChange: (value: ProficiencyFilter | null) => void
}

export function FilterPills({ contentType, onContentTypeChange, proficiency, onProficiencyChange }: FilterPillsProps) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      {CONTENT_TYPE_OPTIONS.map((option) => (
        <Pill key={option.value} active={contentType === option.value} onClick={() => onContentTypeChange(option.value)}>
          {option.label}
        </Pill>
      ))}

      <div className="mx-1 h-4 w-px shrink-0" style={{ backgroundColor: COLOR.muted10 }} />

      {PROFICIENCY_OPTIONS.map((level) => (
        <Pill
          key={level}
          active={proficiency === level}
          onClick={() => onProficiencyChange(proficiency === level ? null : level)}
        >
          {level}
        </Pill>
      ))}
    </div>
  )
}
