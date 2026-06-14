'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Clock, Hexagon, MoreVertical } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/lib/utils'
import { SkillChip } from '@/components/ui/SkillChip'
import { BUILDER_COLORS as COLOR } from './colors'
import { formatDuration, type AdminPathSummary, type PathStatus } from './types'

// TODO: same placeholder as ASSOCIATE_ROLE in Navbar.tsx — the
// "who can publish a path" rule should come from the permission engine
// (CLAUDE.md Rule 1), not a literal role check.
const LD_ADMIN_ROLE = 'ld_admin'

export const STATUS_BADGE_STYLES: Record<PathStatus, { bg: string; color: string; label: string }> = {
  published: { bg: 'rgba(74,222,128,0.1)', color: '#4ade80', label: 'Published' },
  draft: { bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)', label: 'Draft' },
  in_review: { bg: 'rgba(245,158,11,0.1)', color: '#f59e0b', label: 'In review' },
  retired: { bg: 'rgba(248,113,113,0.1)', color: '#f87171', label: 'Retired' },
}

const MENU_ITEM_CLASS =
  'flex w-full cursor-pointer items-center rounded-sm px-2.5 py-1.5 text-left text-[12px] outline-none transition-colors hover:bg-[rgba(255,255,255,0.04)]'

export interface PathCardProps {
  path: AdminPathSummary
  onDuplicate: (path: AdminPathSummary) => void
  onPublish: (path: AdminPathSummary) => void
  onRetire: (path: AdminPathSummary) => void
}

export function PathCard({ path, onDuplicate, onPublish, onRetire }: PathCardProps) {
  const router = useRouter()
  const activeRole = useAuthStore((state) => state.activeRole)

  const badge = STATUS_BADGE_STYLES[path.status]
  const visibleSkills = path.skills.slice(0, 3)
  const extraSkillCount = path.skills.length - visibleSkills.length

  const showPublish = (path.status === 'draft' || path.status === 'in_review') && activeRole === LD_ADMIN_ROLE
  const showRetire = path.status === 'published'

  const editHref = `/admin/paths/${path.id}/edit`

  return (
    <div
      className="flex flex-col rounded-[10px] border-[0.5px] border-[rgba(255,255,255,0.07)] p-5 transition-colors hover:border-[rgba(255,255,255,0.12)]"
      style={{ backgroundColor: COLOR.card }}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{ backgroundColor: badge.bg, color: badge.color }}
        >
          {badge.label}
        </span>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label={`Actions for ${path.title}`}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[rgba(255,255,255,0.06)]"
              style={{ color: COLOR.muted30 }}
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-20 min-w-[160px] rounded-md p-1"
              style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.inputBorder}` }}
            >
              <DropdownMenu.Item
                className={MENU_ITEM_CLASS}
                style={{ color: COLOR.muted45 }}
                onSelect={() => router.push(editHref)}
              >
                Edit
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={MENU_ITEM_CLASS}
                style={{ color: COLOR.muted45 }}
                onSelect={() => window.open(`/learn/paths/${path.id}`, '_blank')}
              >
                Preview
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={MENU_ITEM_CLASS}
                style={{ color: COLOR.muted45 }}
                onSelect={() => onDuplicate(path)}
              >
                Duplicate
              </DropdownMenu.Item>

              {(showPublish || showRetire) && (
                <DropdownMenu.Separator className="my-1 h-px" style={{ backgroundColor: COLOR.muted07 }} />
              )}

              {showPublish && (
                <DropdownMenu.Item
                  className={MENU_ITEM_CLASS}
                  style={{ color: COLOR.green }}
                  onSelect={() => onPublish(path)}
                >
                  Publish
                </DropdownMenu.Item>
              )}

              {showRetire && (
                <DropdownMenu.Item
                  className={MENU_ITEM_CLASS}
                  style={{ color: COLOR.red }}
                  onSelect={() => onRetire(path)}
                >
                  Retire
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <h3 className="mt-3 text-[15px] font-medium" style={{ color: COLOR.pageTitle }}>
        {path.title}
      </h3>

      <p className="mt-1.5 line-clamp-2 text-xs" style={{ color: COLOR.muted40 }}>
        {path.description}
      </p>

      <div className="mt-3 flex items-center gap-3 text-xs" style={{ color: COLOR.muted35 }}>
        <span className="flex items-center gap-1">
          <Hexagon className="h-3 w-3" />
          {path.node_count} node{path.node_count === 1 ? '' : 's'}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {formatDuration(path.duration_minutes)}
        </span>
        <span className="flex items-center gap-1" style={{ color: COLOR.amber }}>
          💰 {path.total_coins}
        </span>
      </div>

      {visibleSkills.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {visibleSkills.map((skill) => (
            <SkillChip key={skill} status="unvalidated">
              {skill}
            </SkillChip>
          ))}
          {extraSkillCount > 0 && (
            <span className="text-xs" style={{ color: COLOR.muted30 }}>
              +{extraSkillCount} more
            </span>
          )}
        </div>
      )}

      <div
        className={cn(
          'mt-4 flex items-center justify-between border-t-[0.5px] pt-3 text-xs',
          'border-[rgba(255,255,255,0.05)]'
        )}
      >
        <span style={{ color: COLOR.muted35 }}>Created by {path.created_by}</span>
        <Link href={editHref} className="font-medium" style={{ color: COLOR.accentTitle }}>
          {path.status === 'published' ? 'View analytics →' : 'Edit →'}
        </Link>
      </div>
    </div>
  )
}
