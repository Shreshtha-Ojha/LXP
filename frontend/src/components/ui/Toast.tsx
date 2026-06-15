'use client'

import { useEffect } from 'react'

export type ToastVariant = 'success' | 'error' | 'info'

export interface ToastState {
  message: string
  type: ToastVariant
}

export interface ToastProps {
  toast: ToastState | null
  onDismiss: () => void
}

const DOT_COLOR: Record<ToastVariant, string> = {
  success: '#4ade80',
  error: '#f87171',
  info: '#7C6AF7',
}

const AUTO_DISMISS_MS = 3000

export function Toast({ toast, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [toast, onDismiss])

  if (!toast) return null

  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex min-w-[280px] max-w-[400px] items-center gap-2.5 rounded-lg px-4 py-3 shadow-[0_4px_20px_rgba(0,0,0,0.4)]"
      style={{
        backgroundColor: '#161618',
        border: '0.5px solid rgba(255,255,255,0.1)',
        animation: 'var(--animate-toast-slide-up)',
      }}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: DOT_COLOR[toast.type] }} />
      <span className="text-sm" style={{ color: '#e2e0f9' }}>
        {toast.message}
      </span>
    </div>
  )
}
