'use client'

import { type ReactNode } from 'react'
import { TrailNode } from './PathNode'
import { PATH_COLORS as COLOR } from './colors'
import type { PathNode as PathNodeData } from './types'

const TRAIL_WIDTH = 320
const SEGMENT_HEIGHT = 140

/** Zigzag pattern: left, center, right, center — repeats every 4 nodes. */
const X_OFFSETS = [-120, 0, 120, 0] as const

function getXOffset(index: number): number {
  return X_OFFSETS[(index - 1) % X_OFFSETS.length]
}

type Decoration = { kind: 'coin'; label: string; xOffset: number } | { kind: 'milestone'; label: string }

/** Decorative elements shown in the segment after the given node index. */
function getDecoration(nodeIndex: number): Decoration | null {
  switch (nodeIndex) {
    case 1:
      return { kind: 'coin', label: '💰 +50', xOffset: 55 }
    case 3:
      return { kind: 'milestone', label: '25% complete' }
    case 5:
      return { kind: 'coin', label: '+50', xOffset: -50 }
    case 7:
      return { kind: 'milestone', label: 'Almost there!' }
    default:
      return null
  }
}

interface TrailSegmentProps {
  fromOffset: number
  toOffset: number
  completed: boolean
  decoration: Decoration | null
}

/** Curved bezier connector between two nodes, plus any decorative element in between. */
function TrailSegment({ fromOffset, toOffset, completed, decoration }: TrailSegmentProps) {
  const centerX = TRAIL_WIDTH / 2
  const x1 = centerX + fromOffset
  const x2 = centerX + toOffset
  const midY = SEGMENT_HEIGHT / 2

  return (
    <div className="relative" style={{ width: TRAIL_WIDTH, height: SEGMENT_HEIGHT }}>
      <svg width={TRAIL_WIDTH} height={SEGMENT_HEIGHT} viewBox={`0 0 ${TRAIL_WIDTH} ${SEGMENT_HEIGHT}`} className="absolute inset-0">
        <path
          d={`M ${x1} 0 C ${x1} ${midY} ${x2} ${midY} ${x2} ${SEGMENT_HEIGHT}`}
          fill="none"
          stroke={completed ? COLOR.accentLine : COLOR.muted10}
          strokeWidth={2}
        />
      </svg>

      {decoration?.kind === 'coin' && (
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[12px] font-medium whitespace-nowrap opacity-60"
          style={{ left: `calc(50% + ${decoration.xOffset}px)`, color: COLOR.amber }}
        >
          {decoration.label}
        </div>
      )}

      {decoration?.kind === 'milestone' && (
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full px-3 py-1 text-[11px] whitespace-nowrap"
          style={{ backgroundColor: COLOR.accentBg, border: `0.5px solid ${COLOR.accentBorder}`, color: COLOR.accentText70 }}
        >
          {decoration.label}
        </div>
      )}
    </div>
  )
}

export interface PathTrailProps {
  nodes: PathNodeData[]
  pathId: string
  /** Id of the node to play the "+N coins" float animation on, if any. */
  justCompletedNodeId: string | null
  onCoinAnimationEnd: () => void
}

export function PathTrail({ nodes, pathId, justCompletedNodeId, onCoinAnimationEnd }: PathTrailProps) {
  const rows: ReactNode[] = []

  nodes.forEach((node, i) => {
    const xOffset = getXOffset(node.index)
    const previousNode = i > 0 ? nodes[i - 1] : null
    const nextNode = nodes[i + 1]

    rows.push(
      <div key={node.id} className="flex justify-center" style={{ transform: `translateX(${xOffset}px)` }}>
        <TrailNode
          node={node}
          pathId={pathId}
          previousNodeTitle={previousNode?.title ?? null}
          showCoinAnimation={node.id === justCompletedNodeId}
          onCoinAnimationEnd={onCoinAnimationEnd}
        />
      </div>
    )

    if (nextNode) {
      rows.push(
        <TrailSegment
          key={`${node.id}-${nextNode.id}`}
          fromOffset={xOffset}
          toOffset={getXOffset(nextNode.index)}
          completed={node.status === 'completed'}
          decoration={getDecoration(node.index)}
        />
      )
    }
  })

  return (
    <div className="mx-auto flex flex-col items-center" style={{ width: TRAIL_WIDTH }}>
      {rows}
    </div>
  )
}
