'use client'

import { useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { AlertCircle, ArrowLeft, CheckCircle2, FileText, Lock, Play, Zap, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { PATH_COLORS as COLOR } from '@/components/path/colors'
import {
  getEffectiveNodes,
  getPathById,
  QUIZ_QUESTIONS,
  type PathItemType,
  type PathNode as PathNodeData,
} from '@/components/path/types'
import { usePathProgressStore } from '@/store/pathProgressStore'

const ITEM_ICONS: Record<PathItemType, LucideIcon> = {
  video: Play,
  article: FileText,
  quiz: Zap,
}

function ItemTypeIcon({ type }: { type: PathItemType }) {
  const Icon = ITEM_ICONS[type]
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: COLOR.accentBg }}>
      <Icon className="h-4 w-4" style={{ color: COLOR.accent }} />
    </div>
  )
}

function NodeHeader({ node, pathId, totalNodes }: { node: PathNodeData; pathId: string; totalNodes: number }) {
  return (
    <div className="flex flex-col gap-3">
      <Link
        href={`/learn/paths/${pathId}`}
        aria-label="Back to path"
        className="flex h-8 w-8 items-center justify-center self-start rounded-md transition-colors hover:text-fg"
        style={{ color: COLOR.muted35 }}
      >
        <ArrowLeft className="h-5 w-5" />
      </Link>

      <span
        className="self-start rounded-full px-2.5 py-0.5 text-xs font-medium"
        style={{ color: COLOR.accentTitle, backgroundColor: COLOR.accentBg, border: `0.5px solid ${COLOR.accentBorder}` }}
      >
        Node {node.index} of {totalNodes}
      </span>

      <h1 className="text-[20px] font-medium" style={{ color: COLOR.pageTitle }}>
        {node.title}
      </h1>

      <div
        className="flex items-center gap-1.5 self-start rounded-[20px] px-3 py-1 text-[13px] font-medium"
        style={{ color: COLOR.amber, backgroundColor: COLOR.amberBg, border: `0.5px solid ${COLOR.amberBorder}` }}
      >
        💰 +{node.coins} coins on completion
      </div>
    </div>
  )
}

/** Read-only view for an already-completed node, reached via "Review" from the trail's bottom sheet. */
function ReviewList({ node }: { node: PathNodeData }) {
  return (
    <div className="mt-6 flex flex-col">
      {node.items.map((item) => (
        <div key={item.title} className="flex items-center gap-3 py-3" style={{ borderBottom: `0.5px solid ${COLOR.muted05}` }}>
          <ItemTypeIcon type={item.type} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px]" style={{ color: COLOR.pageTitle }}>
              {item.title}
            </div>
            {item.duration && (
              <div className="text-[12px]" style={{ color: COLOR.muted35 }}>
                {item.duration}
              </div>
            )}
          </div>
          <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: COLOR.green }} />
        </div>
      ))}

      <div
        className="mt-6 flex items-center justify-center gap-1.5 rounded-md py-2.5 text-[13px] font-medium"
        style={{ color: COLOR.green, backgroundColor: COLOR.greenBg, border: `0.5px solid ${COLOR.greenBorder}` }}
      >
        <CheckCircle2 className="h-4 w-4" />
        Completed
      </div>
    </div>
  )
}

/** Active content (video/article/mixed) node: read-only item list, then jump into the full learning experience. */
function ContentNodeBody({ node, pathId }: { node: PathNodeData; pathId: string }) {
  const router = useRouter()

  return (
    <div className="mt-6 flex flex-col">
      <div className="flex flex-col">
        {node.items.map((item) => (
          <div key={item.title} className="flex items-center gap-3 py-3" style={{ borderBottom: `0.5px solid ${COLOR.muted05}` }}>
            <ItemTypeIcon type={item.type} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px]" style={{ color: COLOR.pageTitle }}>
                {item.title}
              </div>
              {item.duration && (
                <div className="text-[12px]" style={{ color: COLOR.muted35 }}>
                  {item.duration}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <Button variant="primary" className="mt-6 w-full" onClick={() => router.push(`/learn/paths/${pathId}/nodes/${node.index}/learn`)}>
        Start learning →
      </Button>
    </div>
  )
}

interface QuizOptionStyle {
  borderColor: string
  backgroundColor: string
}

const OPTION_DEFAULT: QuizOptionStyle = { borderColor: COLOR.muted08, backgroundColor: COLOR.muted02 }
const OPTION_SELECTED: QuizOptionStyle = { borderColor: COLOR.accentRing, backgroundColor: COLOR.accentBg06 }
const OPTION_CORRECT: QuizOptionStyle = { borderColor: COLOR.greenBorder, backgroundColor: COLOR.greenBg }
const OPTION_WRONG: QuizOptionStyle = { borderColor: COLOR.redBorder, backgroundColor: COLOR.redBg }

/** Active quiz node: one question at a time, auto-graded, ending in a score card. */
function QuizBody({ node, pathId }: { node: PathNodeData; pathId: string }) {
  const router = useRouter()
  const completeNode = usePathProgressStore((state) => state.completeNode)
  const questions = QUIZ_QUESTIONS[node.id]

  const [questionIndex, setQuestionIndex] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [answered, setAnswered] = useState(false)
  const [correctCount, setCorrectCount] = useState(0)
  const [finished, setFinished] = useState(false)

  if (!questions) {
    return (
      <EmptyState
        icon={AlertCircle}
        heading="Knowledge check coming soon"
        subtext="This quiz isn't available in the demo yet — check back in a future release."
      />
    )
  }

  if (finished) {
    return (
      <div
        className="mt-6 flex flex-col items-center gap-3 rounded-[10px] px-6 py-10 text-center"
        style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.cardBorder}` }}
      >
        <div className="text-[28px] font-medium" style={{ color: COLOR.pageTitle }}>
          {correctCount} / {questions.length} correct
        </div>
        <p className="text-[13px]" style={{ color: COLOR.muted45 }}>
          Great work! Node unlocked.
        </p>
        <div
          className="mt-1 flex items-center gap-1.5 rounded-[20px] px-3 py-1 text-[13px] font-medium"
          style={{ color: COLOR.amber, backgroundColor: COLOR.amberBg, border: `0.5px solid ${COLOR.amberBorder}` }}
        >
          💰 +{node.coins} coins earned
        </div>
        <Button
          variant="primary"
          className="mt-4 w-full"
          onClick={() => {
            completeNode(node.id, node.coins)
            router.push(`/learn/paths/${pathId}`)
          }}
        >
          Continue →
        </Button>
      </div>
    )
  }

  const question = questions[questionIndex]
  const isLastQuestion = questionIndex + 1 >= questions.length

  function handleSelect(optionIndex: number) {
    if (answered) return
    setSelected(optionIndex)
    setAnswered(true)
    if (optionIndex === question.correct) setCorrectCount((count) => count + 1)
  }

  function handleNext() {
    if (isLastQuestion) {
      setFinished(true)
      return
    }
    setQuestionIndex((index) => index + 1)
    setSelected(null)
    setAnswered(false)
  }

  function getOptionStyle(optionIndex: number): CSSProperties {
    let style: QuizOptionStyle = OPTION_DEFAULT

    if (!answered) {
      style = optionIndex === selected ? OPTION_SELECTED : OPTION_DEFAULT
    } else if (optionIndex === question.correct) {
      style = OPTION_CORRECT
    } else if (optionIndex === selected) {
      style = OPTION_WRONG
    }

    return { borderWidth: '0.5px', borderStyle: 'solid', borderColor: style.borderColor, backgroundColor: style.backgroundColor }
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div>
        <ProgressBar value={(questionIndex / questions.length) * 100} className="h-[3px]" />
        <div className="mt-1.5 text-[11px]" style={{ color: COLOR.muted35 }}>
          Question {questionIndex + 1} of {questions.length}
        </div>
      </div>

      <div className="rounded-[10px] px-6 py-6" style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.cardBorder}` }}>
        <p className="mb-5 text-[16px] leading-[1.6]" style={{ color: COLOR.pageTitle }}>
          {question.q}
        </p>
        <div className="flex flex-col gap-2">
          {question.options.map((option, optionIndex) => (
            <button
              key={option}
              type="button"
              onClick={() => handleSelect(optionIndex)}
              disabled={answered}
              className="rounded-md px-4 py-3 text-left text-[13px] transition-colors disabled:cursor-default"
              style={{ ...getOptionStyle(optionIndex), color: COLOR.pageTitle }}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {answered && (
        <Button variant="primary" onClick={handleNext} className="w-full">
          {isLastQuestion ? 'See results →' : 'Next question →'}
        </Button>
      )}
    </div>
  )
}

export default function PathNodeDetailPage() {
  const { pathId, nodeIndex } = useParams<{ pathId: string; nodeIndex: string }>()
  const router = useRouter()
  const completedNodeIds = usePathProgressStore((state) => state.completedNodeIds)

  const path = getPathById(pathId)
  const targetIndex = Number(nodeIndex)
  const node = path ? getEffectiveNodes(path, completedNodeIds).find((candidate) => candidate.index === targetIndex) : undefined

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

  const isQuizType = node.type === 'quiz' || node.type === 'final'

  return (
    <div className="mx-auto flex max-w-[480px] flex-col">
      <NodeHeader node={node} pathId={pathId} totalNodes={path.nodes.length} />
      {node.status === 'completed' ? (
        <ReviewList node={node} />
      ) : isQuizType ? (
        <QuizBody node={node} pathId={pathId} />
      ) : (
        <ContentNodeBody node={node} pathId={pathId} />
      )}
    </div>
  )
}
