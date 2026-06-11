'use client'

import { CheckCircle2, File, FileText, Play, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LESSON_COLORS as COLOR } from '@/components/lesson/colors'
import { PATH_COLORS } from '@/components/path/colors'
import type { PathNode } from '@/components/path/types'
import type { NodeContentItem, NodeItemType } from './types'

const ITEM_ICONS: Record<NodeItemType, LucideIcon> = {
  video: Play,
  article: FileText,
  pdf: File,
}

const ITEM_ICON_COLORS: Record<NodeItemType, string> = {
  video: COLOR.accent,
  article: COLOR.muted35,
  pdf: COLOR.muted35,
}

function ItemIcon({ type }: { type: NodeItemType }) {
  const Icon = ITEM_ICONS[type]
  return (
    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: COLOR.muted07 }}>
      <Icon className="h-2 w-2" style={{ color: ITEM_ICON_COLORS[type] }} />
    </span>
  )
}

export interface NodeItemSidebarProps {
  node: PathNode
  totalNodes: number
  items: NodeContentItem[]
  currentItemIndex: number
  completedItems: Set<number>
  onSelectItem: (index: number) => void
  className?: string
}

export function NodeItemSidebar({
  node,
  totalNodes,
  items,
  currentItemIndex,
  completedItems,
  onSelectItem,
  className,
}: NodeItemSidebarProps) {
  return (
    <aside className={cn('w-[200px] shrink-0 overflow-y-auto py-5', className)} style={{ backgroundColor: COLOR.chrome, borderRight: `0.5px solid ${COLOR.border05}` }}>
      <div className="px-4 pb-4">
        <div className="text-[13px] font-medium" style={{ color: COLOR.pageTitle }}>
          {node.title}
        </div>
        <span
          className="mt-2 inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium"
          style={{ color: COLOR.accentTitle, backgroundColor: COLOR.accentBg15, border: `0.5px solid ${COLOR.accentBorder35}` }}
        >
          Node {node.index} of {totalNodes}
        </span>
      </div>

      <div className="flex flex-col">
        {items.map((item, index) => {
          const isCompleted = completedItems.has(index)
          const isActive = index === currentItemIndex
          const titleColor = isCompleted ? COLOR.greenText60 : isActive ? COLOR.accentTitle : COLOR.muted30

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectItem(index)}
              className="flex items-center gap-2.5 px-4 py-2 text-left transition-colors"
              style={{
                borderLeft: isActive ? `2px solid ${COLOR.accent}` : '2px solid transparent',
                backgroundColor: isActive ? COLOR.accentBg06 : 'transparent',
              }}
            >
              <ItemIcon type={item.type} />
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="truncate text-[12px]" style={{ color: titleColor }}>
                  {item.title}
                </span>
                {isCompleted && <CheckCircle2 className="h-3 w-3 shrink-0" style={{ color: COLOR.green }} />}
              </span>
              <span className="shrink-0 text-[11px]" style={{ color: COLOR.muted20 }}>
                {item.duration}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-4 px-4 pt-4" style={{ borderTop: `0.5px solid ${COLOR.border07}` }}>
        <div className="text-[10px] font-medium uppercase tracking-wide" style={{ color: COLOR.muted20 }}>
          Complete all to earn
        </div>
        <div className="mt-1.5 text-[14px] font-medium" style={{ color: PATH_COLORS.amber }}>
          💰 +{node.coins} coins
        </div>
      </div>
    </aside>
  )
}
