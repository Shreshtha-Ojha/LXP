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

interface AuthState {
  user: AuthUser | null
  token: string | null
  activeRole: string | null
  availableRoles: string[]
  isAuthenticated: boolean

  login: (credentials: LoginCredentials) => Promise<void>
  logout: () => Promise<void>
  switchRole: (role: string) => Promise<void>
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
