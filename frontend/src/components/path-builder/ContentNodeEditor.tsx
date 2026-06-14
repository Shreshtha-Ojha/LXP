'use client'

import { useState, type DragEvent } from 'react'
import { ExternalLink, FileText, GripVertical, Play, X, type LucideIcon } from 'lucide-react'
import { AddContentModal } from './AddContentModal'
import { BUILDER_COLORS as COLOR } from './colors'
import type { BuilderContentItem, BuilderNode, ContentItemType } from './types'

const ITEM_TYPE_ICONS: Record<ContentItemType, LucideIcon> = {
  video: Play,
  article: FileText,
  pdf: FileText,
  scorm: FileText,
  external_link: ExternalLink,
}

const FIELD_INPUT_STYLE = { backgroundColor: COLOR.inputBg, border: `0.5px solid ${COLOR.inputBorder}` }

export interface ContentNodeEditorProps {
  node: BuilderNode
  onChange: (node: BuilderNode) => void
}

export function ContentNodeEditor({ node, onChange }: ContentNodeEditorProps) {
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  function addItem(item: BuilderContentItem) {
    onChange({ ...node, items: [...node.items, item] })
  }

  function removeItem(itemId: string) {
    onChange({ ...node, items: node.items.filter((item) => item.id !== itemId) })
  }

  function handleDragStart(event: DragEvent<HTMLDivElement>, index: number) {
    setDragIndex(index)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>, index: number) {
    event.preventDefault()
    setDropIndex(index)
  }

  function handleDragEnd() {
    if (dragIndex !== null && dropIndex !== null && dragIndex !== dropIndex) {
      const next = [...node.items]
      const [moved] = next.splice(dragIndex, 1)
      const insertAt = dragIndex < dropIndex ? dropIndex - 1 : dropIndex
      next.splice(insertAt, 0, moved)
      onChange({ ...node, items: next })
    }
    setDragIndex(null)
    setDropIndex(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" style={{ color: COLOR.muted50 }}>
          Node title
        </label>
        <input
          type="text"
          value={node.title}
          onChange={(event) => onChange({ ...node, title: event.target.value })}
          placeholder="Untitled content node"
          className="h-10 w-full rounded-md px-3 text-sm text-white placeholder:text-[rgba(255,255,255,0.3)] focus:outline-none"
          style={FIELD_INPUT_STYLE}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium" style={{ color: COLOR.muted50 }}>
          Coin reward
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm">💰</span>
          <input
            type="number"
            min={0}
            value={node.coins}
            onChange={(event) => onChange({ ...node, coins: Math.max(0, Math.floor(Number(event.target.value) || 0)) })}
            className="h-10 w-24 rounded-md px-3 text-sm text-white focus:outline-none"
            style={FIELD_INPUT_STYLE}
          />
        </div>
        <p className="text-[11px]" style={{ color: COLOR.muted30 }}>
          Coins are awarded to learners when they complete this node
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium" style={{ color: COLOR.muted50 }}>
            Content items
          </label>
          <button
            type="button"
            onClick={() => setIsAddOpen(true)}
            className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ color: COLOR.accentTitle, backgroundColor: COLOR.accentBg06, border: `0.5px solid ${COLOR.accentBorder}` }}
          >
            + Add content
          </button>
        </div>

        {node.items.length === 0 ? (
          <div className="rounded-[10px] p-4 text-center text-[11px]" style={{ backgroundColor: COLOR.muted03, border: `0.5px solid ${COLOR.muted08}`, color: COLOR.muted35 }}>
            No content yet. Add a video, article, or PDF to this node.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {node.items.map((item, index) => {
              const Icon = ITEM_TYPE_ICONS[item.type]
              return (
                <div key={item.id}>
                  {dragIndex !== null && dropIndex === index && (
                    <div className="mb-2 h-0.5 rounded-full" style={{ backgroundColor: COLOR.accent }} />
                  )}

                  <div
                    draggable
                    onDragStart={(event) => handleDragStart(event, index)}
                    onDragOver={(event) => handleDragOver(event, index)}
                    onDragEnd={handleDragEnd}
                    className="flex items-center gap-3 rounded-[10px] p-3"
                    style={{ backgroundColor: COLOR.muted03, border: `0.5px solid ${COLOR.muted08}`, cursor: 'grab' }}
                  >
                    <GripVertical className="h-4 w-4 shrink-0" style={{ color: COLOR.muted25 }} />

                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                      style={{ backgroundColor: COLOR.accentBg06 }}
                    >
                      <Icon className="h-3 w-3" style={{ color: COLOR.accent }} />
                    </span>

                    <span className="min-w-0 flex-1 truncate text-sm" style={{ color: COLOR.pageTitle }}>
                      {item.title || 'Untitled item'}
                    </span>

                    <span className="shrink-0 text-[11px]" style={{ color: COLOR.muted35 }}>
                      {item.durationMinutes != null ? `${item.durationMinutes} min` : '—'}
                    </span>

                    <button
                      type="button"
                      aria-label="Remove item"
                      onClick={() => removeItem(item.id)}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[rgba(255,255,255,0.06)]"
                      style={{ color: COLOR.muted30 }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}

            {dragIndex !== null && (
              <div
                onDragOver={(event) => {
                  event.preventDefault()
                  setDropIndex(node.items.length)
                }}
                className="h-4"
              >
                {dropIndex === node.items.length && <div className="h-0.5 rounded-full" style={{ backgroundColor: COLOR.accent }} />}
              </div>
            )}
          </div>
        )}
      </div>

      <AddContentModal open={isAddOpen} onOpenChange={setIsAddOpen} onAddItem={addItem} />
    </div>
  )
}
