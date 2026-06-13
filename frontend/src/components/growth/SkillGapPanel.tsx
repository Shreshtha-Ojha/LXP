'use client'

import { useState } from 'react'
import Link from 'next/link'
import { SkillChip } from '@/components/ui/SkillChip'
import { GROWTH_COLORS as COLOR } from './colors'
import { LevelDots } from './LevelDots'
import { formatContentTypeLabel, formatDuration, getContentTypeIcon, getLevelOrder } from './utils'
import type { ApiProficiencyLevel, GapAnalysisResponse, SkillGap } from './types'

function GapRow({ gap, isLast, knownLevels }: { gap: SkillGap; isLast: boolean; knownLevels: ApiProficiencyLevel[] }) {
  const [expanded, setExpanded] = useState(false)
  const filledLevels = getLevelOrder(gap.current_level, knownLevels)
  const recommended = gap.recommended_content.slice(0, 3)

  return (
    <div className="py-3" style={isLast ? undefined : { borderBottom: `0.5px solid ${COLOR.hairline}` }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium" style={{ color: COLOR.pageTitle }}>
            {gap.skill_name}
          </div>
          <div className="mt-0.5 text-[12px]" style={{ color: COLOR.muted35 }}>
            Currently: {gap.current_level ?? 'Not started'} → Required: {gap.required_level}
          </div>
        </div>

        <LevelDots filled={filledLevels} />

        <Link
          href={`/learn?skill=${encodeURIComponent(gap.skill_name)}`}
          className="text-[12px] font-medium"
          style={{ color: COLOR.accent }}
        >
          Close this gap
        </Link>
      </div>

      {recommended.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="text-[12px]"
            style={{ color: COLOR.muted35 }}
          >
            {expanded ? '▾' : '▸'} {recommended.length} course{recommended.length === 1 ? '' : 's'} to close this gap
          </button>

          {expanded && (
            <div className="mt-1 flex flex-col gap-1">
              {recommended.map((item) => {
                const Icon = getContentTypeIcon(item.content_type)
                return (
                  <Link
                    key={item.id}
                    href={`/learn/${item.id}`}
                    className="flex items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-[12px] transition-colors hover:bg-[rgba(255,255,255,0.04)]"
                    style={{ backgroundColor: COLOR.muted02, color: COLOR.muted45 }}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: COLOR.muted30 }} />
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    <span className="shrink-0 text-[11px]" style={{ color: COLOR.muted30 }}>
                      {formatContentTypeLabel(item.content_type)}
                      {item.duration_minutes != null ? ` · ${formatDuration(item.duration_minutes)}` : ''}
                    </span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export interface SkillGapPanelProps {
  data: GapAnalysisResponse
  knownLevels: ApiProficiencyLevel[]
}

export function SkillGapPanel({ data, knownLevels }: SkillGapPanelProps) {
  if (data.gaps.length === 0) return null

  return (
    <div className="rounded-[10px] p-5" style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.cardBorder}` }}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-medium" style={{ color: COLOR.pageTitle }}>
          Skill gaps — toward {data.target_role ?? 'your role'}
        </h2>
        <span
          className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium"
          style={{ color: COLOR.accentTitle, backgroundColor: COLOR.accentBg15, border: `0.5px solid ${COLOR.accentBorder35}` }}
        >
          {data.readiness_pct}% ready
        </span>
      </div>

      <div className="mt-1">
        {data.gaps.map((gap, index) => (
          <GapRow key={gap.skill_name} gap={gap} isLast={index === data.gaps.length - 1} knownLevels={knownLevels} />
        ))}
      </div>

      {data.met.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-[12px]" style={{ color: COLOR.muted35 }}>
            Requirements you&apos;ve met
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.met.map((req) => (
              <SkillChip key={req.skill_name} status="validated">
                {req.skill_name}
              </SkillChip>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
