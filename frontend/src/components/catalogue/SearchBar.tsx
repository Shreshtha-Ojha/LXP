'use client'

import { useEffect, useRef } from 'react'
import { Search } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'
import { CATALOGUE_COLORS as COLOR } from './colors'

export interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  isSearching: boolean
}

export function SearchBar({ value, onChange, isSearching }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  // Cmd/Ctrl+K focuses the search input — matches the shortcut hint shown
  // on the right of the bar.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div
      className="flex h-11 w-full items-center gap-2.5 rounded-[9px] px-3.5"
      style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.muted10}` }}
    >
      <Search className="h-4 w-4 shrink-0" style={{ color: COLOR.muted30 }} />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search courses, skills, topics..."
        className="h-full flex-1 bg-transparent text-sm text-white placeholder:text-[rgba(255,255,255,0.3)] focus:outline-none"
      />
      {isSearching ? (
        <Spinner className="h-4 w-4 shrink-0" />
      ) : (
        <span
          className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium"
          style={{ color: COLOR.muted20, border: `0.5px solid ${COLOR.muted10}` }}
        >
          ⌘K
        </span>
      )}
    </div>
  )
}
