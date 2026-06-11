'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AlertCircle, ArrowLeft } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { PathTrail } from '@/components/path/PathTrail'
import { PATH_COLORS as COLOR } from '@/components/path/colors'
import { getCompletedCount, getEffectiveNodes, getPathById } from '@/components/path/types'
import { usePathProgressStore } from '@/store/pathProgressStore'

export default function LearningPathPage() {
  const { pathId } = useParams<{ pathId: string }>()
  const path = getPathById(pathId)

  const coinTotal = usePathProgressStore((state) => state.coinTotal)
  const completedNodeIds = usePathProgressStore((state) => state.completedNodeIds)
  const justCompletedNodeId = usePathProgressStore((state) => state.justCompletedNodeId)
  const clearJustCompleted = usePathProgressStore((state) => state.clearJustCompleted)

  if (!path) {
    return (
      <EmptyState
        icon={AlertCircle}
        heading="Path not found"
        subtext="This learning path doesn't exist or hasn't been published yet."
      />
    )
  }

  const nodes = getEffectiveNodes(path, completedNodeIds)
  const completedCount = getCompletedCount(nodes)
  const progressPct = (completedCount / nodes.length) * 100

  return (
    <div className="mx-auto flex max-w-[480px] flex-col">
      <Link
        href="/learn"
        aria-label="Back to Learn"
        className="mb-4 flex h-8 w-8 items-center justify-center self-start rounded-md transition-colors hover:text-fg"
        style={{ color: COLOR.muted35 }}
      >
        <ArrowLeft className="h-5 w-5" />
      </Link>

      <h1 className="text-[20px] font-medium" style={{ color: COLOR.pageTitle }}>
        {path.title}
      </h1>
      <p className="mt-1 text-[12px]" style={{ color: COLOR.muted35 }}>
        {path.subtitle}
      </p>

      <div className="mt-4 flex items-center gap-3">
        <div className="flex-1">
          <ProgressBar value={progressPct} className="h-[5px]" />
          <div className="mt-1.5 text-[11px]" style={{ color: COLOR.muted35 }}>
            {completedCount} of {nodes.length} complete
          </div>
        </div>

        <div
          className="flex shrink-0 items-center gap-1.5 rounded-[20px] px-3 py-1 text-[13px] font-medium"
          style={{ color: COLOR.amber, backgroundColor: COLOR.amberBg, border: `0.5px solid ${COLOR.amberBorder}` }}
        >
          💰 {coinTotal} coins
        </div>
      </div>

      <div className="mt-10 mb-6">
        <PathTrail nodes={nodes} pathId={path.id} justCompletedNodeId={justCompletedNodeId} onCoinAnimationEnd={clearJustCompleted} />
      </div>
    </div>
  )
}
