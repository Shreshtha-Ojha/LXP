'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { BookOpen, Check, CheckCircle2, FileText, Lock, Play, Trophy, X, Zap, type LucideIcon } from 'lucide-react'
import { PATH_COLORS as COLOR } from './colors'
import type { PathItemType, PathNode as PathNodeData, PathNodeType } from './types'

/** Pointy-top hexagon, sized to the path trail spec (72 x 80). */
export const HEX_WIDTH = 72
export const HEX_HEIGHT = 80
export const HEXAGON_CLIP_PATH = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)'

const TYPE_ICONS: Record<PathNodeType, LucideIcon> = {
  video: Play,
  article: FileText,
  mixed: BookOpen,
  quiz: Zap,
  final: Trophy,
}

const ITEM_ICONS: Record<PathItemType, LucideIcon> = {
  video: Play,
  article: FileText,
  quiz: Zap,
}

const LOCKED_TOOLTIP_MS = 2200

interface TrailNodeProps {
  node: PathNodeData
  pathId: string
  /** Title of the node before this one — used in the locked tooltip. */
  previousNodeTitle: string | null
  /** True for one render pass after this node is completed — plays the coin float animation. */
  showCoinAnimation: boolean
  onCoinAnimationEnd: () => void
}

export function TrailNode({ node, pathId, previousNodeTitle, showCoinAnimation, onCoinAnimationEnd }: TrailNodeProps) {
  const router = useRouter()
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  // Locked tooltip is tap-to-show on a touch-first layout — auto-dismiss so
  // it doesn't linger if the learner taps elsewhere on the trail.
  useEffect(() => {
    if (!tooltipOpen) return
    const timer = setTimeout(() => setTooltipOpen(false), LOCKED_TOOLTIP_MS)
    return () => clearTimeout(timer)
  }, [tooltipOpen])

  const isCompleted = node.status === 'completed'
  const isActive = node.status === 'active'
  const isLocked = node.status === 'locked'

  const Icon = isCompleted ? Check : isLocked ? Lock : TYPE_ICONS[node.type]
  const iconSizeClass = isLocked ? 'h-5 w-5' : 'h-6 w-6'
  const labelColor = isCompleted ? COLOR.green : isActive ? COLOR.accentTitle : COLOR.muted30

  const hexagonStyle: CSSProperties = isCompleted
    ? {
        background: `linear-gradient(135deg, ${COLOR.green}, ${COLOR.greenStrong})`,
        filter: `drop-shadow(0 0 20px ${COLOR.greenGlow})`,
      }
    : isActive
      ? {
          background: `linear-gradient(135deg, ${COLOR.accent}, ${COLOR.accentSoft})`,
          filter: `drop-shadow(0 0 24px ${COLOR.accentGlow})`,
        }
      : {
          background: COLOR.locked,
          border: `1.5px solid ${COLOR.lockedBorder}`,
        }

  function handleClick() {
    if (isCompleted) {
      setSheetOpen(true)
    } else if (isActive) {
      router.push(`/learn/paths/${pathId}/nodes/${node.index}`)
    } else {
      setTooltipOpen((open) => !open)
    }
  }

  function handleReview() {
    setSheetOpen(false)
    router.push(`/learn/paths/${pathId}/nodes/${node.index}`)
  }

  return (
    <div className="flex flex-col items-center" style={{ width: 100 }}>
      <div className="relative" style={{ width: HEX_WIDTH, height: HEX_HEIGHT }}>
        {isActive && (
          <div
            className="pointer-events-none absolute inset-0 animate-pulse-ring"
            style={{ clipPath: HEXAGON_CLIP_PATH, border: `2px solid ${COLOR.accentRing}` }}
          />
        )}

        <button
          type="button"
          onClick={handleClick}
          aria-label={isLocked ? `${node.title} (locked)` : node.title}
          className="flex h-full w-full appearance-none items-center justify-center border-0 p-0 transition-transform focus-visible:outline-none active:scale-95"
          style={{ ...hexagonStyle, clipPath: HEXAGON_CLIP_PATH, cursor: isLocked ? 'not-allowed' : 'pointer' }}
        >
          <Icon className={iconSizeClass} style={{ color: isLocked ? COLOR.muted20 : COLOR.white }} />
        </button>

        {node.type === 'quiz' && (
          <div
            className="absolute -top-1 -right-1 flex h-[18px] w-[18px] items-center justify-center rounded-full"
            style={{ backgroundColor: COLOR.amber }}
          >
            <Zap className="h-2.5 w-2.5 text-white" />
          </div>
        )}

        {showCoinAnimation && (
          <div
            className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 animate-coin-float text-[12px] font-medium whitespace-nowrap"
            style={{ color: COLOR.amber }}
            onAnimationEnd={onCoinAnimationEnd}
          >
            +{node.coins} coins
          </div>
        )}

        {tooltipOpen && (
          <div
            className="absolute -top-11 left-1/2 z-10 -translate-x-1/2 rounded-md px-2.5 py-1.5 text-xs whitespace-nowrap"
            style={{ backgroundColor: COLOR.tooltipBg, border: `0.5px solid ${COLOR.tooltipBorder}`, color: COLOR.muted50 }}
          >
            Complete {previousNodeTitle ?? 'the previous step'} first
          </div>
        )}
      </div>

      <div className="mt-2 text-[10px]" style={{ color: COLOR.muted20 }}>
        {String(node.index).padStart(2, '0')}
      </div>
      <div className="text-center text-[12px] leading-tight font-medium" style={{ color: labelColor, maxWidth: 100 }}>
        {node.title}
      </div>
      {node.type === 'quiz' && (
        <div className="mt-0.5 text-[11px] font-medium" style={{ color: COLOR.amber }}>
          Knowledge check
        </div>
      )}

      {/* Completed node: bottom sheet listing what was finished */}
      <Dialog.Root open={sheetOpen} onOpenChange={setSheetOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
          <Dialog.Content
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[480px] rounded-t-xl px-5 pt-4 pb-6"
            style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.cardBorder}` }}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full" style={{ backgroundColor: COLOR.muted10 }} />

            <div className="mb-1 flex items-center justify-between">
              <Dialog.Title className="text-[15px] font-medium" style={{ color: COLOR.pageTitle }}>
                {node.title}
              </Dialog.Title>
              <Dialog.Close aria-label="Close" style={{ color: COLOR.muted35 }}>
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>
            <Dialog.Description className="mb-4 text-[12px]" style={{ color: COLOR.muted35 }}>
              Completed — nice work
            </Dialog.Description>

            <div className="flex flex-col">
              {node.items.map((item) => {
                const ItemIcon = ITEM_ICONS[item.type]
                return (
                  <div
                    key={item.title}
                    className="flex items-center gap-3 py-2.5"
                    style={{ borderBottom: `0.5px solid ${COLOR.muted05}` }}
                  >
                    <ItemIcon className="h-4 w-4 shrink-0" style={{ color: COLOR.muted35 }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px]" style={{ color: COLOR.pageTitle }}>
                        {item.title}
                      </div>
                      {item.duration && (
                        <div className="text-[11px]" style={{ color: COLOR.muted35 }}>
                          {item.duration}
                        </div>
                      )}
                    </div>
                    <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: COLOR.green }} />
                  </div>
                )
              })}
            </div>

            <button
              type="button"
              onClick={handleReview}
              className="mt-4 w-full rounded-md py-2.5 text-[13px] font-medium"
              style={{ backgroundColor: COLOR.accentBg, border: `0.5px solid ${COLOR.accentBorder}`, color: COLOR.accentTitle }}
            >
              Review
            </button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
