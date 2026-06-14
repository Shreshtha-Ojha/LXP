'use client'

import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ContentNodeEditor } from './ContentNodeEditor'
import { QuizNodeEditor } from './QuizNodeEditor'
import { BUILDER_COLORS as COLOR } from './colors'
import type { BuilderNode } from './types'

export interface NodeEditorPanelProps {
  node: BuilderNode | null
  onChange: (node: BuilderNode) => void
  onClose: () => void
}

export function NodeEditorPanel({ node, onChange, onClose }: NodeEditorPanelProps) {
  return (
    <div className={cn('shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out', node ? 'w-full lg:w-80' : 'w-0')}>
      <div
        className={cn('h-full w-full transition-transform duration-200 ease-in-out lg:w-80', node ? 'translate-x-0' : 'translate-x-full')}
      >
        {node && (
          <div className="flex h-full flex-col rounded-[10px]" style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.cardBorder}` }}>
            <div className="flex items-center justify-between border-b p-4" style={{ borderColor: COLOR.muted08 }}>
              <h2 className="text-sm font-medium" style={{ color: COLOR.pageTitle }}>
                Edit node
              </h2>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[rgba(255,255,255,0.06)]"
                style={{ color: COLOR.muted35 }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {node.type === 'quiz' ? (
                <QuizNodeEditor node={node} onChange={onChange} />
              ) : (
                <ContentNodeEditor node={node} onChange={onChange} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
