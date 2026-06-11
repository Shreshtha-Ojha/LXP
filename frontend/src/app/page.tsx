'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/authStore'
import { useHasMounted } from '@/lib/useHasMounted'
import { Spinner } from '@/components/ui/Spinner'

export default function RootPage() {
  const router = useRouter()
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const mounted = useHasMounted()

  useEffect(() => {
    if (!mounted) return
    router.replace(isAuthenticated ? '/dashboard' : '/login')
  }, [mounted, isAuthenticated, router])

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <Spinner className="h-6 w-6" />
    </div>
  )
}
