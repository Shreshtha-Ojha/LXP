'use client'

import { useMemo, useState, type ReactNode } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { MoreVertical, Search } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { GROWTH_COLORS as COLOR } from './colors'
import { STATUS_LABEL, STATUS_PILL_TONE } from './utils'
import type { InventoryFilter, SkillInventoryItem } from './types'

export type SkillRowAction = 'update_level' | 'add_evidence' | 'request_validation'

const FILTER_OPTIONS: { value: InventoryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'validated', label: 'Validated' },
  { value: 'pending', label: 'Pending' },
  { value: 'gaps', label: 'Gaps only' },
]

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 whitespace-nowrap rounded-full px-3.5 py-[5px] text-xs font-medium transition-colors"
      style={
        active
          ? { backgroundColor: COLOR.accentBg15, border: `0.5px solid ${COLOR.accentBorder35}`, color: COLOR.accentTitle }
          : { backgroundColor: COLOR.muted04, border: `0.5px solid ${COLOR.muted10}`, color: COLOR.muted45 }
      }
    >
      {children}
    </button>
  )
}

function LevelPill({ skill }: { skill: SkillInventoryItem }) {
  const tone = STATUS_PILL_TONE[skill.status]
  const levelName = skill.current_level?.name ?? 'Not set'
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap"
      style={{ color: tone.color, backgroundColor: tone.background, border: `0.5px solid ${tone.border}` }}
    >
      {levelName} · {STATUS_LABEL[skill.status]}
    </span>
  )
}

function RequirementInfo({ skill }: { skill: SkillInventoryItem }) {
  if (!skill.required_level) {
    return <span className="text-[11px]" style={{ color: COLOR.muted20 }}>No requirement for role</span>
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <span className="text-[11px]" style={{ color: COLOR.muted30 }}>
        Required: {skill.required_level.name}
      </span>
      {skill.has_gap ? (
        <span
          className="rounded-[4px] px-2 py-0.5 text-[11px]"
          style={{ color: COLOR.red, backgroundColor: COLOR.redBg08, border: `0.5px solid ${COLOR.redBorder20}` }}
        >
          ↑ {skill.gap_levels} level{skill.gap_levels === 1 ? '' : 's'} needed
        </span>
      ) : (
        <span
          className="rounded-[4px] px-2 py-0.5 text-[11px]"
          style={{ color: COLOR.green, backgroundColor: COLOR.greenBg08, border: `0.5px solid ${COLOR.greenBorder20}` }}
        >
          ✓ Requirement met
        </span>
      )}
    </div>
  )
}

function RowMenu({ skill, onAction }: { skill: SkillInventoryItem; onAction: (action: SkillRowAction, skill: SkillInventoryItem) => void }) {
  const itemClass =
    'flex w-full cursor-pointer items-center rounded-sm px-2.5 py-1.5 text-left text-[12px] outline-none transition-colors hover:bg-[rgba(255,255,255,0.04)]'

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${skill.skill_name}`}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[rgba(255,255,255,0.04)]"
          style={{ color: COLOR.muted20 }}
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-20 min-w-40 rounded-md p-1"
          style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.inputBorder}` }}
        >
          <DropdownMenu.Item className={itemClass} style={{ color: COLOR.muted45 }} onSelect={() => onAction('update_level', skill)}>
            Update level
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemClass} style={{ color: COLOR.muted45 }} onSelect={() => onAction('add_evidence', skill)}>
            Add evidence
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemClass} style={{ color: COLOR.muted45 }} onSelect={() => onAction('request_validation', skill)}>
            Request validation
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function SkillRow({ skill, isLast, onAction }: { skill: SkillInventoryItem; isLast: boolean; onAction: (action: SkillRowAction, skill: SkillInventoryItem) => void }) {
  return (
    <div className="flex items-center gap-3 py-2.5" style={isLast ? undefined : { borderBottom: `0.5px solid ${COLOR.hairline}` }}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium" style={{ color: COLOR.pageTitle }}>
          {skill.skill_name}
        </div>
        {skill.category && (
          <div className="mt-0.5 truncate text-[11px]" style={{ color: COLOR.muted30 }}>
            {skill.category}
          </div>
        )}
      </div>

      <div className="flex w-[120px] shrink-0 justify-start">
        <LevelPill skill={skill} />
      </div>

      <div className="w-[140px] shrink-0">
        <RequirementInfo skill={skill} />
      </div>

      <div className="w-8 shrink-0">
        <RowMenu skill={skill} onAction={onAction} />
      </div>
    </div>
  )
}

function SkillRowSkeleton({ isLast }: { isLast: boolean }) {
  return (
    <div className="flex items-center gap-3 py-2.5" style={isLast ? undefined : { borderBottom: `0.5px solid ${COLOR.hairline}` }}>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-3 w-32 animate-pulse rounded" style={{ backgroundColor: COLOR.muted07 }} />
        <div className="h-2.5 w-20 animate-pulse rounded" style={{ backgroundColor: COLOR.muted05 }} />
      </div>
      <div className="h-5 w-[120px] shrink-0 animate-pulse rounded-full" style={{ backgroundColor: COLOR.muted07 }} />
      <div className="h-5 w-[140px] shrink-0 animate-pulse rounded" style={{ backgroundColor: COLOR.muted05 }} />
      <div className="h-8 w-8 shrink-0" />
    </div>
  )
}

export interface SkillInventoryPanelProps {
  skills: SkillInventoryItem[]
  isLoading: boolean
  onRowAction: (action: SkillRowAction, skill: SkillInventoryItem) => void
  onDeclareClick: () => void
}

export function SkillInventoryPanel({ skills, isLoading, onRowAction, onDeclareClick }: SkillInventoryPanelProps) {
  const [filter, setFilter] = useState<InventoryFilter>('all')
  const [search, setSearch] = useState('')

  const filteredSkills = useMemo(() => {
    let result = skills

    if (filter === 'validated') result = result.filter((skill) => skill.status === 'validated')
    else if (filter === 'pending') result = result.filter((skill) => skill.status === 'pending_validation')
    else if (filter === 'gaps') result = result.filter((skill) => skill.has_gap)

    const query = search.trim().toLowerCase()
    if (query) {
      result = result.filter(
        (skill) => skill.skill_name.toLowerCase().includes(query) || (skill.category ?? '').toLowerCase().includes(query)
      )
    }

    return result
  }, [skills, filter, search])

  return (
    <div className="rounded-[10px] p-5" style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.cardBorder}` }}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-medium" style={{ color: COLOR.pageTitle }}>
          Skill inventory
        </h2>
        <div className="flex items-center gap-2 overflow-x-auto">
          {FILTER_OPTIONS.map((option) => (
            <FilterPill key={option.value} active={filter === option.value} onClick={() => setFilter(option.value)}>
              {option.label}
            </FilterPill>
          ))}
        </div>
      </div>

      <div className="relative mt-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2" style={{ color: COLOR.muted30 }} />
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search skills..."
          className="h-9 w-full rounded-[7px] pl-9 pr-3 text-[13px] outline-none"
          style={{ backgroundColor: COLOR.muted03, border: `0.5px solid ${COLOR.muted08}`, color: COLOR.pageTitle }}
        />
      </div>

      <div className="mt-3 overflow-x-auto">
        <div className="min-w-[540px]">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, index) => <SkillRowSkeleton key={index} isLast={index === 3} />)
          ) : skills.length === 0 ? (
            <div className="py-2">
              <EmptyState
                icon={Search}
                heading="No skills declared yet"
                subtext="Start by declaring your first skill"
                cta={{ label: 'Declare a skill', onClick: onDeclareClick }}
              />
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="py-6 text-center text-[13px]" style={{ color: COLOR.muted35 }}>
              No skills match these filters
            </div>
          ) : (
            filteredSkills.map((skill, index) => (
              <SkillRow key={skill.id} skill={skill} isLast={index === filteredSkills.length - 1} onAction={onRowAction} />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
