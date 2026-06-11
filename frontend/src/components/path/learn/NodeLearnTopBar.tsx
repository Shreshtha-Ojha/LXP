'use client'

import { ArrowLeft, Bookmark, ChevronRight, Menu, StickyNote } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LESSON_COLORS as COLOR } from '@/components/lesson/colors'

function IconButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
      style={{ color: active ? COLOR.accentTitle : COLOR.muted35 }}
      onMouseEnter={(event) => {
        event.currentTarget.style.backgroundColor = COLOR.muted07
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.backgroundColor = 'transparent'
      }}
    >
      {children}
    </button>
  )
}

export interface NodeLearnTopBarProps {
  pathTitle: string
  nodeTitle: string
  itemTitle: string
  itemNumber: number
  totalItems: number
  isBookmarked: boolean
  onBack: () => void
  onToggleBookmark: () => void
  onOpenNotes: () => void
  onOpenOutline: () => void
}

export function NodeLearnTopBar({
  pathTitle,
  nodeTitle,
  itemTitle,
  itemNumber,
  totalItems,
  isBookmarked,
  onBack,
  onToggleBookmark,
  onOpenNotes,
  onOpenOutline,
}: NodeLearnTopBarProps) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between px-5" style={{ backgroundColor: COLOR.chrome, borderBottom: `0.5px solid ${COLOR.border07}` }}>
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          aria-label="Toggle node outline"
          onClick={onOpenOutline}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md md:hidden"
          style={{ color: COLOR.muted35 }}
        >
          <Menu className="h-4 w-4" />
        </button>

        <button
          type="button"
          aria-label="Back to path"
          onClick={onBack}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
          style={{ color: COLOR.muted35 }}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 px-3 text-[12px]" style={{ color: COLOR.muted35 }}>
        <span className="truncate">{pathTitle}</span>
        <ChevronRight className="h-3 w-3 shrink-0" />
        <span className="truncate">{nodeTitle}</span>
        <ChevronRight className="h-3 w-3 shrink-0" />
        <span className="truncate" style={{ color: COLOR.muted60 }}>
          {itemTitle}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <span
          className="mr-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium"
          style={{ color: COLOR.accentTitle, backgroundColor: COLOR.accentBg15, border: `0.5px solid ${COLOR.accentBorder35}` }}
        >
          {itemNumber} of {totalItems}
        </span>

        <IconButton label="Bookmark this item" active={isBookmarked} onClick={onToggleBookmark}>
          <Bookmark className={cn('h-4 w-4', isBookmarked && 'fill-current')} />
        </IconButton>

        <IconButton label="Notes" onClick={onOpenNotes}>
          <StickyNote className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  )
}
