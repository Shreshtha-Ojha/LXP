/**
 * Local colour palette for the gamified Learning Path screens.
 *
 * Mirrors the literal hex/rgba pattern used by `CATALOGUE_COLORS`
 * (components/catalogue/colors.ts) and the dashboard's local `COLOR`
 * const — the path trail's violet/amber/green gamification accents aren't
 * part of the global `--color-*` theme, so they're kept here and shared
 * across PathTrail, PathNode, and the path/node-detail pages.
 */
export const PATH_COLORS = {
  pageTitle: '#e2e0f9',

  accent: '#7C6AF7',
  accentSoft: '#6d5ce6',
  accentTitle: '#c4bbfb',
  accentBg: 'rgba(124,106,247,0.08)',
  accentBg06: 'rgba(124,106,247,0.06)',
  accentBorder: 'rgba(124,106,247,0.2)',
  accentRing: 'rgba(124,106,247,0.4)',
  accentGlow: 'rgba(124,106,247,0.4)',
  accentLine: 'rgba(124,106,247,0.6)',
  accentText70: 'rgba(124,106,247,0.7)',

  green: '#4ade80',
  greenStrong: '#22c55e',
  greenGlow: 'rgba(74,222,128,0.3)',
  greenBg: 'rgba(74,222,128,0.06)',
  greenBorder: 'rgba(74,222,128,0.4)',

  amber: '#f59e0b',
  amberBg: 'rgba(245,158,11,0.08)',
  amberBorder: 'rgba(245,158,11,0.2)',
  amberBorder15: 'rgba(245,158,11,0.15)',

  red: '#f87171',
  redBg: 'rgba(248,113,113,0.04)',
  redBorder: 'rgba(248,113,113,0.3)',

  locked: '#1e1e21',
  lockedBorder: 'rgba(255,255,255,0.08)',

  card: '#161618',
  cardBorder: 'rgba(255,255,255,0.07)',

  white: '#ffffff',
  muted50: 'rgba(255,255,255,0.5)',
  muted45: 'rgba(255,255,255,0.45)',
  muted35: 'rgba(255,255,255,0.35)',
  muted30: 'rgba(255,255,255,0.3)',
  muted25: 'rgba(255,255,255,0.25)',
  muted20: 'rgba(255,255,255,0.2)',
  muted10: 'rgba(255,255,255,0.1)',
  muted08: 'rgba(255,255,255,0.08)',
  muted06: 'rgba(255,255,255,0.06)',
  muted05: 'rgba(255,255,255,0.05)',
  muted02: 'rgba(255,255,255,0.02)',

  tooltipBg: '#161618',
  tooltipBorder: 'rgba(255,255,255,0.1)',
} as const
