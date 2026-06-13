/**
 * Local colour palette for the My Growth screen (`/growth`).
 *
 * Mirrors the literal hex/rgba pattern already used by the dashboard and
 * catalogue screens (a local `COLOR` const) rather than the global
 * `--color-*` theme — the growth spec calls for the same `#161618` cards and
 * `0.5px` hairlines at specific opacities used elsewhere, plus a few
 * growth-specific tones (gap red, met green, pill active/inactive).
 */
export const GROWTH_COLORS = {
  card: '#161618',
  cardBorder: 'rgba(255,255,255,0.07)',
  hairline: 'rgba(255,255,255,0.05)',

  pageTitle: '#e2e0f9',
  white: '#ffffff',

  muted45: 'rgba(255,255,255,0.45)',
  muted35: 'rgba(255,255,255,0.35)',
  muted30: 'rgba(255,255,255,0.3)',
  muted25: 'rgba(255,255,255,0.25)',
  muted20: 'rgba(255,255,255,0.2)',
  muted10: 'rgba(255,255,255,0.1)',
  muted08: 'rgba(255,255,255,0.08)',
  muted07: 'rgba(255,255,255,0.07)',
  muted06: 'rgba(255,255,255,0.06)',
  muted05: 'rgba(255,255,255,0.05)',
  muted04: 'rgba(255,255,255,0.04)',
  muted03: 'rgba(255,255,255,0.03)',
  muted02: 'rgba(255,255,255,0.02)',

  accent: '#7C6AF7',
  accentTitle: '#c4bbfb',
  accentGhostText: '#9d8ff7',
  accentGhostBorder: 'rgba(124,106,247,0.3)',
  accentBg10: 'rgba(124,106,247,0.1)',
  accentBg12: 'rgba(124,106,247,0.12)',
  accentBg15: 'rgba(124,106,247,0.15)',
  accentBorder20: 'rgba(124,106,247,0.2)',
  accentBorder35: 'rgba(124,106,247,0.35)',
  accentBorder40: 'rgba(124,106,247,0.4)',

  green: '#4ade80',
  greenBg08: 'rgba(74,222,128,0.08)',
  greenBg10: 'rgba(74,222,128,0.1)',
  greenBorder20: 'rgba(74,222,128,0.2)',

  amber: '#f59e0b',
  amberBg10: 'rgba(245,158,11,0.1)',
  amberBorder20: 'rgba(245,158,11,0.2)',

  red: '#f87171',
  redBg08: 'rgba(248,113,113,0.08)',
  redBg10: 'rgba(248,113,113,0.1)',
  redBorder20: 'rgba(248,113,113,0.2)',

  overlay: 'rgba(0,0,0,0.7)',
  inputBg: '#1e1e21',
  inputBorder: 'rgba(255,255,255,0.1)',
} as const
