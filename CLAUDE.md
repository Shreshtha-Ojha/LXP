# CLAUDE.md

## What this project is

An enterprise Learning Experience Platform (LXP). Associates find and complete
courses. Managers assign training and track their team. L&D administers the
platform. Skills are validated. Careers are developed. Every action is auditable.

The full spec lives in the Notion workspace. The release checklist pages are the
source of truth for what to build. Do not invent features. Do not build ahead of
the current release.

**Current release in progress:** Release 0 — Platform Foundation

Do not write code for Release 1 features until every Release 0 checkbox is ticked.

---

## THE RULES

---

### RULE 1 — Never hardcode a business rule

If you find yourself writing any of the following directly in code, stop:
- A role name (e.g. `if role === 'manager'`)
- A status value (e.g. `if status === 'approved'`)
- An approval chain (e.g. `notify('competency_leader')`)
- A scoring threshold (e.g. `if score >= 70`)
- A workflow step sequence
- A permission check not going through the permission engine
- A completion rule (e.g. `if videoPct >= 80 markComplete()`)
- A notification trigger not driven by a config record

All of these must come from the database / configuration layer. An admin must
be able to change them through a UI without a code deployment.

---

### RULE 2 — Every API endpoint must check permissions

No exceptions. The UI hiding a button is not security.

Every endpoint must:
1. Authenticate the request (valid session token)
2. Identify the user and their roles
3. Check the permission engine: does this user have the required permission
   (view / create / edit / approve / configure / administer) for this resource?
4. Check the visibility scope: is this resource within the user's permitted
   organisational scope?
5. If either check fails: return 403. Log the access violation in the audit log.
   Always 403, never 404, for forbidden resources.

```js
// Pattern for every endpoint
const user = await getAuthenticatedUser(req)
const permitted = await permissionEngine.check(user, action, resourceType, resourceId)
if (!permitted) {
  await auditLog.write({ event: 'ACCESS_VIOLATION', user, action, resourceId })
  return res.status(403).json({ error: 'Forbidden' })
}
```

Do not write one-off permission checks. Always go through the central permission engine.

---

### RULE 3 — Every database query must be scoped by tenant_id

Every entity has a `tenant_id` column. Every query filters by it. No exceptions.
Also filter by the user's visibility scope — never return all rows and filter
in application code.

```js
// Wrong
const users = await db.users.findAll()

// Right
const users = await db.users.findAll({
  where: {
    tenant_id: currentUser.tenantId,
    org_unit_id: { [Op.in]: currentUser.permittedOrgUnits }
  }
})
```

---

### RULE 4 — Write to the audit log before returning a response

Every action that changes state must be audit logged. Written in the same
database transaction as the change — not after the response is sent.

Each audit record must contain:
```
{
  tenant_id,
  actor_user_id,
  actor_role_at_time,   // snapshot — the role may change later
  action_type,          // e.g. 'USER_UPDATED', 'WORKFLOW_APPROVED'
  entity_type,          // e.g. 'User', 'LearningAsset'
  entity_id,
  old_value,            // JSON snapshot before change
  new_value,            // JSON snapshot after change
  ip_address,
  timestamp,            // UTC
  result                // 'SUCCESS' or 'FAILURE'
}
```

Audit records are append-only. Never write DELETE or UPDATE against the
audit log table. Ever.

---

### RULE 5 — All approvals go through the central workflow engine

Do not write approval logic inside a feature. There is one workflow engine.
Everything uses it.

When a feature needs an approval:
1. Use an existing WorkflowDefinition or create one
2. Instantiate a WorkflowInstance from it when the approval is triggered
3. The engine handles: routing, notifications, SLA tracking, escalation,
   action recording
4. The feature just listens for the `workflow.completed` event

If you are writing `sendEmailToManager()` or `updateStatusToApproved()`
directly in a feature's business logic: stop. That belongs in the engine.

---

### RULE 6 — Content metadata uses foreign keys, not strings

Every LearningAsset must be linked via proper foreign-key relationships to:
- Skill entities
- CompetencyArea / CompetencyCategory entities
- Technology / Tool entities
- Domain entities
- ProficiencyLevel (enum from the configured model)

Never store skills or competencies as comma-separated strings or free text.
Future queries like "all courses that develop Kubernetes Intermediate" must
be answerable with a join, not a string search.

---

### RULE 7 — Visibility is enforced at the data layer, not the UI

The UI hiding a section is not a visibility control. Enforce it in the query.

Visibility scope per role:
- Associate → own records only
- Reporting Manager → own records + direct reports only
- Program Manager → own records + assigned project/program members only
- Competency Leader → own records + their practice members only
- L&D Admin → all records within tenant (subject to privacy config)
- HR Admin → talent, career, mobility, incentive data within HR scope
- Executive → aggregated org-wide; individual drill-down is permission-gated
  and audit-logged
- External User → only explicitly assigned records, nothing else
- Super Admin → everything, all access audit-logged

---

### RULE 8 — Never write a migration you can't roll back

Every migration must have a `down` function. Test the down migration before
merging. If a migration is destructive and cannot be rolled back, it requires
approval from all three team members before running.

---

### RULE 9 — AI features are advisory unless explicitly approved otherwise

- AI-generated content is always saved as Draft. Never auto-published.
- AI recommendations must log what drove them (skill gap, aspiration, org priority)
- AI assessment scoring is a suggestion to the human assessor, not a final decision,
  unless an automation policy record explicitly exists in the database
- Every AI interaction must be logged: user, role, tenant, feature, timestamp,
  output category, what the user did with the output
- AI outputs must show a label to the user: "Generated by AI — review before use"
- The AI assistant must never access data outside the current user's visibility scope
- Any AI feature must be disableable via a feature flag record — no code change needed

---

### RULE 10 — No task is done without these four things

1. **Tests exist** — unit tests for business logic, integration tests for the
   API endpoint, RBAC tests confirming at least one allowed role succeeds and
   at least one denied role gets a 403
2. **Audit logging works** — every state change writes to the audit log,
   verified in the test
3. **Visibility rules enforced** — the API returns correct data per persona,
   wrong-scope requests return 403
4. **Nothing hardcoded** — no role names, status values, or business rules
   in code; all from config

If any of the four are missing, the task is not done.

---

## Entities that exist from Release 0 — do not reinvent these

```
Tenant
User, UserProfile
OrganisationUnit
Role, Permission, UserRole
VisibilityScope
WorkflowDefinition, WorkflowInstance, WorkflowTask
NotificationTemplate, Notification
AuditEvent
Configuration
FeatureFlag
LearningAsset         (schema only in R0 — no catalogue UI until R1)
Skill, CompetencyArea, CompetencyCategory, CompetencyItem
ProficiencyModel, ProficiencyLevel
```

If you need user data, use User. If you need an approval, use WorkflowInstance.
If something needs logging, use AuditEvent. Do not create parallel versions.

---

## What "configurable" means in practice

| Instead of this | Do this |
|---|---|
| `const PASSING_SCORE = 70` in code | `passing_score` column on the Assessment record |
| `if (role === 'manager') approve()` | WorkflowDefinition record specifying the approver role |
| `status = 'published'` hardcoded | ContentStatus config table with allowed transitions |
| `reminderDays = 3` in code | `reminder_days_before_due` field on the Assignment record |
| `const VALID_ROLES = ['associate', 'manager']` | Roles loaded from the Role table |

If a value appears literally in code and an admin would reasonably want to
change it: it belongs in the database.

---

## Security non-negotiables

- Passwords hashed with bcrypt (min cost 12) or argon2. Never plain or reversible.
- File uploads: validate by reading the file header, not just the extension.
- All queries use parameterised statements or ORM. No string concatenation.
- HTTPS everywhere. HTTP redirects to HTTPS. No exceptions outside local dev.
- Secrets in environment variables. Never in code. Never in git.
- Run `npm audit` (or equivalent) before every release branch.

---

## Performance targets (Release 0 and 1)

| Action | Target |
|---|---|
| Login | < 1 second |
| Any admin page | < 2 seconds |
| Search results | < 2 seconds |
| Dashboard load | < 3 seconds |
| Video playback start | < 5 seconds |
| Bulk upload (up to 500 rows) | < 30 seconds with progress indicator |

If a query is slow: check for a missing index on tenant_id, user_id, or the
foreign key in the WHERE clause before anything else.

---

## Pre-merge checklist — ask these before every PR

1. Does this change anything that should be configurable but isn't?
2. Is every endpoint checking permissions through the permission engine?
3. Is every state change being written to the audit log?
4. Is every database query filtered by tenant_id?
5. Can I roll back this migration safely?
6. Is there at least one test proving a forbidden role gets a 403?
7. Have I hardcoded anything that should come from the database?

If the answer to 1, 4, 5, or 7 is "yes" or "I'm not sure": do not merge.
