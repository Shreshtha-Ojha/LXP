import type { ReactNode } from 'react'
import { Callout } from './Callout'
import { LESSON_COLORS as COLOR } from './colors'
import { QuizBlock } from './QuizBlock'
import type { ContentBlock } from './contentParser'
import type { QuizQuestion } from './types'

const BOLD_PATTERN = /\*\*(.+?)\*\*/g

/** Renders `**bold**` runs as `<strong>`, leaving everything else as plain text. */
function renderInlineText(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  BOLD_PATTERN.lastIndex = 0
  while ((match = BOLD_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    parts.push(
      <strong key={`${keyPrefix}-${match.index}`} style={{ fontWeight: 600, color: COLOR.pageTitle }}>
        {match[1]}
      </strong>
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))

  return parts
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="my-5">
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide" style={{ color: COLOR.muted35 }}>
        {label}
      </div>
      <pre
        className="overflow-x-auto rounded-lg px-4 py-3.5 font-mono text-[13px]"
        style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.border08}`, color: COLOR.accentTitle, lineHeight: 1.6 }}
      >
        {code}
      </pre>
    </div>
  )
}

export interface LessonContentProps {
  blocks: ContentBlock[]
  quiz?: QuizQuestion[]
}

/** Renders the parsed `body_content` blocks, followed by any inline quiz questions. */
export function LessonContent({ blocks, quiz }: LessonContentProps) {
  return (
    <div>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading2':
            return (
              <h2
                key={index}
                id={block.id}
                className="mt-7 mb-3 text-[17px] font-medium scroll-mt-20"
                style={{ color: COLOR.pageTitle }}
              >
                {block.text}
              </h2>
            )
          case 'heading3':
            return (
              <h3 key={index} className="mt-6 mb-2 text-[15px] font-medium" style={{ color: COLOR.muted80 }}>
                {block.text}
              </h3>
            )
          case 'callout':
            return (
              <Callout key={index} variant={block.variant}>
                {renderInlineText(block.text, `callout-${index}`)}
              </Callout>
            )
          case 'code':
            return <CodeBlock key={index} code={block.code} label={block.label} />
          case 'paragraph':
          default:
            return (
              <p key={index} className="mb-5 text-[15px]" style={{ color: COLOR.muted60, lineHeight: 1.8 }}>
                {renderInlineText(block.text, `p-${index}`)}
              </p>
            )
        }
      })}

      {quiz?.map((question) => (
        <QuizBlock key={question.id} question={question} />
      ))}
    </div>
  )
}
