'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, Layers, Play, Route, Search, X, type LucideIcon } from 'lucide-react'
import { api } from '@/lib/api'
import { useDebounce } from '@/lib/useDebounce'
import type { CatalogSearchResponse } from '@/components/catalogue/types'
import { TEAM_COLORS as COLOR } from './colors'
import { SYSTEM_DESIGN_CONTENT, type AssignableContent } from './types'

const CONTENT_TYPE_LABELS: Record<string, string> = {
  video: 'Video',
  article: 'Article',
  scorm: 'SCORM',
  pdf: 'PDF',
  learning_path: 'Learning path',
}

function formatContentTypeLabel(contentType: string): string {
  return CONTENT_TYPE_LABELS[contentType] ?? contentType.charAt(0).toUpperCase() + contentType.slice(1)
}

// Mirrors the catalogue's formatDuration (components/catalogue/CourseCard.tsx).
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`
}

function formatMeta(content: Pick<AssignableContent, 'content_type' | 'duration_minutes'>): string {
  const label = formatContentTypeLabel(content.content_type)
  return content.duration_minutes != null ? `${label} · ${formatDuration(content.duration_minutes)}` : label
}

const CONTENT_ICON_META: Record<string, { icon: LucideIcon; bg: string; color: string }> = {
  video: { icon: Play, bg: COLOR.accentBg15, color: COLOR.accentText },
  article: { icon: FileText, bg: COLOR.muted06, color: COLOR.muted40 },
  scorm: { icon: Layers, bg: COLOR.greenBg10, color: COLOR.green },
  learning_path: { icon: Route, bg: COLOR.accentBg15, color: COLOR.accentText },
}

function ContentTypeIcon({ contentType }: { contentType: string }) {
  const meta = CONTENT_ICON_META[contentType] ?? CONTENT_ICON_META.article
  const Icon = meta.icon
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: meta.bg, color: meta.color }}>
      <Icon className="h-3.5 w-3.5" />
    </div>
  )
}

async function fetchCatalogSearch(query: string): Promise<CatalogSearchResponse> {
  const { data } = await api.get<CatalogSearchResponse>('/catalog/search', { params: { q: query } })
  return data
}

export interface ContentSearchFieldProps {
  selected: AssignableContent | null
  onSelect: (content: AssignableContent | null) => void
}

export function ContentSearchField({ selected, onSelect }: ContentSearchFieldProps) {
  const [query, setQuery] = useState('')
  const trimmedQuery = useDebounce(query, 300).trim()

  const searchQuery = useQuery({
    queryKey: ['catalog-search-assign', trimmedQuery],
    queryFn: () => fetchCatalogSearch(trimmedQuery),
    enabled: trimmedQuery !== '',
  })

  const results: AssignableContent[] = (searchQuery.data?.results ?? []).map((asset) => ({
    id: asset.id,
    title: asset.title,
    content_type: asset.contentType,
    duration_minutes: asset.durationMinutes,
    type: 'asset',
  }))

  const showDropdown = query.trim() !== ''

  function handleSelect(content: AssignableContent) {
    onSelect(content)
    setQuery('')
  }

  return (
    <div>
      <label className="mb-2 block text-[12px]" style={{ color: COLOR.muted50 }}>
        What to assign
      </label>

      {selected ? (
        <div
          className="flex items-center gap-2.5 rounded-[8px] px-3 py-2.5"
          style={{ backgroundColor: COLOR.accentBg06, border: `0.5px solid ${COLOR.accentBorder20}` }}
        >
          <ContentTypeIcon contentType={selected.content_type} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px]" style={{ color: COLOR.title }}>
              {selected.title}
            </div>
            <div className="text-[11px]" style={{ color: COLOR.muted30 }}>
              {formatMeta(selected)}
            </div>
          </div>
          <button type="button" onClick={() => onSelect(null)} aria-label="Remove selected content" style={{ color: COLOR.muted30 }}>
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <div
            className="flex items-center gap-2.5 rounded-[7px] px-3 py-2"
            style={{ backgroundColor: COLOR.inputBg, border: `0.5px solid ${COLOR.inputBorder}` }}
          >
            <Search className="h-3.5 w-3.5 shrink-0" style={{ color: COLOR.muted30 }} />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search courses and learning paths..."
              className="w-full bg-transparent text-[13px] outline-none"
              style={{ color: COLOR.title }}
            />
          </div>

          {showDropdown && (
            <div
              className="absolute z-10 mt-1 max-h-[200px] w-full overflow-y-auto rounded-[7px]"
              style={{ backgroundColor: COLOR.inputBg, border: `0.5px solid ${COLOR.inputBorder}` }}
            >
              <ContentResultRow content={SYSTEM_DESIGN_CONTENT} onSelect={handleSelect} />
              {results.map((content) => (
                <ContentResultRow key={content.id} content={content} onSelect={handleSelect} />
              ))}
              {searchQuery.isFetching && (
                <div className="px-3 py-2 text-[12px]" style={{ color: COLOR.muted30 }}>
                  Searching…
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ContentResultRow({ content, onSelect }: { content: AssignableContent; onSelect: (content: AssignableContent) => void }) {
  return (
    <div
      onClick={() => onSelect(content)}
      className="flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors hover:bg-[rgba(255,255,255,0.04)]"
    >
      <ContentTypeIcon contentType={content.content_type} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]" style={{ color: COLOR.title }}>
          {content.title}
        </div>
        <div className="text-[11px]" style={{ color: COLOR.muted30 }}>
          {formatMeta(content)}
        </div>
      </div>
      <span className="shrink-0 text-[11px]" style={{ color: COLOR.accentMuted }}>
        Select
      </span>
    </div>
  )
}
