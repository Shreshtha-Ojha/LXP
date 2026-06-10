# SPEC-001: Organisation, User, RBAC & Visibility Management

**Status:** Active  
**Release:** 0  
**Owner:** TBD

---

## Problem Statement

All downstream learning, assessment, validation, reporting, and governance features require reliable user identity, organisation hierarchy, multi-role support, and access visibility. Nothing else can be built correctly without this.

## Primary Personas
System Super Administrator, L&D Administrator, HR Administrator, Security Administrator

## Goals
- Configurable organisation hierarchy
- User profiles with all required fields
- Internal and external user provisioning (manual, bulk, HRMS sync)
- Role assignment, multi-role aggregation, permission assignment
- RBAC permission types: view, create, edit, approve, configure, administer
- ABAC: data-layer visibility scoping by attribute (org unit, ownership, project/practice assignment) for all persona types — Release 0 ships RBAC and ABAC together, per the Module 18 scope in `module-catalogue.md`
- Audit logging for all role, permission, login, profile, and visibility-impacting changes

## Non-Goals
- No learner-facing UI (Release 1)
- No career pathing or skill inventory (Release 2+)
- No HRMS sync in Release 0 if HRMS is not available — build data model only

## Functional Requirements

1. Admin can create, edit, deactivate, and restore organisation units
2. Org hierarchy levels are configurable — naming and depth can change without code deployment
3. Admin can create, edit, deactivate, and restore user accounts
4. Admin can bulk upload users from CSV/Excel with validation, duplicate detection, preview, and rollback
5. Each user can hold multiple roles simultaneously — permissions are the union of all roles
6. Permissions are configurable per role per module/feature/field — no hardcoded permission checks
7. Visibility rules are enforced at query level, not UI level
8. Super Admin access is unrestricted but every action is audit logged
9. External users see only explicitly assigned records — zero org-wide visibility by default
10. Session expiry is configurable per role and user type
11. MFA is configurable per role and user type
12. Password policy is configurable: length, complexity, expiry, reuse prevention
13. At least one SSO identity provider is supported (Microsoft Entra / Google / Okta / SAML 2.0)
14. The permission engine evaluates RBAC and ABAC together for every check: RBAC determines whether the role grants the action on the module/feature, ABAC determines whether the resource matches the user's `VisibilityScope` attributes (org unit, ownership, project/practice assignment) — both must pass

## Acceptance Criteria

```
Given an associate logs in
When the dashboard loads
Then only their own records and explicitly shared content are visible

Given a reporting manager opens team analytics
When direct reports exist
Then only direct-report data is shown — no other team's data

Given an external trainer searches content
When no assignment grants them access
Then organisation-wide content returns zero results

Given a super admin performs any action
When the action completes
Then it is logged in the audit trail with actor, action, target, timestamp, and result

Given an admin bulk uploads 200 users
When 3 rows have validation errors
Then the upload stops, shows the 3 errors with row numbers, and imports nothing until fixed
```

## Data Model

```
Tenant { id, name, status, created_at, ... }
User { id, tenant_id, employee_id, email, status, created_at, ... }
UserProfile { user_id, first_name, last_name, grade, designation, org_unit_id, manager_id, ... }
OrganisationUnit { id, tenant_id, name, parent_id, level, effective_from, effective_to, status }
Role { id, tenant_id, name, description, is_system_role, status }
Permission { id, module, feature, action, description }
UserRole { user_id, role_id, assigned_by, assigned_at, effective_from, effective_to }
RolePermission { role_id, permission_id, scope }
VisibilityScope { user_id, scope_type, scope_ids[] }
AuditEvent { id, tenant_id, actor_user_id, actor_role_at_time, action_type, entity_type, entity_id, old_value, new_value, ip_address, timestamp, result }
```

## APIs

```
GET    /users/me
POST   /admin/users
PUT    /admin/users/{id}
DELETE /admin/users/{id}          -- soft delete only
POST   /admin/users/bulk-upload
POST   /admin/roles
POST   /admin/roles/{id}/permissions
GET    /access/effective-permissions
POST   /auth/login
POST   /auth/logout
POST   /auth/sso/callback
```

## Events

```
user.provisioned
user.updated
user.deactivated
role.assigned
role.removed
permission.changed
login.success
login.failed
access.violation
```

## Open Questions

- Should deny permissions override aggregated allow permissions when a user holds multiple roles?
- Which HRMS system is in scope for the initial sync?
