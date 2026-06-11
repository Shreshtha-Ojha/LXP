'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { AlertCircle, ChevronLeft, ChevronRight, Inbox, Sparkles, Upload } from 'lucide-react'
import { api, getErrorMessage } from '@/lib/api'
import { useAuthStore } from '@/store/authStore'
import { useDebounce } from '@/lib/useDebounce'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { CourseCard } from '@/components/catalogue/CourseCard'
import { CourseCardSkeleton } from '@/components/catalogue/CourseCardSkeleton'
import { CourseRow } from '@/components/catalogue/CourseRow'
import { SearchBar } from '@/components/catalogue/SearchBar'
import { FilterPills, type ContentTypeFilter, type ProficiencyFilter } from '@/components/catalogue/FilterPills'
import { CATALOGUE_COLORS as COLOR } from '@/components/catalogue/colors'
import { assetToCourse, assignmentToCourse, progressToCourse } from '@/components/catalogue/mappers'
import type {
  ApiAssignment,
  ApiLearningAsset,
  ApiProgressItem,
  AssignmentsResponse,
  CatalogBrowseResponse,
  CatalogSearchResponse,
  CatalogueCourse,
  ProgressResponse,
} from '@/components/catalogue/types'

// TODO: page-level "Upload content" visibility should come from the
// permission engine (CLAUDE.md Rule 1: no hardcoded role names). Hardcoded
// here as a placeholder until that config exists — mirrors Navbar.tsx.
const LD_ADMIN_ROLE = 'ld_admin'

const SEARCH_PAGE_SIZE_FALLBACK = 20
const SKELETON_COUNT = 6

interface SearchParams {
  q?: string
  content_type?: string
  page?: number
}

async function fetchBrowse(): Promise<CatalogBrowseResponse> {
  const { data } = await api.get<CatalogBrowseResponse>('/catalog/browse')
  return data
}

async function fetchSearch(params: SearchParams): Promise<CatalogSearchResponse> {
  const { data } = await api.get<CatalogSearchResponse>('/catalog/search', { params })
  return data
}

async function fetchAssignments(): Promise<AssignmentsResponse> {
  const { data } = await api.get<AssignmentsResponse>('/assignments/me')
  return data
}

async function fetchProgress(): Promise<ProgressResponse> {
  const { data } = await api.get<ProgressResponse>('/progress/me')
  return data
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: SKELETON_COUNT }).map((_, index) => (
        <CourseCardSkeleton key={index} />
      ))}
    </div>
  )
}

export default function LearnPage() {
  const router = useRouter()
  const isLdAdmin = useAuthStore((state) => state.activeRole) === LD_ADMIN_ROLE

  const [query, setQuery] = useState('')
  const [contentTypeFilter, setContentTypeFilter] = useState<ContentTypeFilter>('all')
  const [proficiencyFilter, setProficiencyFilter] = useState<ProficiencyFilter | null>(null)
  const [page, setPage] = useState(1)

  const debouncedQuery = useDebounce(query, 300)
  const trimmedQuery = debouncedQuery.trim()
  const isFiltering = trimmedQuery !== '' || contentTypeFilter !== 'all' || proficiencyFilter !== null

  // Any filter change starts the result set over from page 1.
  useEffect(() => {
    setPage(1)
  }, [trimmedQuery, contentTypeFilter, proficiencyFilter])

  const browseQuery = useQuery({ queryKey: ['catalog-browse'], queryFn: fetchBrowse })
  const assignmentsQuery = useQuery({ queryKey: ['assignments-me'], queryFn: fetchAssignments })
  const progressQuery = useQuery({ queryKey: ['progress-me'], queryFn: fetchProgress })

  // Unfiltered total powers the "X courses across Y skill domains" subtitle,
  // kept separate from the filtered search below so applying a filter
  // doesn't change the headline count.
  const catalogTotalQuery = useQuery({ queryKey: ['catalog-total'], queryFn: () => fetchSearch({}) })

  const searchResultsQuery = useQuery({
    queryKey: ['catalog-search', trimmedQuery, contentTypeFilter, page],
    queryFn: () =>
      fetchSearch({
        q: trimmedQuery || undefined,
        content_type: contentTypeFilter !== 'all' ? contentTypeFilter : undefined,
        page,
      }),
    enabled: isFiltering,
    placeholderData: keepPreviousData,
  })

  // Every asset seen across browse + search responses, so progress/assignment
  // rows (which only carry an assetId) can be enriched with title, duration,
  // skills, etc.
  const assetIndex = useMemo(() => {
    const map = new Map<string, ApiLearningAsset>()
    const addAll = (assets?: ApiLearningAsset[]) => assets?.forEach((asset) => map.set(asset.id, asset))

    addAll(browseQuery.data?.recently_added)
    addAll(browseQuery.data?.recommended)
    browseQuery.data?.by_skill.forEach((group) => addAll(group.assets))
    addAll(searchResultsQuery.data?.results)

    return map
  }, [browseQuery.data, searchResultsQuery.data])

  const progressByAssetId = useMemo(() => {
    const map = new Map<string, ApiProgressItem>()
    progressQuery.data?.progress.forEach((item) => map.set(item.assetId, item))
    return map
  }, [progressQuery.data])

  const assignmentByAssetId = useMemo(() => {
    const map = new Map<string, ApiAssignment>()
    assignmentsQuery.data?.assignments.forEach((assignment) => {
      if (assignment.assetId) map.set(assignment.assetId, assignment)
    })
    return map
  }, [assignmentsQuery.data])

  const continueLearning = useMemo(() => {
    const inProgress =
      progressQuery.data?.progress.filter((item) => item.status === 'in_progress' || item.status === 'started') ?? []
    return inProgress.map((item) => progressToCourse(item, assetIndex.get(item.assetId)))
  }, [progressQuery.data, assetIndex])

  const assignedToYou = useMemo(() => {
    const assignments = assignmentsQuery.data?.assignments ?? []
    const courses: CatalogueCourse[] = []

    for (const assignment of assignments) {
      if (!assignment.assetId || assignment.status === 'completed') continue
      const course = assignmentToCourse(
        assignment,
        assetIndex.get(assignment.assetId),
        progressByAssetId.get(assignment.assetId)
      )
      if (course) courses.push(course)
    }

    return courses
  }, [assignmentsQuery.data, assetIndex, progressByAssetId])

  const recommended = useMemo(
    () =>
      (browseQuery.data?.recommended ?? []).map((asset) =>
        assetToCourse(asset, { progress: progressByAssetId.get(asset.id), assignment: assignmentByAssetId.get(asset.id) })
      ),
    [browseQuery.data, progressByAssetId, assignmentByAssetId]
  )

  const recentlyAdded = useMemo(
    () =>
      (browseQuery.data?.recently_added ?? []).map((asset) =>
        assetToCourse(asset, { progress: progressByAssetId.get(asset.id), assignment: assignmentByAssetId.get(asset.id) })
      ),
    [browseQuery.data, progressByAssetId, assignmentByAssetId]
  )

  const searchResults = useMemo(() => {
    const results = (searchResultsQuery.data?.results ?? []).map((asset) =>
      assetToCourse(asset, { progress: progressByAssetId.get(asset.id), assignment: assignmentByAssetId.get(asset.id) })
    )
    // Proficiency is filtered client-side: /catalog/search takes a
    // proficiency_level_id, and resolving "Beginner"/"Intermediate"/"Advanced"
    // to an id isn't part of the documented data wiring for this screen.
    if (!proficiencyFilter) return results
    return results.filter((course) => course.proficiency_level === proficiencyFilter)
  }, [searchResultsQuery.data, progressByAssetId, assignmentByAssetId, proficiencyFilter])

  const totalCourses = catalogTotalQuery.data?.total ?? 0
  const skillDomainCount = browseQuery.data?.by_skill.length ?? 0
  const subtitleLoading = catalogTotalQuery.isLoading || browseQuery.isLoading

  const isSearching = trimmedQuery !== '' && searchResultsQuery.isFetching

  const resultsTotal = searchResultsQuery.data?.total ?? 0
  const resultsLimit = searchResultsQuery.data?.limit ?? SEARCH_PAGE_SIZE_FALLBACK
  const hasPrevPage = page > 1
  const hasNextPage = page * resultsLimit < resultsTotal

  const resultsLabel = trimmedQuery
    ? `${searchResults.length} result${searchResults.length === 1 ? '' : 's'} for '${trimmedQuery}'`
    : `${searchResults.length} result${searchResults.length === 1 ? '' : 's'}`

  return (
    <div className="flex flex-col gap-6">
      {/* Section 1 — page header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[22px] font-medium" style={{ color: COLOR.pageTitle }}>
            Learn
          </h1>
          {subtitleLoading ? (
            <div className="mt-2 h-[13px] w-52 animate-pulse rounded" style={{ backgroundColor: COLOR.muted07 }} />
          ) : (
            <p className="mt-1 text-[13px]" style={{ color: COLOR.muted35 }}>
              {totalCourses} course{totalCourses === 1 ? '' : 's'} across {skillDomainCount} skill domain
              {skillDomainCount === 1 ? '' : 's'}
            </p>
          )}
        </div>

        {isLdAdmin && (
          <Button variant="ghost" size="sm" onClick={() => router.push('/content/upload')}>
            <Upload className="h-4 w-4" />
            Upload content
          </Button>
        )}
      </div>

      {/* Section 2 — search bar */}
      <SearchBar value={query} onChange={setQuery} isSearching={isSearching} />

      {/* Section 3 — filter pills */}
      <FilterPills
        contentType={contentTypeFilter}
        onContentTypeChange={setContentTypeFilter}
        proficiency={proficiencyFilter}
        onProficiencyChange={setProficiencyFilter}
      />

      {isFiltering ? (
        // Section 5 — search results
        <section className="flex flex-col gap-4">
          {searchResultsQuery.isLoading ? (
            <div className="h-[13px] w-32 animate-pulse rounded" style={{ backgroundColor: COLOR.muted07 }} />
          ) : (
            <p className="text-[13px]" style={{ color: COLOR.muted35 }}>
              {resultsLabel}
            </p>
          )}

          {searchResultsQuery.isLoading ? (
            <SkeletonGrid />
          ) : searchResultsQuery.isError ? (
            <EmptyState
              icon={AlertCircle}
              heading="Couldn't load search results"
              subtext={getErrorMessage(searchResultsQuery.error)}
            />
          ) : searchResults.length === 0 ? (
            <EmptyState
              icon={Inbox}
              heading={trimmedQuery ? `No courses found for '${trimmedQuery}'` : 'No courses match these filters'}
              subtext="Try different keywords or browse by skill"
            />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {searchResults.map((course) => (
                  <CourseCard key={course.id} course={course} />
                ))}
              </div>

              <div className="mt-2 flex items-center justify-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!hasPrevPage || searchResultsQuery.isFetching}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!hasNextPage || searchResultsQuery.isFetching}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </section>
      ) : browseQuery.isError ? (
        <EmptyState icon={AlertCircle} heading="Couldn't load the catalogue" subtext={getErrorMessage(browseQuery.error)} />
      ) : (
        // Section 4 — browse sections
        <>
          <CourseRow title="Continue learning" courses={continueLearning} isLoading={progressQuery.isLoading} />

          <CourseRow
            title="Assigned to you"
            courses={assignedToYou}
            isLoading={assignmentsQuery.isLoading}
            emptyState={
              <EmptyState icon={Inbox} heading="Nothing assigned yet" subtext="Browse the catalogue to start learning" />
            }
          />

          <CourseRow title="Recommended for you" courses={recommended} isLoading={browseQuery.isLoading} />

          {(browseQuery.isLoading || recentlyAdded.length > 0 || isLdAdmin) && (
            <section>
              <h2 className="mb-3 text-[15px] font-medium text-fg">Recently added</h2>
              {browseQuery.isLoading ? (
                <SkeletonGrid />
              ) : recentlyAdded.length === 0 ? (
                <EmptyState
                  icon={Sparkles}
                  heading="No content yet"
                  cta={{ label: 'Upload content', onClick: () => router.push('/content/upload') }}
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {recentlyAdded.map((course) => (
                    <CourseCard key={course.id} course={course} />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
