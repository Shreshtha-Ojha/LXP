'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { api, getErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { Toast, type ToastState } from '@/components/ui/Toast'
import { BUILDER_COLORS as COLOR } from '@/components/path-builder/colors'
import { NodeList } from '@/components/path-builder/NodeList'
import { NodeEditorPanel } from '@/components/path-builder/NodeEditorPanel'
import { Step1Details } from '@/components/path-builder/Step1Details'
import { Step3Review } from '@/components/path-builder/Step3Review'
import { clearWizardDraft, loadWizardDraft, saveWizardDraft } from '@/components/path-builder/storage'
import { createEmptyPathState, toCreatePayload, type BuilderNode, type PathBuilderState } from '@/components/path-builder/types'

// TODO: route access for the path builder should come from the permission
// engine (CLAUDE.md Rule 1) — hardcoded here as a placeholder, mirrors
// EXCLUDED_ROLES in /admin/paths/page.tsx.
const EXCLUDED_ROLES = ['associate', 'external']

type WizardStep = 1 | 2 | 3

const STEPS: { step: WizardStep; label: string }[] = [
  { step: 1, label: 'Path details' },
  { step: 2, label: 'Add nodes' },
  { step: 3, label: 'Review & publish' },
]

export default function NewPathPage() {
  const router = useRouter()
  const activeRole = useAuthStore((s) => s.activeRole)
  const isExcluded = EXCLUDED_ROLES.includes(activeRole ?? '')

  useEffect(() => {
    if (isExcluded) router.replace('/dashboard')
  }, [isExcluded, router])

  const [step, setStep] = useState<WizardStep>(1)
  const [state, setState] = useState<PathBuilderState>(() => loadWizardDraft() ?? createEmptyPathState())
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)

  useEffect(() => {
    saveWizardDraft(state)
  }, [state])

  if (isExcluded) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  function updateState(patch: Partial<PathBuilderState>) {
    setState((prev) => ({ ...prev, ...patch }))
  }

  function updateNode(node: BuilderNode) {
    setState((prev) => ({ ...prev, nodes: prev.nodes.map((n) => (n.id === node.id ? node : n)) }))
  }

  function handleAddNode(node: BuilderNode) {
    setState((prev) => ({ ...prev, nodes: [...prev.nodes, node] }))
    setSelectedNodeId(node.id)
  }

  function handleDeleteNode(nodeId: string) {
    setState((prev) => ({ ...prev, nodes: prev.nodes.filter((n) => n.id !== nodeId) }))
    if (selectedNodeId === nodeId) setSelectedNodeId(null)
  }

  const selectedNode = state.nodes.find((n) => n.id === selectedNodeId) ?? null
  const titleError = !state.title.trim() ? 'Path title is required' : null

  function goNext() {
    if (step === 1 && titleError) return
    setError(null)
    setStep((s) => (s < 3 ? ((s + 1) as WizardStep) : s))
  }

  function goBack() {
    setError(null)
    setStep((s) => (s > 1 ? ((s - 1) as WizardStep) : s))
  }

  async function createPath(): Promise<{ id: string }> {
    const payload = toCreatePayload(state)
    const res = await api.post<{ id: string }>('/learning-paths', payload)
    return res.data
  }

  /** Brief pause so the success toast is visible before the redirect unmounts this page. */
  function redirectToPaths() {
    setTimeout(() => router.push('/admin/paths'), 800)
  }

  async function handleSaveDraft() {
    if (isSaving) return
    setIsSaving(true)
    setError(null)
    try {
      await createPath()
      clearWizardDraft()
      setToast({ type: 'info', message: 'Draft saved' })
      redirectToPaths()
    } catch (err) {
      setError(getErrorMessage(err))
      setIsSaving(false)
    }
  }

  async function handleSubmitForReview() {
    if (isSaving) return
    setIsSaving(true)
    setError(null)
    try {
      const created = await createPath()
      await api.post(`/learning-paths/${created.id}/submit-review`)
      clearWizardDraft()
      setToast({ type: 'success', message: 'Submitted for review — L&D Admin will be notified' })
      redirectToPaths()
    } catch (err) {
      setError(getErrorMessage(err))
      setIsSaving(false)
    }
  }

  async function handlePublish() {
    if (isSaving) return
    setIsSaving(true)
    setError(null)
    try {
      const created = await createPath()
      await api.post(`/learning-paths/${created.id}/publish`)
      clearWizardDraft()
      setToast({ type: 'success', message: 'Path published — learners can now find it' })
      redirectToPaths()
    } catch (err) {
      setError(getErrorMessage(err))
      setToast({ type: 'error', message: 'Failed to publish — please try again' })
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h1 className="text-[22px] font-medium" style={{ color: COLOR.pageTitle }}>
          Create learning path
        </h1>

        <div className="flex items-center">
          {STEPS.map((s, index) => {
            const isComplete = step > s.step
            const isActive = step === s.step
            return (
              <div key={s.step} className={index === 0 ? 'flex items-center' : 'flex flex-1 items-center'}>
                {index > 0 && (
                  <div className="h-px flex-1" style={{ backgroundColor: isComplete || isActive ? COLOR.accentBorder35 : COLOR.muted10 }} />
                )}
                <div className="flex items-center gap-2 px-2">
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium"
                    style={
                      isComplete
                        ? { backgroundColor: COLOR.green, color: '#0a0a0a' }
                        : isActive
                          ? { backgroundColor: COLOR.accent, color: '#ffffff' }
                          : { backgroundColor: COLOR.muted08, color: COLOR.muted35 }
                    }
                  >
                    {isComplete ? <Check className="h-3.5 w-3.5" /> : s.step}
                  </div>
                  <span className="text-xs font-medium whitespace-nowrap" style={{ color: isActive ? COLOR.pageTitle : COLOR.muted35 }}>
                    {s.label}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {step === 1 && <Step1Details state={state} onUpdate={updateState} />}

      {step === 2 && (
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1">
            <NodeList
              nodes={state.nodes}
              selectedNodeId={selectedNodeId}
              onReorder={(nodes) => updateState({ nodes })}
              onAddNode={handleAddNode}
              onSelectNode={setSelectedNodeId}
              onDeleteNode={handleDeleteNode}
            />
          </div>
          <NodeEditorPanel node={selectedNode} onChange={updateNode} onClose={() => setSelectedNodeId(null)} />
        </div>
      )}

      {step === 3 && (
        <Step3Review state={state} onPublish={handlePublish} onSubmitForReview={handleSubmitForReview} onSaveDraft={handleSaveDraft} />
      )}

      {error && (
        <p className="text-right text-[11px]" style={{ color: COLOR.red }}>
          {error}
        </p>
      )}

      {step < 3 && (
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={goBack} disabled={step === 1}>
            Back
          </Button>

          <div className="flex flex-col items-end gap-1">
            {step === 1 && titleError && (
              <span className="text-[11px]" style={{ color: COLOR.red }}>
                {titleError}
              </span>
            )}
            <Button onClick={goNext} disabled={step === 1 && !!titleError}>
              Next
            </Button>
          </div>
        </div>
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
