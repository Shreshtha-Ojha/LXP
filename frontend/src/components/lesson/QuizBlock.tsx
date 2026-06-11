'use client'

import { useState } from 'react'
import { Callout } from './Callout'
import { LESSON_COLORS as COLOR } from './colors'
import type { QuizQuestion } from './types'

export function QuizBlock({ question }: { question: QuizQuestion }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const selectedOption = question.options.find((option) => option.id === selectedId)

  return (
    <div
      className="my-5 rounded-[9px] px-[1.125rem] py-4"
      style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.accentBorder2}` }}
    >
      <div className="text-[10px] font-medium uppercase tracking-wide" style={{ color: COLOR.accentText60 }}>
        Quick check · 1 question
      </div>

      <p className="mt-2 mb-3.5 text-[14px]" style={{ color: COLOR.muted70, lineHeight: 1.6 }}>
        {question.question}
      </p>

      <div className="flex flex-col gap-2">
        {question.options.map((option) => {
          const isSelected = option.id === selectedId
          let borderColor: string = COLOR.border07
          let backgroundColor: string = COLOR.muted02

          if (isSelected) {
            borderColor = option.is_correct ? COLOR.greenBorder3 : COLOR.redBorder3
            backgroundColor = option.is_correct ? COLOR.greenBg04 : COLOR.redBg04
          } else if (hoveredId === option.id && selectedId === null) {
            borderColor = COLOR.accentBorder3
          }

          return (
            <button
              key={option.id}
              type="button"
              disabled={selectedId !== null}
              onClick={() => setSelectedId(option.id)}
              onMouseEnter={() => setHoveredId(option.id)}
              onMouseLeave={() => setHoveredId(null)}
              className="flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-left transition-colors disabled:cursor-default"
              style={{ backgroundColor, border: `0.5px solid ${borderColor}` }}
            >
              <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ border: `1.5px solid ${COLOR.muted20}` }} />
              <span className="text-[13px]" style={{ color: COLOR.muted50 }}>
                {option.text}
              </span>
            </button>
          )
        })}
      </div>

      {selectedOption && <Callout variant={selectedOption.is_correct ? 'tip' : 'info'}>{question.explanation}</Callout>}
    </div>
  )
}
