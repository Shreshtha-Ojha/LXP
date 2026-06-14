'use client'

import { useState, type DragEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { BookOpen, Pencil, Play, Trash2, Trophy, X, Zap, type LucideIcon } from 'lucide-react'
import { HEXAGON_CLIP_PATH } from '@/components/path/PathNode'
import { BUILDER_COLORS as COLOR } from './colors'
import {
  createContentNode,
  createQuizNode,
  formatDuration,
  nodeTypeLabel,
  totalCoins,
  totalDurationMinutes,
  type BuilderNode,
  type BuilderNodeType,
} from './types'

export function displayTitle(node: BuilderNode): string {
  if (node.title.trim()) return node.title
  return node.type === 'quiz' ? 'Knowledge check' : 'Untitled content node'
}

/** Icon + background colour for a node's hexagon — shared with the Step 3 mini preview. */
export function getNodeHexagonAppearance(node: BuilderNode, isFinal: boolean): { Icon: LucideIcon; background: string } {
  if (isFinal) return { Icon: Trophy, background: COLOR.gold }
  if (node.type === 'quiz') return { Icon: Zap, background: COLOR.amber }
  return { Icon: node.items.some((item) => item.type === 'video') ? Play : BookOpen, background: COLOR.accent }
}

function NodeHexagon({ node, isFinal }: { node: BuilderNode; isFinal: boolean }) {
  const { Icon, background } = getNodeHexagonAppearance(node, isFinal)

  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center"
      style={{ clipPath: HEXAGON_CLIP_PATH, backgroundColor: background }}
    >
      <Icon className="h-4 w-4 text-white" />
    </div>
  )
}

function AddNodeModal({ open, onOpenChange, onAdd }: { open: boolean; onOpenChange: (open: boolean) => void; onAdd: (type: BuilderNodeType) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40" style={{ backgroundColor: COLOR.overlay }} />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-[10px] p-5"
          style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.cardBorder}` }}
        >
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-sm font-medium" style={{ color: COLOR.pageTitle }}>
              Add a node
            </Dialog.Title>
            <Dialog.Close aria-label="Close" style={{ color: COLOR.muted35 }}>
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => onAdd('content')}
              className="flex flex-col items-start gap-2 rounded-[10px] p-4 text-left transition-colors"
              style={{ backgroundColor: COLOR.accentBg06, border: `0.5px solid ${COLOR.accentBorder}` }}
            >
              <BookOpen className="h-5 w-5" style={{ color: COLOR.accent }} />
              <div className="text-sm font-medium" style={{ color: COLOR.pageTitle }}>
                Content node
              </div>
              <div className="text-[11px]" style={{ color: COLOR.muted35 }}>
                Videos, articles, PDFs
              </div>
            </button>

            <button
              type="button"
              onClick={() => onAdd('quiz')}
              className="flex flex-col items-start gap-2 rounded-[10px] p-4 text-left transition-colors"
              style={{ backgroundColor: 'rgba(245,158,11,0.06)', border: `0.5px solid ${COLOR.amberBorder}` }}
            >
              <Zap className="h-5 w-5" style={{ color: COLOR.amber }} />
              <div className="text-sm font-medium" style={{ color: COLOR.pageTitle }}>
                Quiz node
              </div>
              <div className="text-[11px]" style={{ color: COLOR.muted35 }}>
                Knowledge check questions
              </div>
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export interface NodeListProps {
  nodes: BuilderNode[]
  selectedNodeId: string | null
  onReorder: (nodes: BuilderNode[]) => void
  onAddNode: (node: BuilderNode) => void
  onSelectNode: (nodeId: string) => void
  onDeleteNode: (nodeId: string) => void
}

export function NodeList({ nodes, selectedNodeId, onReorder, onAddNode, onSelectNode, onDeleteNode }: NodeListProps) {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  function handleAdd(type: BuilderNodeType) {
    onAddNode(type === 'quiz' ? createQuizNode() : createContentNode())
    setIsAddModalOpen(false)
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
      const next = [...nodes]
      const [moved] = next.splice(dragIndex, 1)
      const insertAt = dragIndex < dropIndex ? dropIndex - 1 : dropIndex
      next.splice(insertAt, 0, moved)
      onReorder(next)
    }
    setDragIndex(null)
    setDropIndex(null)
  }

  const duration = totalDurationMinutes(nodes)
  const coins = totalCoins(nodes)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium" style={{ color: COLOR.pageTitle }}>
            Path nodes
          </h2>
          <p className="mt-0.5 text-[11px]" style={{ color: COLOR.muted35 }}>
            {nodes.length} node{nodes.length === 1 ? '' : 's'} · {formatDuration(duration)} · 💰 {coins} coins
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsAddModalOpen(true)}
          className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
          style={{ color: COLOR.accentTitle, backgroundColor: COLOR.accentBg06, border: `0.5px solid ${COLOR.accentBorder}` }}
        >
          + Add node
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {nodes.map((node, index) => {
          const isFinal = index === nodes.length - 1 && node.type === 'quiz'
          const isConfirmingDelete = confirmDeleteId === node.id

          return (
            <div key={node.id}>
              {dragIndex !== null && dropIndex === index && (
                <div className="mb-2 h-0.5 rounded-full" style={{ backgroundColor: COLOR.accent }} />
              )}

              <div
                draggable
                onDragStart={(event) => handleDragStart(event, index)}
                onDragOver={(event) => handleDragOver(event, index)}
                onDragEnd={handleDragEnd}
                onClick={() => onSelectNode(node.id)}
                className="flex cursor-pointer items-center gap-3 rounded-[10px] p-4 transition-colors"
                style={{
                  backgroundColor: COLOR.card,
                  border: `0.5px solid ${selectedNodeId === node.id ? COLOR.accentBorder35 : COLOR.cardBorder}`,
                  cursor: 'grab',
                }}
              >
                <span className="select-none text-sm" style={{ color: COLOR.muted25 }}>
                  ⠿
                </span>
                <span className="w-6 shrink-0 text-xs font-medium" style={{ color: COLOR.muted30 }}>
                  {String(index + 1).padStart(2, '0')}
                </span>

                <NodeHexagon node={node} isFinal={isFinal} />

                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium" style={{ color: COLOR.pageTitle }}>
                    {displayTitle(node)}
                  </div>
                  <div className="text-[11px]" style={{ color: COLOR.muted35 }}>
                    {nodeTypeLabel(node)}
                  </div>
                </div>

                <span className="shrink-0 text-xs font-medium" style={{ color: COLOR.amber }}>
                  💰 {node.coins}
                </span>

                {isConfirmingDelete ? (
                  <div className="flex shrink-0 items-center gap-2 text-[11px]">
                    <span style={{ color: COLOR.muted35 }}>Delete?</span>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        onDeleteNode(node.id)
                        setConfirmDeleteId(null)
                      }}
                      className="font-medium"
                      style={{ color: COLOR.red }}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        setConfirmDeleteId(null)
                      }}
                      style={{ color: COLOR.muted35 }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label="Edit node"
                      onClick={(event) => {
                        event.stopPropagation()
                        onSelectNode(node.id)
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[rgba(255,255,255,0.06)]"
                      style={{ color: COLOR.muted30 }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete node"
                      onClick={(event) => {
                        event.stopPropagation()
                        setConfirmDeleteId(node.id)
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[rgba(255,255,255,0.06)]"
                      style={{ color: COLOR.muted30 }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {dragIndex !== null && (
          <div
            onDragOver={(event) => {
              event.preventDefault()
              setDropIndex(nodes.length)
            }}
            className="h-4"
          >
            {dropIndex === nodes.length && <div className="h-0.5 rounded-full" style={{ backgroundColor: COLOR.accent }} />}
          </div>
        )}
      </div>

      <AddNodeModal open={isAddModalOpen} onOpenChange={setIsAddModalOpen} onAdd={handleAdd} />
    </div>
  )
}
