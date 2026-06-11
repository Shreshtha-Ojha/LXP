'use client'

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as Dialog from '@radix-ui/react-dialog'
import { CheckCircle2, Clock, Tag, X, Zap } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuthStore } from '@/store/authStore'
import type { ApiLearningAsset } from '@/components/catalogue/types'

import { CourseOutlineSidebar } from '@/components/lesson/CourseOutlineSidebar'
import { LessonTopBar } from '@/components/lesson/LessonTopBar'
import { LessonContent } from '@/components/lesson/LessonContent'
import { RightPanel, type TocHeading } from '@/components/lesson/RightPanel'
import { VideoPlayer, type VideoPlayerHandle, type VideoProgress } from '@/components/lesson/VideoPlayer'
import { LESSON_COLORS as COLOR } from '@/components/lesson/colors'
import { parseLessonContent, type ContentBlock } from '@/components/lesson/contentParser'
import { useLessonNotes } from '@/components/lesson/useLessonNotes'
import { mockLesson, type LessonAsset, type LessonBookmark, type OutlineLesson } from '@/components/lesson/types'

// Mirrors formatDuration in app/(app)/learn/[assetId]/page.tsx so durations read consistently.
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/** Picks the lesson to treat as "current": the first one marked active, or else the first not yet completed. */
function findInitialLessonIndex(lessons: OutlineLesson[]): number {
  const activeIndex = lessons.findIndex((lesson) => lesson.status === 'active')
  if (activeIndex >= 0) return activeIndex
  return lessons.findIndex((lesson) => lesson.status !== 'completed')
}

async function fetchAsset(assetId: string): Promise<ApiLearningAsset> {
  const { data } = await api.get<ApiLearningAsset>(`/content/assets/${assetId}`)
  return data
}

async function fetchResumePosition(assetId: string): Promise<number> {
  const { data } = await api.get<{ positionSeconds: number }>(`/progress/resume/${assetId}`)
  return data.positionSeconds
}

interface ProgressEventInput {
  event_type: 'progress_updated' | 'completed'
  progress_pct?: number
  position_seconds?: number
}

async function postProgressEvent(assetId: string, input: ProgressEventInput): Promise<void> {
  await api.post('/progress/events', { asset_id: assetId, ...input })
}

/** Highlights whichever heading currently sits in the top ~30% of the scroll container. */
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

export default function LessonPage() {
  const { assetId } = useParams<{ assetId: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const userId = useAuthStore((state) => state.user?.id)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const videoPlayerRef = useRef<VideoPlayerHandle>(null)
  const currentVideoTimeRef = useRef(0)

  const [outlineOpen, setOutlineOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [isCompleted, setIsCompleted] = useState(false)
  const [showCompleteButton, setShowCompleteButton] = useState(false)

  const assetQuery = useQuery({ queryKey: ['asset', assetId], queryFn: () => fetchAsset(assetId) })

  // `body_content`, `lessons_in_course`, `quiz`, and `category` are forward-looking
  // fields — /content/assets/:id doesn't return a course outline or rich body
  // content yet (see types.ts). Overlay them from mockLesson, and fall back to
  // mockLesson entirely if the asset can't be loaded, so the reading experience
  // stays demoable ahead of that API support.
  const asset: LessonAsset = assetQuery.data
    ? {
        ...assetQuery.data,
        body_content: mockLesson.body_content,
        lessons_in_course: mockLesson.lessons_in_course,
        quiz: mockLesson.quiz,
        category: mockLesson.category,
      }
    : mockLesson

  const isVideo = asset.contentType === 'video'

  const resumeQuery = useQuery({
    queryKey: ['progress-resume', assetId],
    queryFn: () => fetchResumePosition(assetId),
    enabled: isVideo,
  })

  const progressMutation = useMutation({
    mutationFn: (input: ProgressEventInput) => postProgressEvent(assetId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['progress-me'] }),
  })

  const { notes, bookmarks, addNote, removeNote, isBookmarked, toggleBookmark, removeBookmark } = useLessonNotes(userId, assetId)

  const blocks = useMemo(() => parseLessonContent(asset.body_content), [asset.body_content])

  const headings: TocHeading[] = useMemo(
    () =>
      blocks
        .filter((block): block is Extract<ContentBlock, { type: 'heading2' }> => block.type === 'heading2')
        .map((block) => ({ id: block.id, text: block.text })),
    [blocks]
  )

  const activeHeadingId = useActiveHeadingId(headings, scrollContainerRef)

  const lessonsInCourse = asset.lessons_in_course ?? []
  const [currentLessonIndex, setCurrentLessonIndex] = useState(() => findInitialLessonIndex(lessonsInCourse))
  const lessonNumber = currentLessonIndex >= 0 ? currentLessonIndex + 1 : null
  const totalLessons = lessonsInCourse.length || null
  const prevLesson = currentLessonIndex > 0 ? lessonsInCourse[currentLessonIndex - 1] : null
  const nextLesson =
    currentLessonIndex >= 0 && currentLessonIndex < lessonsInCourse.length - 1 ? lessonsInCourse[currentLessonIndex + 1] : null
  const isLastLesson = currentLessonIndex >= 0 && currentLessonIndex === lessonsInCourse.length - 1

  function handleNavigateToLesson(lesson: OutlineLesson, index: number) {
    setCurrentLessonIndex(index)
    router.push(`/learn/${lesson.id}/lesson`)
  }

  /** Where a new note/bookmark should anchor: the current TOC section, or the current video timestamp. */
  function getCurrentAnchor(): { id: string; label: string } {
    if (isVideo) {
      const seconds = Math.floor(currentVideoTimeRef.current)
      return { id: `video:${seconds}`, label: `At ${formatTimestamp(seconds)} in video` }
    }
    const heading = headings.find((item) => item.id === activeHeadingId)
    return { id: heading?.id ?? 'top', label: heading ? `Section: ${heading.text}` : 'Top of lesson' }
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
    if (bookmark.anchor.startsWith('video:')) {
      videoPlayerRef.current?.seekTo(Number(bookmark.anchor.slice('video:'.length)))
    } else {
      document.getElementById(bookmark.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    setPanelOpen(false)
  }

  function handleVideoProgress({ progressPct, positionSeconds }: VideoProgress) {
    progressMutation.mutate({ event_type: 'progress_updated', progress_pct: progressPct, position_seconds: positionSeconds })
  }

  function handleVideoComplete({ positionSeconds }: VideoProgress) {
    progressMutation.mutate({ event_type: 'completed', progress_pct: 100, position_seconds: positionSeconds })
    setIsCompleted(true)
  }

  function handleMarkComplete() {
    progressMutation.mutate({ event_type: 'completed', progress_pct: 100 }, { onSuccess: () => setIsCompleted(true) })
  }

  function handleCompleteCourse() {
    progressMutation.mutate(
      { event_type: 'completed', progress_pct: 100 },
      { onSuccess: () => router.push(`/learn/${assetId}/complete`) }
    )
  }

  // Article/PDF: reveal "Mark as complete" once the reader has scrolled past 80%.
  useEffect(() => {
    if (isVideo) return
    const container = scrollContainerRef.current
    if (!container) return

    function handleScroll() {
      if (!container) return
      const { scrollTop, scrollHeight, clientHeight } = container
      const scrolledFraction = scrollHeight <= clientHeight ? 1 : (scrollTop + clientHeight) / scrollHeight
      if (scrolledFraction >= 0.8) setShowCompleteButton(true)
    }

    container.addEventListener('scroll', handleScroll)
    handleScroll()
    return () => container.removeEventListener('scroll', handleScroll)
  }, [isVideo, blocks])

  if (assetQuery.isLoading) {
    return (
      <div className="-m-6 flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  const courseTitle = asset.category ?? 'Course'
  const eyebrow = [lessonNumber != null ? `Lesson ${lessonNumber}` : null, asset.category].filter(Boolean).join(' · ')

  return (
    <div className="-m-6 flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden">
      <LessonTopBar
        assetId={assetId}
        courseTitle={courseTitle}
        lessonTitle={asset.title}
        lessonNumber={lessonNumber}
        totalLessons={totalLessons}
        isBookmarked={isBookmarked(currentAnchorId)}
        onToggleBookmark={handleToggleBookmark}
        onOpenNotes={() => setPanelOpen(true)}
        onOpenOutline={() => setOutlineOpen(true)}
        showPlaybackSettings={isVideo}
        playbackRate={playbackRate}
        onPlaybackRateChange={setPlaybackRate}
      />

      <div className="flex flex-1 overflow-hidden">
        <CourseOutlineSidebar
          lessons={lessonsInCourse}
          activeIndex={currentLessonIndex}
          onSelectLesson={handleNavigateToLesson}
          className="hidden lg:flex lg:flex-col"
        />

        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
          <div className={cn('mx-auto max-w-[720px] px-10 py-8', !isVideo && showCompleteButton && 'pb-24')}>
            {/* Header */}
            <div className="pb-6" style={{ borderBottom: `0.5px solid ${COLOR.border05}` }}>
              {eyebrow && (
                <div className="text-[10px] font-medium uppercase tracking-wide" style={{ color: COLOR.accentText60 }}>
                  {eyebrow}
                </div>
              )}
              <h1 className="mt-2 text-[22px] font-medium" style={{ color: COLOR.pageTitle, letterSpacing: '-0.02em' }}>
                {asset.title}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-3.5 text-[12px]" style={{ color: COLOR.muted35 }}>
                {asset.durationMinutes != null && (
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    {formatDuration(asset.durationMinutes)}
                  </span>
                )}
                {asset.proficiencyLevel && (
                  <span className="flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5" />
                    {asset.proficiencyLevel.name}
                  </span>
                )}
                {asset.tags.length > 0 && (
                  <span className="flex items-center gap-1.5">
                    <Tag className="h-3.5 w-3.5" />
                    {asset.tags.join(', ')}
                  </span>
                )}
              </div>
            </div>

            {/* Body */}
            <div className="pt-6">
              {isVideo && (
                <div className="mb-6">
                  <VideoPlayer
                    ref={videoPlayerRef}
                    title={asset.title}
                    externalUrl={asset.externalUrl}
                    resumeSeconds={resumeQuery.data}
                    durationLabel={asset.durationMinutes != null ? formatDuration(asset.durationMinutes) : null}
                    playbackRate={playbackRate}
                    onProgress={handleVideoProgress}
                    onComplete={handleVideoComplete}
                    onTimeUpdate={(seconds) => {
                      currentVideoTimeRef.current = seconds
                    }}
                  />
                </div>
              )}

              <LessonContent blocks={blocks} quiz={asset.quiz} />
            </div>

            {/* Bottom navigation */}
            <div className="mt-8 flex items-center justify-between pt-8" style={{ borderTop: `0.5px solid ${COLOR.border05}` }}>
              {prevLesson ? (
                <Button variant="ghost" onClick={() => handleNavigateToLesson(prevLesson, currentLessonIndex - 1)}>
                  ← Previous
                </Button>
              ) : (
                <span />
              )}

              {isLastLesson ? (
                <Button variant="primary" onClick={handleCompleteCourse} disabled={progressMutation.isPending}>
                  {progressMutation.isPending && <Spinner className="h-4 w-4 text-white" />}
                  Complete course →
                </Button>
              ) : nextLesson ? (
                <Button variant="primary" onClick={() => handleNavigateToLesson(nextLesson, currentLessonIndex + 1)}>
                  Next lesson →
                </Button>
              ) : (
                <span />
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
          className="hidden xl:flex xl:w-[220px] xl:shrink-0 xl:flex-col"
        />
      </div>

      {/* Article/PDF: fixed "Mark as complete" once scrolled past 80% */}
      {!isVideo && showCompleteButton && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center">
          {isCompleted ? (
            <span
              className="pointer-events-auto flex items-center gap-1.5 rounded-full px-6 py-2 text-[13px] font-medium"
              style={{ color: COLOR.greenText80, backgroundColor: COLOR.greenBg05, border: `0.5px solid ${COLOR.greenBorder25}` }}
            >
              <CheckCircle2 className="h-4 w-4" />
              Completed
            </span>
          ) : (
            <Button
              variant="primary"
              className="pointer-events-auto h-auto rounded-full px-6 py-2"
              onClick={handleMarkComplete}
              disabled={progressMutation.isPending}
            >
              {progressMutation.isPending && <Spinner className="h-4 w-4 text-white" />}
              Mark as complete
            </Button>
          )}
        </div>
      )}

      {/* Mobile: course outline drawer */}
      <Dialog.Root open={outlineOpen} onOpenChange={setOutlineOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 lg:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 lg:hidden">
            <Dialog.Title className="sr-only">Course outline</Dialog.Title>
            <Dialog.Close
              aria-label="Close course outline"
              className="absolute top-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-md"
              style={{ color: COLOR.muted35 }}
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
            <CourseOutlineSidebar
              lessons={lessonsInCourse}
              activeIndex={currentLessonIndex}
              onSelectLesson={handleNavigateToLesson}
              className="h-full"
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Mobile: notes / bookmarks / TOC drawer */}
      <Dialog.Root open={panelOpen} onOpenChange={setPanelOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 xl:hidden" />
          <Dialog.Content className="fixed inset-y-0 right-0 z-50 w-[280px] xl:hidden" style={{ backgroundColor: COLOR.chrome }}>
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
    </div>
  )
}
