'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'
import { getErrorMessage } from '@/lib/api'
import { getHomeRouteForRole } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Spinner } from '@/components/ui/Spinner'

const inputStyles = cn(
  'w-full rounded-md border-hairline border-border bg-bg px-3 py-2 text-sm text-fg',
  'placeholder:text-fg-subtle',
  'focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent'
)

interface RoleChoice {
  roles: string[]
  activeRole: string
}

export default function LoginPage() {
  const router = useRouter()
  const login = useAuthStore((state) => state.login)
  const switchRole = useAuthStore((state) => state.switchRole)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [roleChoice, setRoleChoice] = useState<RoleChoice | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      await login({ email, password })
      const { availableRoles, activeRole } = useAuthStore.getState()

      if (availableRoles.length > 1 && activeRole) {
        setRoleChoice({ roles: availableRoles, activeRole })
      } else {
        router.push(getHomeRouteForRole(activeRole))
      }
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRoleSelect(role: string) {
    if (!roleChoice) return
    setError(null)

    // Already the active role from login — no need to call switch-role.
    if (role === roleChoice.activeRole) {
      router.push(getHomeRouteForRole(role))
      return
    }

    setSubmitting(true)
    try {
      await switchRole(role)
      router.push(getHomeRouteForRole(role))
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
          <h1 className="text-lg font-semibold text-fg">SG LXP</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {roleChoice ? 'Choose how you want to sign in' : 'Sign in to your account'}
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-md border-hairline border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        {roleChoice ? (
          <div className="space-y-2">
            {roleChoice.roles.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => handleRoleSelect(role)}
                disabled={submitting}
                className={cn(
                  'flex w-full items-center justify-between rounded-md border-hairline border-border bg-bg px-3 py-2.5 text-left text-sm transition-colors',
                  'hover:bg-surface-hover',
                  'disabled:pointer-events-none disabled:opacity-50'
                )}
              >
                <span className="capitalize text-fg">{role.replace(/_/g, ' ')}</span>
                {role === roleChoice.activeRole && (
                  <span className="text-xs text-fg-subtle">Default</span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-fg-muted">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputStyles}
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-fg-muted">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={inputStyles}
              />
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <Spinner className="text-white" /> : 'Sign in'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  )
}
