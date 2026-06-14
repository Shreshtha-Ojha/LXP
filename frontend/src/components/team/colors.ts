/**
 * Local colour palette for the Team manager screens (`/team`).
 *
 * Mirrors the literal hex/rgba pattern used by GROWTH_COLORS and
 * CATALOGUE_COLORS — shared here so `page.tsx` and the assign-learning
 * modal components stay in sync.
 */

import type { PipelineStatus } from './types'

export const TEAM_COLORS = {
  card: '#161618',
  cardBorder: 'rgba(255,255,255,0.07)',
  hairline: 'rgba(255,255,255,0.05)',
  rowBg: 'rgba(255,255,255,0.02)',
  rowBorder: 'rgba(255,255,255,0.06)',
  trackMuted: 'rgba(255,255,255,0.07)',

  title: '#e2e0f9',
  white: '#ffffff',

  muted70: 'rgba(255,255,255,0.7)',
  muted60: 'rgba(255,255,255,0.6)',
  muted50: 'rgba(255,255,255,0.5)',
  muted40: 'rgba(255,255,255,0.4)',
  muted35: 'rgba(255,255,255,0.35)',
  muted30: 'rgba(255,255,255,0.3)',
  muted25: 'rgba(255,255,255,0.25)',
  muted20: 'rgba(255,255,255,0.2)',
  muted15: 'rgba(255,255,255,0.15)',
  muted10: 'rgba(255,255,255,0.1)',
  muted08: 'rgba(255,255,255,0.08)',
  muted06: 'rgba(255,255,255,0.06)',
  muted04: 'rgba(255,255,255,0.04)',

  accent: '#7C6AF7',
  accentText: '#9d8ff7',
  accentBorder: 'rgba(124,106,247,0.3)',
  accentMuted: 'rgba(124,106,247,0.7)',
  accentBg06: 'rgba(124,106,247,0.06)',
  accentBg15: 'rgba(124,106,247,0.15)',
  accentBorder20: 'rgba(124,106,247,0.2)',

  amber: '#f59e0b',
  green: '#4ade80',
  greenBg08: 'rgba(74,222,128,0.08)',
  greenBg10: 'rgba(74,222,128,0.1)',
  red: '#f87171',

  overlay: 'rgba(0,0,0,0.75)',
  inputBg: '#1e1e21',
  inputBorder: 'rgba(255,255,255,0.1)',
} as const

export const PIPELINE_STATUS_META: Record<PipelineStatus, { label: string; color: string; bg: string; border: string }> = {
  ready: { label: 'Ready', color: TEAM_COLORS.green, bg: TEAM_COLORS.greenBg08, border: 'rgba(74,222,128,0.2)' },
  in_progress: { label: 'In progress', color: TEAM_COLORS.amber, bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)' },
  at_risk: { label: 'At risk', color: TEAM_COLORS.red, bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.2)' },
}
