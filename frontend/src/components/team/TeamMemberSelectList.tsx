'use client'

import { Check } from 'lucide-react'
import { PIPELINE_STATUS_META, TEAM_COLORS as COLOR } from './colors'
import type { AssignTeamMember } from './types'

export interface TeamMemberSelectListProps {
  members: AssignTeamMember[]
  selectedIds: Set<string>
  onToggle: (userId: string) => void
  onToggleAll: () => void
}

export function TeamMemberSelectList({ members, selectedIds, onToggle, onToggleAll }: TeamMemberSelectListProps) {
  const allSelected = members.length > 0 && members.every((member) => selectedIds.has(member.user_id))

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <label className="text-[12px]" style={{ color: COLOR.muted50 }}>
          Who to assign to
        </label>
        <span className="cursor-pointer text-[12px]" style={{ color: COLOR.muted40 }} onClick={onToggleAll}>
          {allSelected ? 'Deselect all' : 'Select all'}
        </span>
      </div>

      <div>
        {members.map((member) => {
          const checked = selectedIds.has(member.user_id)
          const statusMeta = PIPELINE_STATUS_META[member.status]

          return (
            <div
              key={member.user_id}
              onClick={() => onToggle(member.user_id)}
              className="mb-1 flex cursor-pointer items-center gap-2.5 rounded-[7px] px-2.5 py-2 transition-colors hover:bg-[rgba(255,255,255,0.03)]"
            >
              <div
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px]"
                style={
                  checked
                    ? { backgroundColor: COLOR.accent }
                    : { backgroundColor: COLOR.muted04, border: `0.5px solid ${COLOR.muted15}` }
                }
              >
                {checked && <Check className="h-3.5 w-3.5" style={{ color: COLOR.white }} />}
              </div>

              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-medium"
                style={{ backgroundColor: member.avatar_bg, color: member.avatar_color }}
              >
                {member.initials}
              </div>

              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]" style={{ color: COLOR.title }}>
                  {member.name}
                </div>
                <div className="truncate text-[11px]" style={{ color: COLOR.muted30 }}>
                  {member.target_role}
                </div>
              </div>

              <span
                className="shrink-0 rounded text-[11px]"
                style={{ color: statusMeta.color, backgroundColor: statusMeta.bg, border: `0.5px solid ${statusMeta.border}`, padding: '2px 8px' }}
              >
                {statusMeta.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
