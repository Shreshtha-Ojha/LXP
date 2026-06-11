/**
 * Design tokens for the LXP frontend.
 *
 * Colour values are CSS custom properties defined once in `globals.css`
 * (`@theme` block) so that Tailwind utility classes (e.g. `bg-surface`,
 * `text-accent`) and these TS constants always stay in sync — change the
 * value in one place, both the utility classes and any JS that reads
 * `colors.*` pick it up.
 *
 * Use the Tailwind utility classes for static styling in JSX. Reach for
 * these constants only when a colour is needed in JS — e.g. an inline
 * style on a chart segment or a `<ProgressBar>` fill.
 */

export const colors = {
  background: {
    base: 'var(--color-bg)',
    surface: 'var(--color-surface)',
    surfaceHover: 'var(--color-surface-hover)',
    elevated: 'var(--color-elevated)',
  },
  border: {
    DEFAULT: 'var(--color-border)',
    strong: 'var(--color-border-strong)',
  },
  accent: {
    DEFAULT: 'var(--color-accent)',
    hover: 'var(--color-accent-hover)',
    muted: 'var(--color-accent-muted)',
  },
  text: {
    primary: 'var(--color-fg)',
    secondary: 'var(--color-fg-muted)',
    tertiary: 'var(--color-fg-subtle)',
  },
} as const

/**
 * Canonical status -> colour mapping. Every part of the UI that renders a
 * skill/validation/assessment status (badges, chips, progress bars) should
 * read from this map rather than hardcoding a colour, so the meaning of
 * "amber = pending" stays consistent everywhere.
 */
export const statusColors = {
  validated: 'var(--color-success)',
  met: 'var(--color-success)',
  pending: 'var(--color-warning)',
  missing: 'var(--color-danger)',
  gap: 'var(--color-danger)',
  declared: 'var(--color-accent)',
  unvalidated: 'var(--color-fg-subtle)',
} as const

export type StatusKey = keyof typeof statusColors

export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  '2xl': '32px',
  '3xl': '48px',
} as const

export const radius = {
  sm: '4px',
  md: '6px',
  lg: '8px',
  xl: '12px',
  full: '9999px',
} as const

export const fontSize = {
  xs: '11px',
  sm: '12px',
  base: '13px',
  md: '14px',
  lg: '16px',
  xl: '20px',
  '2xl': '24px',
  '3xl': '32px',
} as const

/**
 * Linear-style hairline borders. Paired with the `.border-hairline`
 * utility in `globals.css` (Tailwind's `border` utility is 1px and has no
 * built-in 0.5px scale).
 */
export const borderWidth = {
  hairline: '0.5px',
} as const

export const tokens = {
  colors,
  statusColors,
  spacing,
  radius,
  fontSize,
  borderWidth,
} as const

export default tokens
