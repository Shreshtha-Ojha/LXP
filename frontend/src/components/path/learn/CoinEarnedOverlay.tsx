'use client'

import { useEffect, useState } from 'react'
import { LESSON_COLORS as COLOR } from '@/components/lesson/colors'

export interface CoinEarnedOverlayProps {
  coins: number
  nodeName: string
}

/** Full-screen "+N coins earned" overlay shown for ~2s when a node is completed. */
export function CoinEarnedOverlay({ coins, nodeName }: CoinEarnedOverlayProps) {
  const [visible, setVisible] = useState(false)

  // Mount at scale(0.8)/opacity 0, then flip to the visible state on the next
  // frame so the transition actually animates instead of starting "settled".
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="flex flex-col items-center gap-2 text-center transition-all duration-300"
        style={{ opacity: visible ? 1 : 0, transform: visible ? 'scale(1)' : 'scale(0.8)' }}
      >
        <span className="text-[64px] leading-none">💰</span>
        <span className="text-[28px] font-medium" style={{ color: '#f59e0b' }}>
          +{coins} coins earned
        </span>
        <span className="text-[16px]" style={{ color: COLOR.muted60 }}>
          {nodeName}
        </span>
      </div>
    </div>
  )
}
