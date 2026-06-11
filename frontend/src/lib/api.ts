import axios, { type AxiosError } from 'axios'
import { clearToken, clearUser, getToken } from './auth'

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
})

// Attach the JWT (if any) to every outgoing request.
api.interceptors.request.use((config) => {
  const token = getToken()
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`)
  }
  return config
})

// A 401 means the session is no longer valid — clear it and send the user
// back to login. The login request itself can also 401 (bad credentials),
// so it's excluded: that error belongs on the login form, not a redirect.
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const isLoginRequest = error.config?.url?.includes('/auth/login')

    if (error.response?.status === 401 && !isLoginRequest) {
      clearToken()
      clearUser()

      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }

    return Promise.reject(error)
  }
)

interface ApiErrorBody {
  error?: string
  message?: string
}

/** Extract a user-facing message from any error thrown by an `api` call. */
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const body = error.response?.data as ApiErrorBody | undefined
    return body?.error || body?.message || error.message || 'Something went wrong'
  }

  if (error instanceof Error) return error.message

  return 'Something went wrong'
}

export default api
