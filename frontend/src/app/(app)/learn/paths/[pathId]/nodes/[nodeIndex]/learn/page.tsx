'use client'

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useParams, useRouter } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertCircle, Lock, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { LESSON_COLORS as COLOR } from '@/components/lesson/colors'
import { RightPanel, type TocHeading } from '@/components/lesson/RightPanel'
import { parseLessonContent, type ContentBlock } from '@/components/lesson/contentParser'
import type { LessonBookmark } from '@/components/lesson/types'
import { getEffectiveNodes, getPathById } from '@/components/path/types'
import { usePathProgressStore } from '@/store/pathProgressStore'
import { ArticleItemView } from '@/components/path/learn/ArticleItemView'
import { CoinEarnedOverlay } from '@/components/path/learn/CoinEarnedOverlay'
import { NodeItemSidebar } from '@/components/path/learn/NodeItemSidebar'
import { NodeLearnTopBar } from '@/components/path/learn/NodeLearnTopBar'
import { VideoItemView } from '@/components/path/learn/VideoItemView'
import { NODE_CONTENT_ITEMS } from '@/components/path/learn/types'
import { useNodeItemNotes } from '@/components/path/learn/useNodeItemNotes'

/** "Mark as watched/read" appears after this long on the current item — shortened in dev so reviewers don't wait. */
const MARK_COMPLETE_DELAY = process.env.NODE_ENV === 'development' ? 5000 : 30000

/** Highlights whichever heading currently sits in the top ~30% of the scroll container — mirrors the lesson page. */
function useActiveHeadingId(headings: TocHeading[], containerRef: RefObject<HTMLDivElement | null>): string | null {
  const [activeId, setActiveId] = useState<string | null>(headings[0]?.id ?? null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || headings.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting)
        if (visible.length === 0) return
        const topMost = visible.reduce((a, b) => (a.boundingClientRect.top <= b.boundingClientRect.top ? a : b))
        setActiveId(topMost.target.id)
      },
      { root: container, rootMargin: '0px 0px -70% 0px', threshold: 0 }
    )

    const elements = headings.map((heading) => document.getElementById(heading.id)).filter((el): el is HTMLElement => el !== null)
    elements.forEach((el) => observer.observe(el))

    return () => observer.disconnect()
  }, [headings, containerRef])

  return activeId
}

export default function NodeLearnPage() {
  const { pathId, nodeIndex } = useParams<{ pathId: string; nodeIndex: string }>()
  const router = useRouter()
  const completedNodeIds = usePathProgressStore((state) => state.completedNodeIds)
  const completeNode = usePathProgressStore((state) => state.completeNode)

  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const path = getPathById(pathId)
  const targetIndex = Number(nodeIndex)
  const node = path ? getEffectiveNodes(path, completedNodeIds).find((candidate) => candidate.index === targetIndex) : undefined
  const items = node ? (NODE_CONTENT_ITEMS[node.id] ?? []) : []

  const [currentItemIndex, setCurrentItemIndex] = useState(0)
  const [completedItems, setCompletedItems] = useState<Set<number>>(new Set())
  const [showMarkComplete, setShowMarkComplete] = useState(false)
  const [showCoinOverlay, setShowCoinOverlay] = useState(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)

  const item = items[currentItemIndex]

  const { notes, bookmarks, addNote, removeNote, isBookmarked, toggleBookmark, removeBookmark } = useNodeItemNotes(
    pathId,
    targetIndex,
    currentItemIndex
  )

  const blocks: ContentBlock[] = useMemo(() => (item?.type === 'article' ? parseLessonContent(item.content) : []), [item])

  const headings: TocHeading[] = useMemo(
    () =>
      blocks
        .filter((block): block is Extract<ContentBlock, { type: 'heading2' }> => block.type === 'heading2')
        .map((block) => ({ id: block.id, text: block.text })),
    [blocks]
  )

  const activeHeadingId = useActiveHeadingId(headings, scrollContainerRef)

  // "Mark as watched" appears MARK_COMPLETE_DELAY after a video item loads.
  useEffect(() => {
    setShowMarkComplete(false)
    if (!item || item.type !== 'video') return
    const timer = setTimeout(() => setShowMarkComplete(true), MARK_COMPLETE_DELAY)
    return () => clearTimeout(timer)
  }, [item])

  // Articles: reveal "Mark as read" once the reader has scrolled past 80%.
  useEffect(() => {
    if (!item || item.type !== 'article') return
    const container = scrollContainerRef.current
    if (!container) return

    function handleScroll() {
      if (!container) return
      const { scrollTop, scrollHeight, clientHeight } = container
      const scrolledFraction = scrollHeight <= clientHeight ? 1 : (scrollTop + clientHeight) / scrollHeight
      if (scrolledFraction >= 0.8) setShowMarkComplete(true)
    }

    container.addEventListener('scroll', handleScroll)
    handleScroll()
    return () => container.removeEventListener('scroll', handleScroll)
  }, [item, blocks])

  // Coin overlay: auto-dismiss back to the path after 2s.
  useEffect(() => {
    if (!showCoinOverlay) return
    const timer = setTimeout(() => router.push(`/learn/paths/${pathId}`), 2000)
    return () => clearTimeout(timer)
  }, [showCoinOverlay, pathId, router])

  if (!path || !node) {
    return <EmptyState icon={AlertCircle} heading="Step not found" subtext="This step doesn't exist in this path." />
  }

  if (node.status === 'locked') {
    return (
      <EmptyState
        icon={Lock}
        heading="This step is locked"
        subtext="Complete the steps before it on the trail to unlock this one."
        cta={{ label: 'Back to path', onClick: () => router.push(`/learn/paths/${pathId}`) }}
      />
    )
  }

  if (!item) {
    return (
      <EmptyState
        icon={AlertCircle}
        heading="No content yet"
        subtext="This step doesn't have any learning content configured yet."
        cta={{ label: 'Back to step', onClick: () => router.push(`/learn/paths/${pathId}/nodes/${node.index}`) }}
      />
    )
  }

  const allItemsCompleted = completedItems.size === items.length
  const isCurrentItemCompleted = completedItems.has(currentItemIndex)

  /** Where a new note/bookmark should anchor: the active TOC section (articles), or the item itself (videos). */
  function getCurrentAnchor(): { id: string; label: string } {
    if (item.type === 'article') {
      const heading = headings.find((candidate) => candidate.id === activeHeadingId)
      return { id: heading?.id ?? 'top', label: heading ? `Section: ${heading.text}` : item.title }
    }
    return { id: 'top', label: item.title }
  }

  const { id: currentAnchorId } = getCurrentAnchor()

  function handleToggleBookmark() {
    const { id, label } = getCurrentAnchor()
    toggleBookmark(label, id)
  }

  function handleAddNote(text: string) {
    const { label } = getCurrentAnchor()
    addNote(text, label)
  }

  function handleSelectBookmark(bookmark: LessonBookmark) {
    if (bookmark.anchor === 'top') {
      scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      document.getElementById(bookmark.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    setPanelOpen(false)
  }

  function handlePrevious() {
    setCurrentItemIndex((index) => Math.max(0, index - 1))
  }

  function handleNext() {
    setCurrentItemIndex((index) => Math.min(items.length - 1, index + 1))
  }

  function handleMarkItemComplete() {
    setCompletedItems((prev) => new Set(prev).add(currentItemIndex))
    if (currentItemIndex < items.length - 1) {
      setCurrentItemIndex((index) => index + 1)
    }
  }

  function handleCompleteNode() {
    if (!node) return
    completeNode(node.id, node.coins)
    setShowCoinOverlay(true)
  }

  function handleBack() {
    const inProgress = currentItemIndex > 0 || completedItems.size > 0
    if (inProgress) {
      setShowLeaveConfirm(true)
    } else {
      router.push(`/learn/paths/${pathId}`)
    }
  }

  return (
    <div className="-m-6 flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden">
      <NodeLearnTopBar
        pathTitle={path.title}
        nodeTitle={node.title}
        itemTitle={item.title}
        itemNumber={currentItemIndex + 1}
        totalItems={items.length}
        isBookmarked={isBookmarked(currentAnchorId)}
        onBack={handleBack}
        onToggleBookmark={handleToggleBookmark}
        onOpenNotes={() => setPanelOpen(true)}
        onOpenOutline={() => setOutlineOpen(true)}
      />

      <div className="flex flex-1 overflow-hidden">
        <NodeItemSidebar
          node={node}
          totalNodes={path.nodes.length}
          items={items}
          currentItemIndex={currentItemIndex}
          completedItems={completedItems}
          onSelectItem={setCurrentItemIndex}
          className="hidden md:flex md:flex-col"
        />

        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
          <div className={cn('mx-auto max-w-[720px] px-10 py-8', showMarkComplete && !isCurrentItemCompleted && 'pb-24')}>
            {item.type === 'video' ? <VideoItemView item={item} node={node} /> : <ArticleItemView item={item} node={node} blocks={blocks} />}

            {/* Bottom navigation */}
            <div className="mt-8 flex items-center justify-between pt-8" style={{ borderTop: `0.5px solid ${COLOR.border05}` }}>
              <Button variant="ghost" className="disabled:opacity-30" disabled={currentItemIndex === 0} onClick={handlePrevious}>
                ← Previous
              </Button>

              {allItemsCompleted ? (
                <button
                  type="button"
                  onClick={handleCompleteNode}
                  className="inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium text-white transition-opacity hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg, #4ade80, #22c55e)' }}
                >
                  Complete node →
                </button>
              ) : (
                <Button variant="primary" disabled={currentItemIndex === items.length - 1} onClick={handleNext}>
                  Next →
                </Button>
              )}
            </div>
          </div>
        </div>

        <RightPanel
          headings={headings}
          activeHeadingId={activeHeadingId}
          notes={notes}
          onAddNote={handleAddNote}
          onRemoveNote={removeNote}
          bookmarks={bookmarks}
          onSelectBookmark={handleSelectBookmark}
          onRemoveBookmark={removeBookmark}
          className="hidden md:flex md:w-[220px] md:shrink-0 md:flex-col"
        />
      </div>

      {/* Mark as watched / Mark as read */}
      {showMarkComplete && !isCurrentItemCompleted && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center">
          <button
            type="button"
            onClick={handleMarkItemComplete}
            className="pointer-events-auto rounded-lg px-6 py-2 text-[13px]"
            style={{ backgroundColor: 'rgba(74,222,128,0.1)', border: `0.5px solid ${COLOR.greenBorder3}`, color: COLOR.green }}
          >
            ✓ Mark as {item.type === 'video' ? 'watched' : 'read'}
          </button>
        </div>
      )}

      {/* Leave confirmation */}
      <Dialog.Root open={showLeaveConfirm} onOpenChange={setShowLeaveConfirm}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
          <Dialog.Content
            className="fixed top-1/2 left-1/2 z-50 w-[90vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg p-5"
            style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.border07}` }}
          >
            <Dialog.Title className="text-[14px] font-medium" style={{ color: COLOR.pageTitle }}>
              Leave this lesson?
            </Dialog.Title>
            <Dialog.Description className="mt-1.5 text-[13px]" style={{ color: COLOR.muted45 }}>
              Your progress is saved.
            </Dialog.Description>
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="ghost">Stay</Button>
              </Dialog.Close>
              <Button variant="primary" onClick={() => router.push(`/learn/paths/${pathId}`)}>
                Leave
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Mobile: node item outline drawer */}
      <Dialog.Root open={outlineOpen} onOpenChange={setOutlineOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 md:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 md:hidden">
            <Dialog.Title className="sr-only">Node outline</Dialog.Title>
            <Dialog.Close
              aria-label="Close node outline"
              className="absolute top-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-md"
              style={{ color: COLOR.muted35 }}
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
            <NodeItemSidebar
              node={node}
              totalNodes={path.nodes.length}
              items={items}
              currentItemIndex={currentItemIndex}
              completedItems={completedItems}
              onSelectItem={(index) => {
                setCurrentItemIndex(index)
                setOutlineOpen(false)
              }}
              className="flex h-full flex-col"
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Mobile: notes / bookmarks / TOC drawer */}
      <Dialog.Root open={panelOpen} onOpenChange={setPanelOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 md:hidden" />
          <Dialog.Content className="fixed inset-y-0 right-0 z-50 w-[280px] md:hidden" style={{ backgroundColor: COLOR.chrome }}>
            <Dialog.Title className="sr-only">Notes and bookmarks</Dialog.Title>
            <Dialog.Close
              aria-label="Close panel"
              className="absolute top-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-md"
              style={{ color: COLOR.muted35 }}
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
            <RightPanel
              headings={headings}
              activeHeadingId={activeHeadingId}
              notes={notes}
              onAddNote={handleAddNote}
              onRemoveNote={removeNote}
              bookmarks={bookmarks}
              onSelectBookmark={handleSelectBookmark}
              onRemoveBookmark={removeBookmark}
              className="h-full"
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Coin earned overlay */}
      {showCoinOverlay && <CoinEarnedOverlay coins={node.coins} nodeName={node.title} />}
    </div>
  )
}
