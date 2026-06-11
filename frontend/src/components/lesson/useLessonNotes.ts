'use client'

import { useEffect, useState } from 'react'
import type { LessonBookmark, LessonNote } from './types'

interface LessonStorage {
  notes: LessonNote[]
  bookmarks: LessonBookmark[]
}

const EMPTY_STORAGE: LessonStorage = { notes: [], bookmarks: [] }

function storageKey(userId: string, assetId: string): string {
  return `notes_${userId}_${assetId}`
}

function readStorage(userId: string, assetId: string): LessonStorage {
  const raw = localStorage.getItem(storageKey(userId, assetId))
  if (!raw) return EMPTY_STORAGE
  try {
    return { ...EMPTY_STORAGE, ...(JSON.parse(raw) as Partial<LessonStorage>) }
  } catch {
    return EMPTY_STORAGE
  }
}

/**
 * Notes and bookmarks for one lesson, persisted to `localStorage` under
 * `notes_[userId]_[assetId]`. Per the page spec this is local-only for now —
 * server sync is a later release.
 */
export function useLessonNotes(userId: string | undefined, assetId: string) {
  const [data, setData] = useState<LessonStorage>(EMPTY_STORAGE)

  useEffect(() => {
    if (!userId) return
    setData(readStorage(userId, assetId))
  }, [userId, assetId])

  function persist(next: LessonStorage) {
    setData(next)
    if (userId) localStorage.setItem(storageKey(userId, assetId), JSON.stringify(next))
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
