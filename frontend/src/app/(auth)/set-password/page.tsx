'use client'

import { Suspense, useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { api, getErrorMessage } from '@/lib/api'
import { getHomeRouteForRole } from '@/lib/auth'
import { useAuthStore, type AcceptedInviteSession } from '@/store/authStore'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Spinner } from '@/components/ui/Spinner'
import { PASSWORD_STRENGTH_META } from '@/components/admin/colors'

interface VerifyInviteResponse {
  valid: boolean
  reason?: 'not_found' | 'already_used' | 'expired'
  email?: string
  first_name?: string
  last_name?: string
  role_name?: string
  invited_by_name?: string
  expires_at?: string
}

const INVALID_REASON_COPY: Record<string, string> = {
  not_found: 'This invitation link is invalid.',
  already_used: 'This invitation has already been used. Sign in with your password instead.',
  expired: 'This invitation link has expired. Ask your administrator to resend it.',
}

const inputStyles = cn(
  'w-full rounded-md border-hairline border-border bg-bg px-3 py-2 text-sm text-fg',
  'placeholder:text-fg-subtle',
  'focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent'
)

/** Mirrors validatePasswordPolicy's signals (length/uppercase/number) plus a bonus for extra length or symbols, scored 0-4 for the meter below. */
function scorePassword(password: string): number {
  if (!password) return 0
  let score = 0
  if (password.length >= 8) score++
  if (/[A-Z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (password.length >= 12 || /[^A-Za-z0-9]/.test(password)) score++
  return score
}

async function verifyInviteToken(token: string): Promise<VerifyInviteResponse> {
  const { data } = await api.get<VerifyInviteResponse>('/users/invite/verify', { params: { token } })
  return data
}

function PasswordStrengthMeter({ score }: { score: number }) {
  const meta = score > 0 ? PASSWORD_STRENGTH_META[score - 1] : null

  return (
    <div className="mt-2">
      <div className="flex gap-1">
        {PASSWORD_STRENGTH_META.map((segment, index) => (
          <div
            key={segment.label}
            className="h-1 flex-1 rounded-full transition-colors"
            style={{ backgroundColor: index < score ? segment.color : 'rgba(255,255,255,0.08)' }}
          />
        ))}
      </div>
      {meta && (
        <p className="mt-1 text-xs" style={{ color: meta.color }}>
          {meta.label}
        </p>
      )}
    </div>
  )
}

function StatusCard({ heading, message }: { heading: string; message: string }) {
  const router = useRouter()

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <Card className="w-full max-w-sm p-8 text-center">
        <h1 className="text-lg font-semibold text-fg">{heading}</h1>
        <p className="mt-2 text-sm text-fg-muted">{message}</p>
        <Button className="mt-6 w-full" onClick={() => router.push('/login')}>
          Go to sign in
        </Button>
      </Card>
    </div>
  )
}

function CenteredSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <Spinner className="h-6 w-6" />
    </div>
  )
}

function SetPasswordContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const setSession = useAuthStore((state) => state.setSession)
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: invite, isLoading } = useQuery({
    queryKey: ['invite-verify', token],
    queryFn: () => verifyInviteToken(token),
    enabled: !!token,
    retry: false,
  })

  if (!token) {
    return <StatusCard heading="Invalid link" message="No invitation token was provided." />
  }

  if (isLoading) {
    return <CenteredSpinner />
  }

  if (!invite?.valid) {
    const reason = invite?.reason ?? 'not_found'
    return <StatusCard heading="This invitation isn't valid" message={INVALID_REASON_COPY[reason] ?? INVALID_REASON_COPY.not_found} />
  }

  const strength = scorePassword(password)
  const confirmMismatch = confirmPassword.length > 0 && confirmPassword !== password
  const canSubmit = !!password && !!confirmPassword && !confirmMismatch && !submitting

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return

    setError(null)
    setSubmitting(true)
    try {
      const { data } = await api.post<AcceptedInviteSession>('/users/invite/accept', {
        token,
        password,
        confirm_password: confirmPassword,
      })
      setSession(data)
      router.push(getHomeRouteForRole(data.activeRole))
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold text-fg">Welcome to SG LXP</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {invite.invited_by_name ? `${invite.invited_by_name} invited you` : "You've been invited"} — set a password to get started.
          </p>
        </div>

        <div className="mb-6 rounded-md border-hairline border-border bg-bg px-3 py-2.5">
          <p className="text-sm text-fg">
            {invite.first_name} {invite.last_name}
          </p>
          <p className="text-xs text-fg-subtle">{invite.email}</p>
        </div>

        {error && (
          <div className="mb-4 rounded-md border-hairline border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-fg-muted">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputStyles}
            />
            <PasswordStrengthMeter score={strength} />
          </div>

          <div>
            <label htmlFor="confirm_password" className="mb-1.5 block text-sm font-medium text-fg-muted">
              Confirm password
            </label>
            <input
              id="confirm_password"
              name="confirm_password"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className={inputStyles}
            />
            {confirmMismatch && <p className="mt-1.5 text-xs text-danger">Passwords don&apos;t match</p>}
          </div>

          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {submitting ? <Spinner className="text-white" /> : 'Set password & continue'}
          </Button>
        </form>
      </Card>
    </div>
  )
}

export default function SetPasswordPage() {
  return (
    <Suspense fallback={<CenteredSpinner />}>
      <SetPasswordContent />
    </Suspense>
  )
}
