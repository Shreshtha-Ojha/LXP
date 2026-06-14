'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Hexagon, Plus, Search } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { BUILDER_COLORS as COLOR } from '@/components/path-builder/colors'
import { PathCard } from '@/components/path-builder/PathCard'
import { demoPaths } from '@/components/path-builder/mockData'
import { createId, type AdminPathSummary, type PathStatus } from '@/components/path-builder/types'

// TODO: route access for the path builder should come from the permission
// engine (CLAUDE.md Rule 1) — hardcoded here as a placeholder, mirrors
// ASSOCIATE_ROLE in Navbar.tsx / MANAGER_TIER_ROLES in lib/auth.ts.
const EXCLUDED_ROLES = ['associate', 'external']

type StatusFilter = 'all' | PathStatus

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
  { value: 'in_review', label: 'In review' },
  { value: 'retired', label: 'Retired' },
]

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 whitespace-nowrap rounded-full px-3.5 py-[5px] text-xs font-medium transition-colors"
      style={
        active
          ? { backgroundColor: COLOR.pillActiveBg, border: `0.5px solid ${COLOR.pillActiveBorder}`, color: COLOR.accentTitle }
          : { backgroundColor: COLOR.muted04, border: `0.5px solid ${COLOR.muted10}`, color: COLOR.muted45 }
      }
    >
      {children}
    </button>
  )
}

export default function AdminPathsPage() {
  const router = useRouter()
  const activeRole = useAuthStore((state) => state.activeRole)
  const user = useAuthStore((state) => state.user)
  const isExcluded = EXCLUDED_ROLES.includes(activeRole ?? '')

  useEffect(() => {
    if (isExcluded) router.replace('/dashboard')
  }, [isExcluded, router])

  const [paths, setPaths] = useState<AdminPathSummary[]>(demoPaths)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')

  const filteredPaths = useMemo(() => {
    const query = search.trim().toLowerCase()
    return paths.filter((path) => {
      if (statusFilter !== 'all' && path.status !== statusFilter) return false
      if (query && !path.title.toLowerCase().includes(query)) return false
      return true
    })
  }, [paths, statusFilter, search])

  const publishedCount = paths.filter((path) => path.status === 'published').length

  if (isExcluded) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  function handleDuplicate(path: AdminPathSummary) {
    const currentUserName =
      user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}` : user?.email ?? 'You'

    const duplicate: AdminPathSummary = {
      ...path,
      id: createId('path'),
      title: `${path.title} (copy)`,
      status: 'draft',
      created_by: currentUserName,
      created_at: new Date().toISOString().slice(0, 10),
    }

    setPaths((prev) => [duplicate, ...prev])
    void api.post(`/learning-paths/${path.id}/duplicate`).catch(() => {})
  }

  function handlePublish(path: AdminPathSummary) {
    setPaths((prev) => prev.map((p) => (p.id === path.id ? { ...p, status: 'published' as const } : p)))
    void api.post(`/learning-paths/${path.id}/publish`).catch(() => {})
  }

  function handleRetire(path: AdminPathSummary) {
    setPaths((prev) => prev.map((p) => (p.id === path.id ? { ...p, status: 'retired' as const } : p)))
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[22px] font-medium" style={{ color: COLOR.pageTitle }}>
            Learning paths
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: COLOR.muted35 }}>
            {paths.length} path{paths.length === 1 ? '' : 's'} · {publishedCount} published
          </p>
        </div>

        <Button onClick={() => router.push('/admin/paths/new')}>
          <Plus className="h-4 w-4" />
          Create path
        </Button>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto">
        {STATUS_FILTERS.map((filter) => (
          <FilterPill key={filter.value} active={statusFilter === filter.value} onClick={() => setStatusFilter(filter.value)}>
            {filter.label}
          </FilterPill>
        ))}
      </div>

      <div
        className="flex h-11 w-full items-center gap-2.5 rounded-[9px] px-3.5"
        style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.muted10}` }}
      >
        <Search className="h-4 w-4 shrink-0" style={{ color: COLOR.muted30 }} />
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search paths..."
          className="h-full flex-1 bg-transparent text-sm text-white placeholder:text-[rgba(255,255,255,0.3)] focus:outline-none"
        />
      </div>

      {filteredPaths.length === 0 ? (
        <EmptyState
          icon={Hexagon}
          heading="No learning paths found"
          subtext={search ? `No paths match "${search}"` : 'Create your first learning path to get started'}
          cta={{ label: '+ Create path', onClick: () => router.push('/admin/paths/new') }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredPaths.map((path) => (
            <PathCard key={path.id} path={path} onDuplicate={handleDuplicate} onPublish={handlePublish} onRetire={handleRetire} />
          ))}
        </div>
      )}
    </div>
  )
}
