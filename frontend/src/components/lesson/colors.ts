/**
 * Local colour palette for the Lesson reading view (`/learn/:assetId/lesson`).
 *
 * Mirrors the literal hex/rgba pattern used by `CATALOGUE_COLORS`
 * (components/catalogue/colors.ts) — the lesson spec calls for a slightly
 * darker sidebar/top-bar surface (`#0d0d0e`) than the catalogue's `#161618`
 * cards, plus a wider set of opacity steps for the reading layout, callouts,
 * and quiz states. Shared here so the page and its sub-components stay in
 * sync.
 */
export const LESSON_COLORS = {
  // Surfaces
  chrome: '#0d0d0e',
  card: '#161618',

  // Borders
  border05: 'rgba(255,255,255,0.05)',
  border07: 'rgba(255,255,255,0.07)',
  border08: 'rgba(255,255,255,0.08)',

  // Text
  white: '#ffffff',
  pageTitle: '#e2e0f9',
  muted80: 'rgba(255,255,255,0.8)',
  muted70: 'rgba(255,255,255,0.7)',
  muted60: 'rgba(255,255,255,0.6)',
  muted55: 'rgba(255,255,255,0.55)',
  muted50: 'rgba(255,255,255,0.5)',
  muted45: 'rgba(255,255,255,0.45)',
  muted35: 'rgba(255,255,255,0.35)',
  muted30: 'rgba(255,255,255,0.3)',
  muted20: 'rgba(255,255,255,0.2)',
  muted10: 'rgba(255,255,255,0.1)',
  muted07: 'rgba(255,255,255,0.07)',
  muted04: 'rgba(255,255,255,0.04)',
  muted02: 'rgba(255,255,255,0.02)',

  // Violet accent
  accent: '#7C6AF7',
  accentTitle: '#c4bbfb',
  accentTocActive: '#9d8ff7',
  accentText50: 'rgba(124,106,247,0.5)',
  accentText60: 'rgba(124,106,247,0.6)',
  accentText80: 'rgba(196,187,251,0.8)',
  accentBg06: 'rgba(124,106,247,0.06)',
  accentBg07: 'rgba(124,106,247,0.07)',
  accentBg15: 'rgba(124,106,247,0.15)',
  accentBg25: 'rgba(124,106,247,0.25)',
  accentBorder2: 'rgba(124,106,247,0.2)',
  accentBorder3: 'rgba(124,106,247,0.3)',
  accentBorder35: 'rgba(124,106,247,0.35)',
  accentBorder4: 'rgba(124,106,247,0.4)',

  // Success / green
  green: '#4ade80',
  greenText60: 'rgba(74,222,128,0.6)',
  greenText80: 'rgba(74,222,128,0.8)',
  greenBg04: 'rgba(74,222,128,0.04)',
  greenBg05: 'rgba(74,222,128,0.05)',
  greenBorder25: 'rgba(74,222,128,0.25)',
  greenBorder3: 'rgba(74,222,128,0.3)',

  // Warning / amber
  amberText80: 'rgba(253,211,77,0.8)',
  amberBg06: 'rgba(245,158,11,0.06)',
  amberBorder3: 'rgba(245,158,11,0.3)',

  // Danger / red
  redBg04: 'rgba(248,113,113,0.04)',
  redBorder3: 'rgba(248,113,113,0.3)',
} as const
