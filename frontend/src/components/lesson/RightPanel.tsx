'use client'

import { useEffect, useRef, useState } from 'react'
import { Bookmark, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { LESSON_COLORS as COLOR } from './colors'
import type { LessonBookmark, LessonNote } from './types'

export interface TocHeading {
  id: string
  text: string
}

function scrollToHeading(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export interface RightPanelProps {
  headings: TocHeading[]
  /** Heading currently in view, from the page-level scrollspy — see useActiveHeadingId in page.tsx. */
  activeHeadingId: string | null
  notes: LessonNote[]
  onAddNote: (text: string) => void
  onRemoveNote: (id: string) => void
  bookmarks: LessonBookmark[]
  onSelectBookmark: (bookmark: LessonBookmark) => void
  onRemoveBookmark: (id: string) => void
  className?: string
}

export function RightPanel({
  headings,
  activeHeadingId,
  notes,
  onAddNote,
  onRemoveNote,
  bookmarks,
  onSelectBookmark,
  onRemoveBookmark,
  className,
}: RightPanelProps) {
  const [isAddingNote, setIsAddingNote] = useState(false)
  const [draftNote, setDraftNote] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isAddingNote) textareaRef.current?.focus()
  }, [isAddingNote])

  function submitNote() {
    if (draftNote.trim()) onAddNote(draftNote)
    setDraftNote('')
    setIsAddingNote(false)
  }

  return (
    <aside className={cn('flex flex-col gap-6 overflow-y-auto p-5', className)} style={{ borderLeft: `0.5px solid ${COLOR.border05}` }}>
      {/* Table of contents */}
      {headings.length > 0 && (
        <section>
          <h3 className="text-[10px] font-medium uppercase tracking-wide" style={{ color: COLOR.muted35 }}>
            On this page
          </h3>
          <nav className="mt-2 flex flex-col gap-0.5">
            {headings.map((heading) => (
              <button
                key={heading.id}
                type="button"
                onClick={() => scrollToHeading(heading.id)}
                className={cn(
                  'truncate border-l-2 py-1 pl-2.5 text-left text-[12px] transition-colors',
                  heading.id === activeHeadingId
                    ? 'border-accent text-[#9d8ff7]'
                    : 'border-transparent text-[rgba(255,255,255,0.3)] hover:text-[rgba(255,255,255,0.5)]'
                )}
              >
                {heading.text}
              </button>
            ))}
          </nav>
        </section>
      )}

      {/* Notes */}
      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-[12px] font-medium text-fg">My notes</h3>
          {!isAddingNote && (
            <button type="button" onClick={() => setIsAddingNote(true)} className="text-[12px] text-accent transition-colors hover:text-accent-hover">
              + Add note
            </button>
          )}
        </div>

        <div className="mt-2.5 flex flex-col gap-2">
          {notes.map((note) => (
            <div key={note.id} className="group relative rounded-[7px] px-3 py-2.5" style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.border07}` }}>
              <button
                type="button"
                aria-label="Delete note"
                onClick={() => onRemoveNote(note.id)}
                className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover:opacity-100"
                style={{ color: COLOR.muted35 }}
              >
                <X className="h-3 w-3" />
              </button>
              <div className="text-[10px]" style={{ color: COLOR.accentText50 }}>
                {note.anchor}
              </div>
              <p className="mt-1 pr-3 text-[12px]" style={{ color: COLOR.muted45, lineHeight: 1.5 }}>
                {note.text}
              </p>
            </div>
          ))}

          {isAddingNote && (
            <div className="rounded-[7px] px-3 py-2.5" style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.border07}` }}>
              <textarea
                ref={textareaRef}
                value={draftNote}
                onChange={(event) => setDraftNote(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    submitNote()
                  }
                  if (event.key === 'Escape') {
                    setDraftNote('')
                    setIsAddingNote(false)
                  }
                }}
                placeholder="Write a note..."
                rows={3}
                className="w-full resize-none bg-transparent text-[12px] outline-none placeholder:text-[rgba(255,255,255,0.2)]"
                style={{ color: COLOR.muted60, lineHeight: 1.5 }}
              />
              <div className="mt-1.5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDraftNote('')
                    setIsAddingNote(false)
                  }}
                  className="text-[11px] transition-colors"
                  style={{ color: COLOR.muted35 }}
                >
                  Cancel
                </button>
                <Button size="sm" className="h-6 px-2 text-[11px]" onClick={submitNote}>
                  Save
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Bookmarks */}
      <section>
        <h3 className="text-[12px] font-medium text-fg">Bookmarks</h3>

        {bookmarks.length === 0 ? (
          <p className="mt-2 text-[12px]" style={{ color: COLOR.muted35 }}>
            No bookmarks yet
          </p>
        ) : (
          <div className="mt-2 flex flex-col gap-1">
            {bookmarks.map((bookmark) => (
              <div key={bookmark.id} className="group flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSelectBookmark(bookmark)}
                  className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-[12px] transition-colors"
                  style={{ color: COLOR.muted35 }}
                >
                  <Bookmark className="h-3 w-3 shrink-0 fill-current" style={{ color: COLOR.accent }} />
                  <span className="truncate">{bookmark.label}</span>
                </button>
                <button
                  type="button"
                  aria-label="Remove bookmark"
                  onClick={() => onRemoveBookmark(bookmark.id)}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ color: COLOR.muted35 }}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="flex items-center gap-1.5 text-[11px]" style={{ color: COLOR.muted20 }}>
        <Plus className="h-3 w-3" />
        Notes are saved on this device only
      </div>
    </aside>
  )
}
