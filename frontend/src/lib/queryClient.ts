import { QueryClient } from '@tanstack/react-query'

/**
 * Shared React Query defaults. API failures must never surface an error
 * screen (`throwOnError: false`) — every page degrades to mock/empty state
 * and logs to the console instead (see useLogQueryError-style hooks).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 2 * 60 * 1000,
      refetchOnWindowFocus: false,
      throwOnError: false,
    },
  },
})
