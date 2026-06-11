'use client'

import { useEffect, useState } from 'react'
import type { LessonBookmark, LessonNote } from '@/components/lesson/types'

interface NotesStorage {
  notes: LessonNote[]
  bookmarks: LessonBookmark[]
}

const EMPTY_STORAGE: NotesStorage = { notes: [], bookmarks: [] }

function storageKey(pathId: string, nodeIndex: number, itemIndex: number): string {
  return `notes_path_${pathId}_node_${nodeIndex}_item_${itemIndex}`
}

function readStorage(key: string): NotesStorage {
  const raw = localStorage.getItem(key)
  if (!raw) return EMPTY_STORAGE
  try {
    return { ...EMPTY_STORAGE, ...(JSON.parse(raw) as Partial<NotesStorage>) }
  } catch {
    return EMPTY_STORAGE
  }
}

/**
 * Notes and bookmarks for one content item within a path node, persisted to
 * `localStorage` under `notes_path_[pathId]_node_[nodeIndex]_item_[itemIndex]`.
 * Mirrors `useLessonNotes` (components/lesson/useLessonNotes.ts) — local-only
 * for now, server sync is a later release.
 */
export function useNodeItemNotes(pathId: string, nodeIndex: number, itemIndex: number) {
  const key = storageKey(pathId, nodeIndex, itemIndex)
  const [data, setData] = useState<NotesStorage>(EMPTY_STORAGE)

  useEffect(() => {
    setData(readStorage(key))
  }, [key])

  function persist(next: NotesStorage) {
    setData(next)
    localStorage.setItem(key, JSON.stringify(next))
  }

  function addNote(text: string, anchor: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    const note: LessonNote = { id: crypto.randomUUID(), text: trimmed, anchor, createdAt: new Date().toISOString() }
    persist({ ...data, notes: [...data.notes, note] })
  }

  function removeNote(id: string) {
    persist({ ...data, notes: data.notes.filter((note) => note.id !== id) })
  }

  function isBookmarked(anchor: string): boolean {
    return data.bookmarks.some((bookmark) => bookmark.anchor === anchor)
  }

  function toggleBookmark(label: string, anchor: string) {
    const existing = data.bookmarks.find((bookmark) => bookmark.anchor === anchor)
    if (existing) {
      persist({ ...data, bookmarks: data.bookmarks.filter((bookmark) => bookmark.id !== existing.id) })
    } else {
      const bookmark: LessonBookmark = { id: crypto.randomUUID(), label, anchor }
      persist({ ...data, bookmarks: [...data.bookmarks, bookmark] })
    }
  }

  function removeBookmark(id: string) {
    persist({ ...data, bookmarks: data.bookmarks.filter((bookmark) => bookmark.id !== id) })
  }

  return {
    notes: data.notes,
    bookmarks: data.bookmarks,
    addNote,
    removeNote,
    isBookmarked,
    toggleBookmark,
    removeBookmark,
  }
}
