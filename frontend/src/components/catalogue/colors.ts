/**
 * Local colour palette for the Learning Catalogue screen.
 *
 * Values come directly from the catalogue design spec and intentionally
 * mirror the literal hex/rgba pattern already used in
 * `app/(app)/dashboard/page.tsx` (a local `COLOR` const) rather than the
 * broader `--color-*` theme in `globals.css` — the catalogue spec calls for
 * slightly different surfaces (`#161618` cards, `0.5px` hairlines at
 * specific opacities) than the global theme's `--color-surface` (`#18181b`).
 * Shared here so `CourseCard` and the `/learn` page stay in sync.
 */
export const CATALOGUE_COLORS = {
  card: '#161618',
  cardBorder: 'rgba(255,255,255,0.07)',
  accent: '#7C6AF7',
  accentTitle: '#c4bbfb',
  pageTitle: '#e2e0f9',

  white: '#ffffff',
  muted45: 'rgba(255,255,255,0.45)',
  muted35: 'rgba(255,255,255,0.35)',
  muted30: 'rgba(255,255,255,0.3)',
  muted20: 'rgba(255,255,255,0.2)',
  muted10: 'rgba(255,255,255,0.1)',
  muted07: 'rgba(255,255,255,0.07)',
  muted04: 'rgba(255,255,255,0.04)',

  pillActiveBg: 'rgba(124,106,247,0.15)',
  pillActiveBorder: 'rgba(124,106,247,0.35)',

  accentBadgeBg: 'rgba(124,106,247,0.1)',
  accentBadgeBorder: 'rgba(124,106,247,0.2)',

  success: '#22c55e',
  successBg: 'rgba(34,197,94,0.1)',
  successBorder: 'rgba(34,197,94,0.2)',

  warning: '#f5a524',
  warningBg: 'rgba(245,165,36,0.1)',
  warningBorder: 'rgba(245,165,36,0.2)',
} as const
