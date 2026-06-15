'use client'

import { AlertTriangle, Check, Globe, Send, X } from 'lucide-react'
import { useCanPublish } from '@/hooks/useCanPublish'
import { HEXAGON_CLIP_PATH } from '@/components/path/PathNode'
import { BUILDER_COLORS as COLOR } from './colors'
import { displayTitle, getNodeHexagonAppearance } from './NodeList'
import {
  PATH_TYPES,
  formatDuration,
  getReviewChecks,
  totalCoins,
  totalDurationMinutes,
  type PathBuilderState,
} from './types'

interface SummaryRowProps {
  label: string
  value: string
}

function SummaryRow({ label, value }: SummaryRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-2" style={{ borderBottom: `0.5px solid ${COLOR.muted05}` }}>
      <span className="text-xs" style={{ color: COLOR.muted35 }}>
        {label}
      </span>
      <span className="text-right text-sm" style={{ color: COLOR.pageTitle }}>
        {value}
      </span>
    </div>
  )
}

export interface Step3ReviewProps {
  state: PathBuilderState
  onPublish: () => void
  onSubmitForReview: () => void
  onSaveDraft: () => void
}

export function Step3Review({ state, onPublish, onSubmitForReview, onSaveDraft }: Step3ReviewProps) {
  const { canPublish } = useCanPublish()
  const checks = getReviewChecks(state)
  const requiredChecksMet = checks.filter((check) => !check.isWarning).every((check) => check.met)

  const duration = totalDurationMinutes(state.nodes) || state.durationHours * 60 + state.durationMinutes
  const coins = totalCoins(state.nodes)
  const pathTypeLabel = PATH_TYPES.find((type) => type.value === state.pathType)?.label ?? 'Not set'

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium" style={{ color: COLOR.pageTitle }}>
          Path preview
        </h2>
        <div className="overflow-x-auto rounded-[10px] p-4" style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.cardBorder}` }}>
          {state.nodes.length === 0 ? (
            <p className="text-center text-[11px]" style={{ color: COLOR.muted35 }}>
              No nodes added yet
            </p>
          ) : (
            <div className="flex gap-4">
              {state.nodes.map((node, index) => {
                const isFinal = index === state.nodes.length - 1 && node.type === 'quiz'
                const { Icon, background } = getNodeHexagonAppearance(node, isFinal)
                return (
                  <div key={node.id} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
                    <div className="flex h-12 w-12 items-center justify-center" style={{ clipPath: HEXAGON_CLIP_PATH, backgroundColor: background }}>
                      <Icon className="h-5 w-5 text-white" />
                    </div>
                    <span className="w-full truncate text-center text-[10px]" style={{ color: COLOR.muted35 }}>
                      {displayTitle(node)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium" style={{ color: COLOR.pageTitle }}>
          Path summary
        </h2>
        <div className="rounded-[10px] px-4" style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.cardBorder}` }}>
          <SummaryRow label="Title" value={state.title.trim() || 'Untitled path'} />
          <SummaryRow label="Path type" value={pathTypeLabel} />
          <SummaryRow label="Proficiency level" value={state.proficiencyLevel ?? 'Not set'} />
          <SummaryRow label="Target skills" value={state.skills.length > 0 ? state.skills.map((skill) => skill.name).join(', ') : 'None'} />
          <SummaryRow label="Nodes" value={`${state.nodes.length} node${state.nodes.length === 1 ? '' : 's'}`} />
          <SummaryRow label="Estimated duration" value={formatDuration(duration)} />
          <SummaryRow label="Total coins" value={`💰 ${coins}`} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium" style={{ color: COLOR.pageTitle }}>
          Before publishing
        </h2>
        <div className="flex flex-col gap-2 rounded-[10px] p-4" style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.cardBorder}` }}>
          {checks.map((check) => {
            const Icon = check.met ? Check : check.isWarning ? AlertTriangle : X
            const color = check.met ? COLOR.green : check.isWarning ? COLOR.amber : COLOR.red
            return (
              <div key={check.label} className="flex items-center gap-2.5">
                <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
                <span className="text-xs" style={{ color: check.met ? COLOR.muted45 : COLOR.pageTitle }}>
                  {check.label}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {!canPublish && (
          <div
            className="mb-3"
            style={{
              backgroundColor: 'rgba(124,106,247,0.06)',
              borderLeft: '3px solid rgba(124,106,247,0.3)',
              borderRadius: '6px',
              padding: '10px 12px',
            }}
          >
            <p className="text-[13px]" style={{ color: 'rgba(196,187,251,0.7)' }}>
              💡 Only L&D Admins can publish paths directly. Your path will be reviewed before going live.
            </p>
          </div>
        )}

        {canPublish ? (
          <button
            type="button"
            onClick={onPublish}
            disabled={!requiredChecksMet}
            className="flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
            style={{ backgroundColor: COLOR.accent, color: '#ffffff' }}
          >
            <Globe className="h-4 w-4" />
            Publish now
          </button>
        ) : (
          <button
            type="button"
            onClick={onSubmitForReview}
            disabled={!requiredChecksMet}
            className="flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
            style={{ backgroundColor: COLOR.accent, color: '#ffffff' }}
          >
            <Send className="h-4 w-4" />
            Submit for review
          </button>
        )}

        <p className="text-center text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
          {canPublish ? 'Learners can find this path immediately' : 'An L&D admin will review and publish your path'}
        </p>

        <button
          type="button"
          onClick={onSaveDraft}
          className="w-full rounded-md px-4 py-2.5 text-sm font-medium transition-colors"
          style={{ color: COLOR.muted45, backgroundColor: COLOR.muted04, border: `0.5px solid ${COLOR.muted10}` }}
        >
          Save as draft
        </button>
      </div>

      {!requiredChecksMet && (
        <p className="text-center text-[11px]" style={{ color: COLOR.muted35 }}>
          Complete the required items above before publishing
        </p>
      )}
    </div>
  )
}
