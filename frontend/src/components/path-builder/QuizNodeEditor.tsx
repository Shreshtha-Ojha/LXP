'use client'

import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { BUILDER_COLORS as COLOR } from './colors'
import { createQuestion, isQuestionValid, type BuilderNode, type BuilderQuestion } from './types'

const FIELD_INPUT_STYLE = { backgroundColor: COLOR.inputBg, border: `0.5px solid ${COLOR.inputBorder}` }

function QuestionEditor({
  draft,
  onChange,
  onSave,
  onCancel,
}: {
  draft: BuilderQuestion
  onChange: (next: BuilderQuestion) => void
  onSave: () => void
  onCancel: () => void
}) {
  const correctIndex = draft.options.findIndex((option) => option.isCorrect)

  function setOptionCorrect(optionId: string) {
    onChange({
      ...draft,
      options: draft.options.map((option) => ({ ...option, isCorrect: option.id === optionId })),
    })
  }

  function setOptionText(optionId: string, text: string) {
    onChange({
      ...draft,
      options: draft.options.map((option) => (option.id === optionId ? { ...option, text } : option)),
    })
  }

  return (
    <div className="flex flex-col gap-3 rounded-[10px] p-4" style={{ backgroundColor: COLOR.accentBg06, border: `0.5px solid ${COLOR.accentBorder}` }}>
      <textarea
        rows={2}
        value={draft.questionText}
        onChange={(event) => onChange({ ...draft, questionText: event.target.value })}
        placeholder="Enter the question..."
        className="w-full resize-none rounded-md px-3 py-2 text-sm text-white placeholder:text-[rgba(255,255,255,0.3)] focus:outline-none"
        style={FIELD_INPUT_STYLE}
      />

      <div className="flex flex-col gap-2">
        {draft.options.map((option, index) => (
          <div key={option.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOptionCorrect(option.id)}
              aria-label={`Mark option ${index + 1} as correct`}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
              style={{ border: `2px solid ${option.isCorrect ? COLOR.green : COLOR.muted20}` }}
            >
              {option.isCorrect && <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLOR.green }} />}
            </button>
            <input
              type="text"
              value={option.text}
              onChange={(event) => setOptionText(option.id, event.target.value)}
              placeholder={`Option ${index + 1}`}
              className="h-9 flex-1 rounded-md px-3 text-sm text-white placeholder:text-[rgba(255,255,255,0.3)] focus:outline-none"
              style={{ backgroundColor: COLOR.inputBg, border: `0.5px solid ${option.isCorrect ? COLOR.green : COLOR.inputBorder}` }}
            />
          </div>
        ))}
      </div>

      {correctIndex >= 0 ? (
        <p className="text-[11px]" style={{ color: COLOR.green }}>
          ✓ Option {correctIndex + 1} is marked as correct
        </p>
      ) : (
        <p className="text-[11px]" style={{ color: COLOR.red }}>
          No correct answer selected
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={!isQuestionValid(draft)}
          className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
          style={{ backgroundColor: COLOR.accent, color: '#ffffff' }}
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
          style={{ color: COLOR.muted45, backgroundColor: COLOR.muted04, border: `0.5px solid ${COLOR.muted10}` }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function QuestionRow({
  question,
  index,
  onEdit,
  onDelete,
}: {
  question: BuilderQuestion
  index: number
  onEdit: () => void
  onDelete: () => void
}) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const correctOption = question.options.find((option) => option.isCorrect)

  return (
    <div className="flex items-start gap-3 rounded-[10px] p-3" style={{ backgroundColor: COLOR.muted03, border: `0.5px solid ${COLOR.muted08}` }}>
      <span className="w-5 shrink-0 text-xs font-medium" style={{ color: COLOR.muted30 }}>
        {String(index + 1).padStart(2, '0')}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm" style={{ color: COLOR.pageTitle }}>
          {question.questionText.trim() || 'Untitled question'}
        </p>
        {correctOption ? (
          <p className="mt-0.5 text-[11px]" style={{ color: COLOR.muted35 }}>
            Correct: {correctOption.text.trim() || `Option ${question.options.indexOf(correctOption) + 1}`}
          </p>
        ) : (
          <p className="mt-0.5 text-[11px]" style={{ color: COLOR.red }}>
            No correct answer selected
          </p>
        )}
      </div>

      {isConfirmingDelete ? (
        <div className="flex shrink-0 items-center gap-2 text-[11px]">
          <span style={{ color: COLOR.muted35 }}>Delete?</span>
          <button type="button" onClick={onDelete} className="font-medium" style={{ color: COLOR.red }}>
            Yes
          </button>
          <button type="button" onClick={() => setIsConfirmingDelete(false)} style={{ color: COLOR.muted35 }}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Edit question"
            onClick={onEdit}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[rgba(255,255,255,0.06)]"
            style={{ color: COLOR.muted30 }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Delete question"
            onClick={() => setIsConfirmingDelete(true)}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[rgba(255,255,255,0.06)]"
            style={{ color: COLOR.muted30 }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

export interface QuizNodeEditorProps {
  node: BuilderNode
  onChange: (node: BuilderNode) => void
}

export function QuizNodeEditor({ node, onChange }: QuizNodeEditorProps) {
  const [draft, setDraft] = useState<BuilderQuestion | null>(null)

  const isAddingNew = draft !== null && !node.questions.some((question) => question.id === draft.id)

  function startAdd() {
    setDraft(createQuestion())
  }

  function startEdit(question: BuilderQuestion) {
    setDraft({ ...question, options: question.options.map((option) => ({ ...option })) })
  }

  function cancelEdit() {
    setDraft(null)
  }

  function saveEdit() {
    if (!draft) return
    const exists = node.questions.some((question) => question.id === draft.id)
    const questions = exists
      ? node.questions.map((question) => (question.id === draft.id ? draft : question))
      : [...node.questions, draft]
    onChange({ ...node, questions })
    setDraft(null)
  }

  function removeQuestion(questionId: string) {
    onChange({ ...node, questions: node.questions.filter((question) => question.id !== questionId) })
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
          placeholder="Knowledge check"
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
          Coins are awarded to learners when they pass this knowledge check
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium" style={{ color: COLOR.muted50 }}>
            Questions
          </label>
          {!draft && (
            <button
              type="button"
              onClick={startAdd}
              className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
              style={{ color: COLOR.accentTitle, backgroundColor: COLOR.accentBg06, border: `0.5px solid ${COLOR.accentBorder}` }}
            >
              + Add question
            </button>
          )}
        </div>

        {node.questions.length === 0 && !draft && (
          <div className="rounded-[10px] p-4 text-center text-[11px]" style={{ backgroundColor: COLOR.muted03, border: `0.5px solid ${COLOR.muted08}`, color: COLOR.muted35 }}>
            No questions yet. Add at least one question to this knowledge check.
          </div>
        )}

        <div className="flex flex-col gap-2">
          {node.questions.map((question, index) =>
            draft && draft.id === question.id ? (
              <QuestionEditor key={question.id} draft={draft} onChange={setDraft} onSave={saveEdit} onCancel={cancelEdit} />
            ) : (
              <QuestionRow
                key={question.id}
                question={question}
                index={index}
                onEdit={() => startEdit(question)}
                onDelete={() => removeQuestion(question.id)}
              />
            )
          )}

          {isAddingNew && draft && (
            <QuestionEditor draft={draft} onChange={setDraft} onSave={saveEdit} onCancel={cancelEdit} />
          )}
        </div>
      </div>
    </div>
  )
}
