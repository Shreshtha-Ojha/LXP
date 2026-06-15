'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { AlertCircle, ArrowLeft, Pencil } from 'lucide-react'
import { api, getErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { useCanPublish } from '@/hooks/useCanPublish'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { Toast, type ToastState } from '@/components/ui/Toast'
import { BUILDER_COLORS as COLOR } from '@/components/path-builder/colors'
import { NodeList } from '@/components/path-builder/NodeList'
import { NodeEditorPanel } from '@/components/path-builder/NodeEditorPanel'
import { STATUS_BADGE_STYLES } from '@/components/path-builder/PathCard'
import { getMockPathState, getMockPathSummary } from '@/components/path-builder/mockData'
import { loadCanvasDraft, saveCanvasDraft } from '@/components/path-builder/storage'
import { createEmptyPathState, toCreatePayload, type BuilderNode, type PathBuilderState, type PathStatus } from '@/components/path-builder/types'

// TODO: route access for the path builder should come from the permission
// engine (CLAUDE.md Rule 1) — hardcoded here as a placeholder, mirrors
// EXCLUDED_ROLES in /admin/paths/page.tsx.
const EXCLUDED_ROLES = ['associate', 'external']

type SaveStatus = 'idle' | 'saving' | 'saved'

function buildInitialState(pathId: string, summary: { title: string; description: string } | null): PathBuilderState {
  const draft = loadCanvasDraft(pathId)
  if (draft) return draft

  const mock = getMockPathState(pathId)
  if (mock) return mock

  if (summary) {
    return { ...createEmptyPathState(), title: summary.title, description: summary.description }
  }

  return createEmptyPathState()
}

export default function EditPathPage() {
  const { pathId } = useParams<{ pathId: string }>()
  const router = useRouter()
  const activeRole = useAuthStore((s) => s.activeRole)
  const { canPublish } = useCanPublish()
  const isExcluded = EXCLUDED_ROLES.includes(activeRole ?? '')

  useEffect(() => {
    if (isExcluded) router.replace('/dashboard')
  }, [isExcluded, router])

  const summary = getMockPathSummary(pathId)
  const notFound = !summary && !loadCanvasDraft(pathId) && !getMockPathState(pathId)

  const [state, setState] = useState<PathBuilderState>(() => buildInitialState(pathId, summary))
  const [status, setStatus] = useState<PathStatus>(summary?.status ?? 'draft')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)

  const editorRef = useRef<HTMLDivElement>(null)
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    setSaveStatus('saving')
    const timer = setTimeout(() => {
      saveCanvasDraft(pathId, state)
      setSaveStatus('saved')
    }, 1000)
    return () => clearTimeout(timer)
  }, [state, pathId])

  if (isExcluded) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  if (notFound) {
    return (
      <EmptyState
        icon={AlertCircle}
        heading="Path not found"
        subtext="This learning path doesn't exist."
        cta={{ label: 'Back to learning paths', onClick: () => router.push('/admin/paths') }}
      />
    )
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

  async function handleSave() {
    if (isSaving) return
    setIsSaving(true)
    setError(null)
    try {
      await api.put(`/learning-paths/${pathId}`, toCreatePayload(state))
      saveCanvasDraft(pathId, state)
      setSaveStatus('saved')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsSaving(false)
    }
  }

  async function handlePublish() {
    if (isSaving) return
    setIsSaving(true)
    setError(null)
    try {
      await api.post(`/learning-paths/${pathId}/publish`)
      setStatus('published')
      setToast({ type: 'success', message: 'Path published — learners can now find it' })
    } catch (err) {
      setError(getErrorMessage(err))
      setToast({ type: 'error', message: 'Failed to publish — please try again' })
    } finally {
      setIsSaving(false)
    }
  }

  async function handleSubmitForReview() {
    if (isSaving) return
    setIsSaving(true)
    setError(null)
    try {
      await api.post(`/learning-paths/${pathId}/submit-review`)
      setStatus('in_review')
      setToast({ type: 'success', message: 'Submitted for review — L&D Admin will be notified' })
    } catch (err) {
      setError(getErrorMessage(err))
      setToast({ type: 'error', message: 'Failed to submit for review — please try again' })
    } finally {
      setIsSaving(false)
    }
  }

  function handleRetire() {
    setStatus('retired')
  }

  const selectedNode = state.nodes.find((n) => n.id === selectedNodeId) ?? null
  const badge = STATUS_BADGE_STYLES[status]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/admin/paths"
            aria-label="Back to learning paths"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[rgba(255,255,255,0.06)]"
            style={{ color: COLOR.muted35 }}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>

          <h1 className="min-w-0 truncate text-[20px] font-medium" style={{ color: COLOR.pageTitle }}>
            {state.title.trim() || 'Untitled path'}
          </h1>

          <span
            className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{ backgroundColor: badge.bg, color: badge.color }}
            title={status === 'in_review' && !canPublish ? 'Awaiting L&D Admin review' : undefined}
          >
            {badge.label}
          </span>

          <div className="flex-1" />

          {saveStatus === 'saving' && (
            <span className="flex items-center gap-1.5 text-[11px]" style={{ color: COLOR.muted35 }}>
              <Spinner className="h-3 w-3" />
              Saving...
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1.5 text-[11px]" style={{ color: COLOR.muted35 }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: COLOR.green }} />
              Saved
            </span>
          )}

          <Button variant="ghost" onClick={handleSave} disabled={isSaving}>
            Save
          </Button>

          {status === 'draft' && canPublish && (
            <Button onClick={handlePublish} disabled={isSaving}>
              Publish
            </Button>
          )}

          {status === 'draft' && !canPublish && (
            <Button onClick={handleSubmitForReview} disabled={isSaving}>
              Submit for review
            </Button>
          )}

          {status === 'in_review' && canPublish && (
            <button
              type="button"
              onClick={handlePublish}
              disabled={isSaving}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-opacity disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #4ade80, #22c55e)', color: '#ffffff' }}
            >
              Approve & publish
            </button>
          )}

          {status === 'published' && canPublish && (
            <button
              type="button"
              onClick={handleRetire}
              disabled={isSaving}
              className="inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors hover:bg-[rgba(248,113,113,0.08)] disabled:opacity-50"
              style={{ border: '0.5px solid rgba(248,113,113,0.3)', color: '#f87171' }}
            >
              Retire
            </button>
          )}
        </div>

        {error && (
          <p className="text-[11px]" style={{ color: COLOR.red }}>
            {error}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1">
          <NodeList
            nodes={state.nodes}
            selectedNodeId={selectedNodeId}
            onReorder={(nodes) => setState((prev) => ({ ...prev, nodes }))}
            onAddNode={handleAddNode}
            onSelectNode={setSelectedNodeId}
            onDeleteNode={handleDeleteNode}
          />
        </div>
        <div ref={editorRef}>
          <NodeEditorPanel node={selectedNode} onChange={updateNode} onClose={() => setSelectedNodeId(null)} />
        </div>
      </div>

      {selectedNode && (
        <button
          type="button"
          onClick={() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="fixed bottom-6 right-6 z-30 flex items-center gap-2 rounded-full px-4 py-3 text-sm font-medium shadow-lg lg:hidden"
          style={{ backgroundColor: COLOR.accent, color: '#ffffff' }}
        >
          <Pencil className="h-4 w-4" />
          Edit node
        </button>
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
