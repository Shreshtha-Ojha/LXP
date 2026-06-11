'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'
import { useHasMounted } from '@/lib/useHasMounted'
import { Navbar } from '@/components/nav/Navbar'
import { Spinner } from '@/components/ui/Spinner'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)

  // The auth check reads localStorage, which only exists on the client —
  // wait for mount before deciding to redirect, to avoid a hydration
  // mismatch (see useHasMounted).
  const mounted = useHasMounted()

  useEffect(() => {
    if (mounted && !isAuthenticated) {
      router.replace('/login')
    }
  }, [mounted, isAuthenticated, router])

  if (!mounted || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <Navbar />
      <main className="flex-1 px-6 py-6">{children}</main>
    </div>
  )
}
