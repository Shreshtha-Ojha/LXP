'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import axios from 'axios'
import { AlertCircle, Mail, Plus, ShieldAlert, Users as UsersIcon } from 'lucide-react'
import { api, getErrorMessage } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { InviteUserModal, type InviteUserResult } from '@/components/admin/InviteUserModal'
import { ADMIN_COLORS as COLOR, USER_STATUS_BADGE } from '@/components/admin/colors'

const TOAST_DURATION_MS = 4000

type TabKey = 'active' | 'pending' | 'inactive'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'pending', label: 'Pending' },
  { key: 'inactive', label: 'Inactive' },
]

// Mirrors Navbar.tsx's formatRoleName — acronym roles don't survive `replace + capitalize`.
const ROLE_LABEL_OVERRIDES: Record<string, string> = {
  ld_admin: 'L&D Admin',
  hr_admin: 'HR Admin',
}

function formatRoleName(role: string): string {
  return ROLE_LABEL_OVERRIDES[role] ?? role.replace(/_/g, ' ')
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function fullName(first?: string | null, last?: string | null): string {
  const name = `${first ?? ''} ${last ?? ''}`.trim()
  return name || '—'
}

function isForbidden(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 403
}

interface DirectoryUser {
  id: string
  email: string
  status: string
  lastLoginAt: string | null
  roles: string[]
  profile: {
    firstName?: string
    lastName?: string
    designation?: string | null
  }
}

interface DirectoryResponse {
  data: DirectoryUser[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

interface InvitedUser {
  id: string
  user_id: string
  email: string
  first_name?: string
  last_name?: string
  role_name: string
  invited_by_name: string
  status: string
  expires_at: string
  created_at: string
}

async function fetchDirectory(status: 'active' | 'inactive'): Promise<DirectoryResponse> {
  const { data } = await api.get<DirectoryResponse>('/admin/users', { params: { status, pageSize: 100 } })
  return data
}

async function fetchInvited(): Promise<InvitedUser[]> {
  const { data } = await api.get<InvitedUser[]>('/users/invited')
  return data
}

function StatusBadge({ status }: { status: string }) {
  const meta = USER_STATUS_BADGE[status] ?? { label: status, color: COLOR.muted40, bg: COLOR.muted04, border: COLOR.muted10 }
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium"
      style={{ color: meta.color, backgroundColor: meta.bg, border: `0.5px solid ${meta.border}` }}
    >
      {meta.label}
    </span>
  )
}

function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl" style={{ border: `0.5px solid ${COLOR.cardBorder}`, backgroundColor: COLOR.card }}>
      <table className="w-full text-left text-[13px]">{children}</table>
    </div>
  )
}

function TableHeaderRow({ columns }: { columns: string[] }) {
  return (
    <thead>
      <tr style={{ borderBottom: `0.5px solid ${COLOR.hairline}` }}>
        {columns.map((column) => (
          <th key={column} className="whitespace-nowrap px-4 py-3 text-[12px] font-medium" style={{ color: COLOR.muted40 }}>
            {column}
          </th>
        ))}
      </tr>
    </thead>
  )
}

function LoadingPanel() {
  return (
    <div className="flex min-h-[200px] items-center justify-center">
      <Spinner className="h-6 w-6" />
    </div>
  )
}

function ErrorPanel({ error }: { error: unknown }) {
  if (isForbidden(error)) {
    return (
      <EmptyState
        icon={ShieldAlert}
        heading="You don't have access to this"
        subtext="Ask an L&D admin for access to the user directory."
      />
    )
  }
  return <EmptyState icon={AlertCircle} heading="Couldn't load users" subtext={getErrorMessage(error)} />
}

function DirectoryTable({ query, emptyLabel }: { query: UseQueryResult<DirectoryResponse>; emptyLabel: string }) {
  if (query.isLoading) return <LoadingPanel />
  if (query.error) return <ErrorPanel error={query.error} />

  const users = query.data?.data ?? []
  if (users.length === 0) return <EmptyState icon={UsersIcon} heading={emptyLabel} />

  return (
    <TableShell>
      <TableHeaderRow columns={['Name', 'Email', 'Role', 'Designation', 'Last login', 'Status']} />
      <tbody>
        {users.map((user) => (
          <tr key={user.id} className="transition-colors hover:bg-[rgba(255,255,255,0.03)]" style={{ borderBottom: `0.5px solid ${COLOR.rowBorder}` }}>
            <td className="whitespace-nowrap px-4 py-3" style={{ color: COLOR.title }}>
              {fullName(user.profile.firstName, user.profile.lastName)}
            </td>
            <td className="whitespace-nowrap px-4 py-3" style={{ color: COLOR.muted60 }}>
              {user.email}
            </td>
            <td className="whitespace-nowrap px-4 py-3" style={{ color: COLOR.muted60 }}>
              {user.roles.length > 0 ? user.roles.map(formatRoleName).join(', ') : '—'}
            </td>
            <td className="whitespace-nowrap px-4 py-3" style={{ color: COLOR.muted60 }}>
              {user.profile.designation ?? '—'}
            </td>
            <td className="whitespace-nowrap px-4 py-3" style={{ color: COLOR.muted60 }}>
              {formatDate(user.lastLoginAt)}
            </td>
            <td className="whitespace-nowrap px-4 py-3">
              <StatusBadge status={user.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  )
}

function PendingTable({
  query,
  onResend,
  onRevoke,
  pendingAction,
}: {
  query: UseQueryResult<InvitedUser[]>
  onResend: (userId: string) => void
  onRevoke: (userId: string) => void
  pendingAction: string | null
}) {
  if (query.isLoading) return <LoadingPanel />
  if (query.error) return <ErrorPanel error={query.error} />

  const invites = query.data ?? []
  if (invites.length === 0) return <EmptyState icon={Mail} heading="No pending invitations" />

  return (
    <TableShell>
      <TableHeaderRow columns={['Name', 'Email', 'Role', 'Invited by', 'Expires', 'Status', '']} />
      <tbody>
        {invites.map((invite) => (
          <tr key={invite.id} className="transition-colors hover:bg-[rgba(255,255,255,0.03)]" style={{ borderBottom: `0.5px solid ${COLOR.rowBorder}` }}>
            <td className="whitespace-nowrap px-4 py-3" style={{ color: COLOR.title }}>
              {fullName(invite.first_name, invite.last_name)}
            </td>
            <td className="whitespace-nowrap px-4 py-3" style={{ color: COLOR.muted60 }}>
              {invite.email}
            </td>
            <td className="whitespace-nowrap px-4 py-3" style={{ color: COLOR.muted60 }}>
              {formatRoleName(invite.role_name)}
            </td>
            <td className="whitespace-nowrap px-4 py-3" style={{ color: COLOR.muted60 }}>
              {invite.invited_by_name || '—'}
            </td>
            <td className="whitespace-nowrap px-4 py-3" style={{ color: COLOR.muted60 }}>
              {formatDate(invite.expires_at)}
            </td>
            <td className="whitespace-nowrap px-4 py-3">
              <StatusBadge status={invite.status} />
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-right">
              <button
                type="button"
                onClick={() => onResend(invite.user_id)}
                disabled={pendingAction === invite.user_id}
                className="rounded-md px-2.5 py-1 text-[12px] font-medium transition-opacity disabled:opacity-40"
                style={{ color: COLOR.accentText, backgroundColor: COLOR.accentBg10 }}
              >
                Resend
              </button>
              <button
                type="button"
                onClick={() => onRevoke(invite.user_id)}
                disabled={pendingAction === invite.user_id}
                className="ml-2 rounded-md px-2.5 py-1 text-[12px] font-medium transition-opacity disabled:opacity-40"
                style={{ color: COLOR.red, backgroundColor: COLOR.redBg }}
              >
                Revoke
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  )
}

export default function AdminUsersPage() {
  const [tab, setTab] = useState<TabKey>('active')
  const [showInvite, setShowInvite] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), TOAST_DURATION_MS)
    return () => clearTimeout(timer)
  }, [toast])

  const activeQuery = useQuery({
    queryKey: ['admin-users', 'active'],
    queryFn: () => fetchDirectory('active'),
    enabled: tab === 'active',
  })
  const inactiveQuery = useQuery({
    queryKey: ['admin-users', 'inactive'],
    queryFn: () => fetchDirectory('inactive'),
    enabled: tab === 'inactive',
  })
  const pendingQuery = useQuery({
    queryKey: ['invited-users'],
    queryFn: fetchInvited,
    enabled: tab === 'pending',
  })

  async function handleResend(userId: string) {
    setPendingAction(userId)
    try {
      await api.post(`/users/invite/${userId}/resend`)
      await queryClient.invalidateQueries({ queryKey: ['invited-users'] })
      setToast('Invitation resent')
    } catch (err) {
      setToast(getErrorMessage(err))
    } finally {
      setPendingAction(null)
    }
  }

  async function handleRevoke(userId: string) {
    if (!window.confirm('Revoke this invitation? The recipient will no longer be able to use their link.')) return

    setPendingAction(userId)
    try {
      await api.delete(`/users/invite/${userId}`)
      await queryClient.invalidateQueries({ queryKey: ['invited-users'] })
      setToast('Invitation revoked')
    } catch (err) {
      setToast(getErrorMessage(err))
    } finally {
      setPendingAction(null)
    }
  }

  function handleInviteSuccess({ email }: InviteUserResult) {
    setShowInvite(false)
    void queryClient.invalidateQueries({ queryKey: ['invited-users'] })
    setToast(`Invitation sent to ${email}`)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[22px] font-medium" style={{ color: COLOR.title }}>
            Users
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: COLOR.muted35 }}>
            Manage who has access to SG LXP
          </p>
        </div>

        <Button onClick={() => setShowInvite(true)}>
          <Plus className="h-4 w-4" />
          Invite user
        </Button>
      </div>

      <div className="flex items-center gap-2" style={{ borderBottom: `0.5px solid ${COLOR.hairline}` }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className="relative px-3 py-2 text-[13px] transition-colors"
            style={{ color: tab === t.key ? COLOR.title : COLOR.muted40 }}
          >
            {t.label}
            {tab === t.key && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full" style={{ backgroundColor: COLOR.accent }} />
            )}
          </button>
        ))}
      </div>

      {tab === 'active' && <DirectoryTable query={activeQuery} emptyLabel="No active users yet" />}
      {tab === 'inactive' && <DirectoryTable query={inactiveQuery} emptyLabel="No inactive users" />}
      {tab === 'pending' && (
        <PendingTable query={pendingQuery} onResend={handleResend} onRevoke={handleRevoke} pendingAction={pendingAction} />
      )}

      {showInvite && <InviteUserModal onClose={() => setShowInvite(false)} onSuccess={handleInviteSuccess} />}

      {toast && (
        <div
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[8px] px-4 py-2.5 text-[13px] shadow-lg"
          style={{ backgroundColor: COLOR.card, border: `0.5px solid ${COLOR.cardBorder}`, color: COLOR.title }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}
