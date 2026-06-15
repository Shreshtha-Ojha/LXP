'use client'

import { useAuthStore } from '@/store/authStore'

// TODO: "who can publish/submit a path" should come from the permission
// engine (CLAUDE.md Rule 1), not a literal role list. PUBLISH_ROLES mirrors
// the learning.publish_bypass_roles config (migration 022_path_builder.sql);
// CREATE_ROLES / SUBMIT_FOR_REVIEW_ROLES mirror the 'create'/'edit'
// permissions on learning.paths. Hardcoded here as a placeholder, same
// pattern as LD_ADMIN_ROLE in PathCard.tsx / EXCLUDED_ROLES in
// admin/paths/page.tsx.
const PUBLISH_ROLES = ['ld_admin', 'super_admin']
const CREATE_ROLES = ['ld_admin', 'super_admin', 'competency_leader', 'trainer']
const SUBMIT_FOR_REVIEW_ROLES = ['competency_leader', 'trainer']

export function useCanPublish() {
  const activeRole = useAuthStore((state) => state.activeRole)

  const canPublish = PUBLISH_ROLES.includes(activeRole ?? '')
  const canCreate = CREATE_ROLES.includes(activeRole ?? '')
  const canSubmitForReview = SUBMIT_FOR_REVIEW_ROLES.includes(activeRole ?? '')

  return { canPublish, canCreate, canSubmitForReview }
}
