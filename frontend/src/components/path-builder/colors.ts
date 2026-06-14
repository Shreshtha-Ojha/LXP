/**
 * Colour palette for the Learning Path Builder (`/admin/paths/**`).
 *
 * Extends `PATH_COLORS` (the gamified learner-facing palette) with the
 * handful of extra tokens the builder UI needs — pulled from
 * `catalogue/colors.ts` and `team/colors.ts` so admin surfaces stay visually
 * consistent with the rest of the app rather than inventing new values.
 */
import { PATH_COLORS } from '@/components/path/colors'

export const BUILDER_COLORS = {
  ...PATH_COLORS,

  muted03: 'rgba(255,255,255,0.03)',
  muted04: 'rgba(255,255,255,0.04)',
  muted07: 'rgba(255,255,255,0.07)',
  muted12: 'rgba(255,255,255,0.12)',
  muted40: 'rgba(255,255,255,0.4)',

  pillActiveBg: 'rgba(124,106,247,0.15)',
  pillActiveBorder: 'rgba(124,106,247,0.35)',

  accentBg10: 'rgba(124,106,247,0.1)',
  accentBg15: 'rgba(124,106,247,0.15)',
  accentBorder20: 'rgba(124,106,247,0.2)',
  accentBorder35: 'rgba(124,106,247,0.35)',

  greenBg10: 'rgba(74,222,128,0.1)',

  gold: '#facc15',

  inputBg: '#1e1e21',
  inputBorder: 'rgba(255,255,255,0.1)',

  overlay: 'rgba(0,0,0,0.75)',
} as const
