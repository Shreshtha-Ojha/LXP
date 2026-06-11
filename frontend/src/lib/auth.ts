/**
 * localStorage-backed auth persistence.
 *
 * Every function is a no-op / returns null when `window` is undefined so
 * these are safe to call from code that also runs during server-side
 * rendering (Next.js renders client components on the server first).
 */

const TOKEN_KEY = 'lxp_token'
const USER_KEY = 'lxp_user'

export interface AuthUser {
  id: string
  tenantId: string
  email: string
  firstName?: string
  lastName?: string
  activeRole?: string
  availableRoles?: string[]
}

export function saveToken(token: string): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(TOKEN_KEY, token)
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

export function clearToken(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(TOKEN_KEY)
}

export function saveUser(user: AuthUser): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function getUser(): AuthUser | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

export function clearUser(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(USER_KEY)
}

export function isAuthenticated(): boolean {
  return getToken() !== null
}

// TODO: this role -> landing page mapping should come from the permission
// engine / a configurable nav record (CLAUDE.md Rule 1: no hardcoded role
// names). Hardcoded here as a placeholder until that config exists — mirrors
// Navbar.tsx and learn/page.tsx.
const MANAGER_TIER_ROLES = [
  'reporting_manager',
  'program_manager',
  'competency_leader',
  'ld_admin',
  'hr_admin',
] as const

/** Where a user with the given active role should land after login. */
export function getHomeRouteForRole(role: string | null | undefined): '/team' | '/dashboard' {
  return role && (MANAGER_TIER_ROLES as readonly string[]).includes(role) ? '/team' : '/dashboard'
}
