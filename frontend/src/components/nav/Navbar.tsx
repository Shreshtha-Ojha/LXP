'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell, ChevronDown } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useAuthStore } from '@/store/authStore'
import { type AuthUser } from '@/lib/auth'
import { cn } from '@/lib/utils'

// TODO: nav visibility should be driven by the permission engine / a
// configurable nav-item record (CLAUDE.md Rule 1: no hardcoded role names).
// Hardcoded here as a placeholder until that config exists.
const ASSOCIATE_ROLE = 'associate'

const NAV_ITEMS = [
  { label: 'Home', href: '/dashboard' },
  { label: 'Learn', href: '/learn' },
  { label: 'My Growth', href: '/growth' },
  { label: 'Team', href: '/team' },
] as const

function formatRoleName(role: string): string {
  return role.replace(/_/g, ' ')
}

function getInitials(user: AuthUser | null): string {
  if (!user) return '?'
  if (user.firstName && user.lastName) {
    return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
  }
  return user.email.slice(0, 2).toUpperCase()
}

export function Navbar() {
  const pathname = usePathname()
  const user = useAuthStore((state) => state.user)
  const activeRole = useAuthStore((state) => state.activeRole)
  const availableRoles = useAuthStore((state) => state.availableRoles)
  const switchRole = useAuthStore((state) => state.switchRole)

  const visibleNavItems = NAV_ITEMS.filter(
    (item) => item.label !== 'Team' || activeRole !== ASSOCIATE_ROLE
  )

  return (
    <header className="sticky top-0 z-10 border-b-hairline border-border bg-bg">
      <div className="flex h-14 items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <Link href="/dashboard" className="text-sm font-semibold tracking-wide text-fg">
            SG LXP
          </Link>

          <nav className="flex items-center gap-1">
            {visibleNavItems.map((item) => {
              const isActive = pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'relative px-3 py-2 text-sm transition-colors',
                    isActive ? 'text-fg' : 'text-fg-muted hover:text-fg'
                  )}
                >
                  {item.label}
                  {isActive && (
                    <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-accent" />
                  )}
                </Link>
              )
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {activeRole &&
            (availableRoles.length > 1 ? (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    className="flex cursor-pointer items-center gap-1 rounded-full border-hairline border-border bg-surface px-2.5 py-1 text-xs font-medium capitalize text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
                  >
                    {formatRoleName(activeRole)}
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenu.Trigger>

                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={8}
                    className="z-20 min-w-40 rounded-md border-hairline border-border bg-elevated p-1 shadow-lg"
                  >
                    {availableRoles.map((role) => (
                      <DropdownMenu.Item
                        key={role}
                        onSelect={() => {
                          if (role !== activeRole) void switchRole(role)
                        }}
                        className={cn(
                          'flex cursor-pointer items-center justify-between rounded-sm px-2.5 py-1.5 text-sm capitalize text-fg-muted outline-none transition-colors hover:bg-surface-hover hover:text-fg',
                          role === activeRole && 'text-fg'
                        )}
                      >
                        {formatRoleName(role)}
                        {role === activeRole && (
                          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                        )}
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            ) : (
              <span className="rounded-full border-hairline border-border bg-surface px-2.5 py-1 text-xs font-medium capitalize text-fg-muted">
                {formatRoleName(activeRole)}
              </span>
            ))}

          <button
            type="button"
            aria-label="Notifications"
            className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <Bell className="h-4 w-4" />
          </button>

          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-muted text-xs font-medium text-accent">
            {getInitials(user)}
          </div>
        </div>
      </div>
    </header>
  )
}
