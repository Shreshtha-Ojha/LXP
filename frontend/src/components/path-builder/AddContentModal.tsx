'use client'

import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as Dialog from '@radix-ui/react-dialog'
import { ExternalLink, FileText, Play, Search, X } from 'lucide-react'
import { api } from '@/lib/api'
import { Spinner } from '@/components/ui/Spinner'
import { useDebounce } from '@/lib/useDebounce'
import type { CatalogSearchResponse } from '@/components/catalogue/types'
import { BUILDER_COLORS as COLOR } from './colors'
import { createId, type BuilderContentItem, type ContentItemType } from './types'

type AddContentTab = 'catalogue' | 'link' | 'article'

const TABS: { value: AddContentTab; label: string }[] = [
  { value: 'catalogue', label: 'Search catalogue' },
  { value: 'link', label: 'Paste a link' },
  { value: 'article', label: 'Write an article' },
]

const CONTENT_TYPE_ICONS: Record<string, typeof Play> = {
  video: Play,
  article: FileText,
  pdf: FileText,
  scorm: FileText,
  external_link: ExternalLink,
}

interface ParsedVideo {
  provider: 'youtube' | 'vimeo'
  thumbnailUrl: string
  title: string
}

function parseVideoUrl(url: string): ParsedVideo | null {
  const trimmed = url.trim()
  if (!trimmed) return null

  const youtubeMatch = trimmed.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/)
  if (youtubeMatch) {
    return { provider: 'youtube', thumbnailUrl: `https://img.youtube.com/vi/${youtubeMatch[1]}/mqdefault.jpg`, title: 'YouTube video' }
  }

  const vimeoMatch = trimmed.match(/vimeo\.com\/(\d+)/)
  if (vimeoMatch) {
    return { provider: 'vimeo', thumbnailUrl: `https://vumbnail.com/${vimeoMatch[1]}.jpg`, title: 'Vimeo video' }
  }

  return null
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
      style={
        active
          ? { backgroundColor: COLOR.pillActiveBg, border: `0.5px solid ${COLOR.pillActiveBorder}`, color: COLOR.accentTitle }
          : { backgroundColor: COLOR.muted04, border: `0.5px solid ${COLOR.muted10}`, color: COLOR.muted45 }
      }
    >
      {children}
    </button>
  )
}

function CatalogueSearchTab({ onAddItem }: { onAddItem: (item: BuilderContentItem) => void }) {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 300)
  const trimmedQuery = debouncedQuery.trim()

  const { data, isFetching } = useQuery({
    queryKey: ['catalog-search-builder', trimmedQuery],
    queryFn: async () => (await api.get<CatalogSearchResponse>('/catalog/search', { params: { q: trimmedQuery } })).data,
    enabled: trimmedQuery.length > 0,
  })

  const results = data?.results ?? []

  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-10 items-center gap-2.5 rounded-md px-3" style={{ backgroundColor: COLOR.inputBg, border: `0.5px solid ${COLOR.inputBorder}` }}>
        <Search className="h-4 w-4 shrink-0" style={{ color: COLOR.muted30 }} />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search videos, articles, PDFs..."
          className="h-full flex-1 bg-transparent text-sm text-white placeholder:text-[rgba(255,255,255,0.3)] focus:outline-none"
        />
        {isFetching && <Spinner className="h-4 w-4 shrink-0" />}
      </div>

      <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {trimmedQuery && !isFetching && results.length === 0 && (
          <p className="px-1 py-2 text-xs" style={{ color: COLOR.muted30 }}>
            No content found for &ldquo;{trimmedQuery}&rdquo;
          </p>
        )}

        {results.map((asset) => {
          const Icon = CONTENT_TYPE_ICONS[asset.contentType] ?? FileText
          return (
            <button
              key={asset.id}
              type="button"
              onClick={() =>
                onAddItem({
                  id: createId('item'),
                  title: asset.title,
                  type: (asset.contentType as ContentItemType) ?? 'article',
                  durationMinutes: asset.durationMinutes,
                  assetId: asset.id,
                })
              }
              className="flex items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-[rgba(255,255,255,0.04)]"
            >
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: COLOR.accentBg06 }}
              >
                <Icon className="h-3 w-3" style={{ color: COLOR.accent }} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm" style={{ color: COLOR.pageTitle }}>
                {asset.title}
              </span>
              {asset.durationMinutes != null && (
                <span className="shrink-0 text-[11px]" style={{ color: COLOR.muted35 }}>
                  {asset.durationMinutes} min
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PasteLinkTab({ onAddItem }: { onAddItem: (item: BuilderContentItem) => void }) {
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const parsed = parseVideoUrl(url)

  return (
    <div className="flex flex-col gap-3">
      <input
        type="text"
        value={url}
        onChange={(event) => {
          setUrl(event.target.value)
          const next = parseVideoUrl(event.target.value)
          setTitle(next?.title ?? '')
        }}
        placeholder="Paste a YouTube or Vimeo URL..."
        className="h-10 w-full rounded-md px-3 text-sm text-white placeholder:text-[rgba(255,255,255,0.3)] focus:outline-none"
        style={{ backgroundColor: COLOR.inputBg, border: `0.5px solid ${COLOR.inputBorder}` }}
      />

      {url.trim() && !parsed && (
        <p className="text-[11px]" style={{ color: COLOR.red }}>
          Enter a valid YouTube or Vimeo URL
        </p>
      )}

      {parsed && (
        <div className="flex flex-col gap-3 rounded-[10px] p-3" style={{ backgroundColor: COLOR.muted03, border: `0.5px solid ${COLOR.muted08}` }}>
          <div className="flex gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={parsed.thumbnailUrl} alt="" className="h-16 w-28 shrink-0 rounded-md object-cover" style={{ backgroundColor: COLOR.locked }} />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="h-8 w-full rounded-md px-2 text-sm text-white focus:outline-none"
                style={{ backgroundColor: COLOR.inputBg, border: `0.5px solid ${COLOR.inputBorder}` }}
              />
              <span className="text-[11px]" style={{ color: COLOR.muted35 }}>
                {parsed.provider === 'youtube' ? 'YouTube' : 'Vimeo'} · ~10 min
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              onAddItem({
                id: createId('item'),
                title: title.trim() || parsed.title,
                type: 'video',
                durationMinutes: 10,
                externalUrl: url.trim(),
              })
            }
            disabled={!title.trim()}
            className="rounded-md py-2 text-sm font-medium transition-colors disabled:opacity-50"
            style={{ backgroundColor: COLOR.accent, color: '#ffffff' }}
          >
            Add video
          </button>
        </div>
      )}
    </div>
  )
}

function WriteArticleTab({ onAddItem }: { onAddItem: (item: BuilderContentItem) => void }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  return (
    <div className="flex flex-col gap-3">
      <input
        type="text"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Article title"
        className="h-10 w-full rounded-md px-3 text-sm text-white placeholder:text-[rgba(255,255,255,0.3)] focus:outline-none"
        style={{ backgroundColor: COLOR.inputBg, border: `0.5px solid ${COLOR.inputBorder}` }}
      />
      <textarea
        rows={8}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder={'Write the article body. Use "## Heading" for headings and "> Note" for callouts.'}
        className="w-full resize-none rounded-md px-3 py-2 text-sm text-white placeholder:text-[rgba(255,255,255,0.3)] focus:outline-none"
        style={{ backgroundColor: COLOR.inputBg, border: `0.5px solid ${COLOR.inputBorder}` }}
      />
      <button
        type="button"
        onClick={() =>
          onAddItem({
            id: createId('item'),
            title: title.trim(),
            type: 'article',
            durationMinutes: Math.max(1, Math.round(body.trim().split(/\s+/).filter(Boolean).length / 200)),
            body: body.trim(),
          })
        }
        disabled={!title.trim() || !body.trim()}
        className="rounded-md py-2 text-sm font-medium transition-colors disabled:opacity-50"
        style={{ backgroundColor: COLOR.accent, color: '#ffffff' }}
      >
        Save article
      </button>
    </div>
  )
}

export interface AddContentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddItem: (item: BuilderContentItem) => void
}

export function AddContentModal({ open, onOpenChange, onAddItem }: AddContentModalProps) {
  const [tab, setTab] = useState<AddContentTab>('catalogue')

  function handleAdd(item: BuilderContentItem) {
    onAddItem(item)
    onOpenChange(false)
    setTab('catalogue')
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40" style={{ backgroundColor: COLOR.overlay }} />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[10px] p-5"
          style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.cardBorder}` }}
        >
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-sm font-medium" style={{ color: COLOR.pageTitle }}>
              Add content
            </Dialog.Title>
            <Dialog.Close aria-label="Close" style={{ color: COLOR.muted35 }}>
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="mb-4 flex items-center gap-2">
            {TABS.map((option) => (
              <TabButton key={option.value} active={tab === option.value} onClick={() => setTab(option.value)}>
                {option.label}
              </TabButton>
            ))}
          </div>

          {tab === 'catalogue' && <CatalogueSearchTab onAddItem={handleAdd} />}
          {tab === 'link' && <PasteLinkTab onAddItem={handleAdd} />}
          {tab === 'article' && <WriteArticleTab onAddItem={handleAdd} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
