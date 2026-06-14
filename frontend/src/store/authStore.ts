import { create } from 'zustand'
import api from '@/lib/api'
import {
  type AuthUser,
  saveToken,
  getToken,
  clearToken,
  saveUser,
  getUser,
  clearUser,
  isAuthenticated as hasStoredToken,
} from '@/lib/auth'

interface LoginCredentials {
  email: string
  password: string
}

interface LoginResponse {
  token: string
  user: { id: string; tenantId: string; email: string }
  availableRoles: string[]
  activeRole: string
}

interface SwitchRoleResponse {
  token: string
  activeRole: string
}

/** Matches POST /users/invite/accept's response shape — same session shape as login. */
export interface AcceptedInviteSession {
  token: string
  user: { id: string; tenantId: string; email: string; first_name?: string; last_name?: string }
  activeRole: string | null
  availableRoles: string[]
}

interface AuthState {
  user: AuthUser | null
  token: string | null
  activeRole: string | null
  availableRoles: string[]
  isAuthenticated: boolean

  login: (credentials: LoginCredentials) => Promise<void>
  logout: () => Promise<void>
  switchRole: (role: string) => Promise<void>
  /** Sign the user in directly from a session payload (e.g. after set-password / invite acceptance), without a /auth/login round trip. */
  setSession: (session: AcceptedInviteSession) => void
}

const storedUser = getUser()

export const useAuthStore = create<AuthState>((set, get) => ({
  user: storedUser,
  token: getToken(),
  activeRole: storedUser?.activeRole ?? null,
  availableRoles: storedUser?.availableRoles ?? [],
  isAuthenticated: hasStoredToken(),

  login: async ({ email, password }) => {
    const { data } = await api.post<LoginResponse>('/auth/login', { email, password })

    const user: AuthUser = {
      ...data.user,
      activeRole: data.activeRole,
      availableRoles: data.availableRoles,
    }

    saveToken(data.token)
    saveUser(user)

    set({
      user,
      token: data.token,
      activeRole: data.activeRole,
      availableRoles: data.availableRoles,
      isAuthenticated: true,
    })
  },

  logout: async () => {
    try {
      await api.post('/auth/logout')
    } catch {
      // Token may already be expired/invalid — local session is cleared
      // either way, the audit trail just won't have a clean LOGOUT event.
    }

    clearToken()
    clearUser()

    set({ user: null, token: null, activeRole: null, availableRoles: [], isAuthenticated: false })
  },

  setSession: ({ token, user, activeRole, availableRoles }) => {
    const authUser: AuthUser = {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      activeRole: activeRole ?? undefined,
      availableRoles,
    }

    saveToken(token)
    saveUser(authUser)

    set({
      user: authUser,
      token,
      activeRole,
      availableRoles,
      isAuthenticated: true,
    })
  },

  // D-008: a multi-role user explicitly switches their active role. The
  // backend re-issues a token scoped to the new role (see authService.js).
  switchRole: async (role) => {
    const { data } = await api.post<SwitchRoleResponse>('/auth/switch-role', { role })

    const user = get().user ? { ...get().user!, activeRole: data.activeRole } : null

    saveToken(data.token)
    if (user) saveUser(user)

    set({ token: data.token, activeRole: data.activeRole, user })
  },
}))
