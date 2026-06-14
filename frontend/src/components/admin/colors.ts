/**
 * Colour palette for the admin user-management screens (`/admin/users`,
 * `InviteUserModal`, `/set-password`).
 *
 * Mirrors the literal hex/rgba pattern used by TEAM_COLORS / BUILDER_COLORS
 * so these surfaces stay visually consistent with the rest of the admin
 * area rather than inventing new values.
 */

export const ADMIN_COLORS = {
  card: '#161618',
  cardBorder: 'rgba(255,255,255,0.07)',
  hairline: 'rgba(255,255,255,0.05)',
  rowBg: 'rgba(255,255,255,0.02)',
  rowBorder: 'rgba(255,255,255,0.06)',
  rowHover: 'rgba(255,255,255,0.03)',

  title: '#e2e0f9',
  white: '#ffffff',

  muted70: 'rgba(255,255,255,0.7)',
  muted60: 'rgba(255,255,255,0.6)',
  muted50: 'rgba(255,255,255,0.5)',
  muted45: 'rgba(255,255,255,0.45)',
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
  muted03: 'rgba(255,255,255,0.03)',

  accent: '#7C6AF7',
  accentText: '#9d8ff7',
  accentBorder: 'rgba(124,106,247,0.3)',
  accentMuted: 'rgba(124,106,247,0.7)',
  accentBg06: 'rgba(124,106,247,0.06)',
  accentBg10: 'rgba(124,106,247,0.1)',
  accentBg15: 'rgba(124,106,247,0.15)',
  accentBorder20: 'rgba(124,106,247,0.2)',

  amber: '#f59e0b',
  amberBg: 'rgba(245,158,11,0.1)',
  amberBorder: 'rgba(245,158,11,0.2)',

  green: '#4ade80',
  greenBg: 'rgba(74,222,128,0.1)',
  greenBorder: 'rgba(74,222,128,0.2)',

  blue: '#60a5fa',
  blueBg: 'rgba(96,165,250,0.1)',

  red: '#f87171',
  redBg: 'rgba(248,113,113,0.1)',
  redBorder: 'rgba(248,113,113,0.2)',

  pillActiveBg: 'rgba(124,106,247,0.15)',
  pillActiveBorder: 'rgba(124,106,247,0.35)',

  overlay: 'rgba(0,0,0,0.75)',
  inputBg: '#1e1e21',
  inputBorder: 'rgba(255,255,255,0.1)',
} as const

/**
 * users.status / pseudo-status ("pending" for an invite_tokens row) ->
 * badge styling, shown in the User Management tables. 'invited' is the
 * users.status value (migration 023); 'pending' is the invite_tokens.status
 * value used on the Pending tab — both render the same badge.
 */
export const USER_STATUS_BADGE: Record<string, { label: string; color: string; bg: string; border: string }> = {
  active: { label: 'Active', color: ADMIN_COLORS.green, bg: ADMIN_COLORS.greenBg, border: ADMIN_COLORS.greenBorder },
  invited: { label: 'Pending', color: ADMIN_COLORS.amber, bg: ADMIN_COLORS.amberBg, border: ADMIN_COLORS.amberBorder },
  pending: { label: 'Pending', color: ADMIN_COLORS.amber, bg: ADMIN_COLORS.amberBg, border: ADMIN_COLORS.amberBorder },
  inactive: { label: 'Inactive', color: ADMIN_COLORS.muted40, bg: ADMIN_COLORS.muted04, border: ADMIN_COLORS.muted10 },
  on_leave: { label: 'On leave', color: ADMIN_COLORS.amber, bg: ADMIN_COLORS.amberBg, border: ADMIN_COLORS.amberBorder },
  suspended: { label: 'Suspended', color: ADMIN_COLORS.red, bg: ADMIN_COLORS.redBg, border: ADMIN_COLORS.redBorder },
  terminated: { label: 'Terminated', color: ADMIN_COLORS.red, bg: ADMIN_COLORS.redBg, border: ADMIN_COLORS.redBorder },
  expired: { label: 'Expired', color: ADMIN_COLORS.red, bg: ADMIN_COLORS.redBg, border: ADMIN_COLORS.redBorder },
  revoked: { label: 'Revoked', color: ADMIN_COLORS.muted40, bg: ADMIN_COLORS.muted04, border: ADMIN_COLORS.muted10 },
}

/** 4-segment password strength meter (set-password page). */
export const PASSWORD_STRENGTH_META = [
  { label: 'Weak', color: ADMIN_COLORS.red },
  { label: 'Fair', color: ADMIN_COLORS.amber },
  { label: 'Good', color: ADMIN_COLORS.blue },
  { label: 'Strong', color: ADMIN_COLORS.green },
] as const
