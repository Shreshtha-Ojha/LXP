import { type ReactNode } from 'react'
import { LESSON_COLORS as COLOR } from './colors'

export type CalloutVariant = 'info' | 'warning' | 'tip'

const VARIANT_STYLES: Record<CalloutVariant, { background: string; borderColor: string; color: string; icon: string }> = {
  info: { background: COLOR.accentBg07, borderColor: COLOR.accentBorder35, color: COLOR.accentText80, icon: '\u{1F4A1}' },
  warning: { background: COLOR.amberBg06, borderColor: COLOR.amberBorder3, color: COLOR.amberText80, icon: '⚠️' },
  tip: { background: COLOR.greenBg05, borderColor: COLOR.greenBorder25, color: COLOR.greenText80, icon: '✓' },
}

export function Callout({ variant, children }: { variant: CalloutVariant; children: ReactNode }) {
  const styles = VARIANT_STYLES[variant]

  return (
    <div
      className="my-5 flex gap-2.5 rounded-md py-3 pl-4 pr-4 text-[14px]"
      style={{
        backgroundColor: styles.background,
        borderLeft: `3px solid ${styles.borderColor}`,
        color: styles.color,
        lineHeight: 1.7,
      }}
    >
      <span className="shrink-0 leading-none">{styles.icon}</span>
      <div>{children}</div>
    </div>
  )
}
