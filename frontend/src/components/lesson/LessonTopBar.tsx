'use client'

import Link from 'next/link'
import { ArrowLeft, Bookmark, ChevronRight, Menu, Settings, StickyNote } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'
import { LESSON_COLORS as COLOR } from './colors'

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

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

export interface LessonTopBarProps {
  assetId: string
  courseTitle: string
  lessonTitle: string
  lessonNumber: number | null
  totalLessons: number | null
  isBookmarked: boolean
  onToggleBookmark: () => void
  onOpenNotes: () => void
  onOpenOutline: () => void
  showPlaybackSettings: boolean
  playbackRate: number
  onPlaybackRateChange: (rate: number) => void
}

export function LessonTopBar({
  assetId,
  courseTitle,
  lessonTitle,
  lessonNumber,
  totalLessons,
  isBookmarked,
  onToggleBookmark,
  onOpenNotes,
  onOpenOutline,
  showPlaybackSettings,
  playbackRate,
  onPlaybackRateChange,
}: LessonTopBarProps) {
  return (
    <div
      className="flex h-12 shrink-0 items-center justify-between px-5"
      style={{ backgroundColor: COLOR.chrome, borderBottom: `0.5px solid ${COLOR.border07}` }}
    >
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          aria-label="Toggle course outline"
          onClick={onOpenOutline}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md lg:hidden"
          style={{ color: COLOR.muted35 }}
        >
          <Menu className="h-4 w-4" />
        </button>

        <Link
          href={`/learn/${assetId}`}
          aria-label="Back to course"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
          style={{ color: COLOR.muted35 }}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 px-3 text-[12px]" style={{ color: COLOR.muted35 }}>
        <span className="truncate">{courseTitle}</span>
        <ChevronRight className="h-3 w-3 shrink-0" />
        <span className="truncate" style={{ color: COLOR.muted60 }}>
          {lessonTitle}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {lessonNumber != null && totalLessons != null && (
          <span
            className="mr-1 hidden whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium sm:inline-flex"
            style={{ color: COLOR.accentTitle, backgroundColor: COLOR.accentBg15, border: `0.5px solid ${COLOR.accentBorder35}` }}
          >
            Lesson {lessonNumber} of {totalLessons}
          </span>
        )}

        <IconButton label="Bookmark this section" active={isBookmarked} onClick={onToggleBookmark}>
          <Bookmark className={cn('h-4 w-4', isBookmarked && 'fill-current')} />
        </IconButton>

        <IconButton label="Notes" onClick={onOpenNotes}>
          <StickyNote className="h-4 w-4" />
        </IconButton>

        {showPlaybackSettings && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                aria-label="Playback settings"
                className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                style={{ color: COLOR.muted35 }}
              >
                <Settings className="h-4 w-4" />
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={8}
                className="z-20 min-w-32 rounded-md p-1"
                style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.border07}` }}
              >
                <div className="px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide" style={{ color: COLOR.muted35 }}>
                  Playback speed
                </div>
                {PLAYBACK_RATES.map((rate) => (
                  <DropdownMenu.Item
                    key={rate}
                    onSelect={() => onPlaybackRateChange(rate)}
                    className="flex cursor-pointer items-center justify-between rounded-sm px-2.5 py-1.5 text-[12px] outline-none transition-colors"
                    style={{ color: rate === playbackRate ? COLOR.accentTitle : COLOR.muted60 }}
                  >
                    {rate}x
                    {rate === playbackRate && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: COLOR.accent }} />}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>
    </div>
  )
}
