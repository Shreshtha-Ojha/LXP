# Core Domain Data Model

> Every entity that participates in workflow, reporting, integration, AI, or audit
> must include: ownership, visibility, status, effective dates (where applicable),
> created/modified metadata, and audit linkage.

## Domain Areas and Entities

### Identity & Access
```
Tenant
User
UserProfile
OrganisationUnit
Role
Permission
UserRole
VisibilityScope
ExternalUserProfile
```

### Competency & Skills
```
CompetencyArea
CompetencyCategory
CompetencyItem
Skill
ProficiencyModel
ProficiencyLevel
SkillRecord
Evidence
ValidationStatus
```

### Learning
```
LearningAsset
LearningObject
Course
Module
Topic
Concept
LearningPath
Journey
JourneyStep
Assignment
ProgressEvent
CompletionRule
```

### Assessment & Validation
```
Assessment
Question
Attempt
Response
Score
Rubric
EvidenceSubmission
ValidationDecision
Appeal
```

### Development & Career
```
DevelopmentPlan
DevelopmentObjective
CareerAspiration
CareerTrack
RoleRequirement
ReadinessScore
GapRecord
```

### Certification & Achievement
```
Certification
Credential
Badge
Achievement
RecognitionProgram
PointsRule
IncentiveEligibility
PayrollExport
```

### Knowledge & Collaboration
```
KnowledgeAsset
Community
Discussion
ExpertRequest
MentorProfile
MentoringRelationship
CoachingPlan
SMEProfile
```

### Workflow & Communication
```
WorkflowDefinition
WorkflowInstance
WorkflowTask
BusinessRule
NotificationTemplate
Notification
Campaign
EngagementScore
```

### Analytics & AI
```
MetricDefinition
MetricSnapshot
Dashboard
ReportDefinition
Insight
ForecastModel
AIInteraction
PromptTemplate
GroundingSource
```

### Administration & Integrations
```
TenantConfiguration
FeatureFlag
IntegrationEndpoint
SyncJob
AuditEvent
ConfigurationChange
SystemHealthMetric
```

---

## Required Fields on Every Entity

Every entity in the system must have these fields:

```
tenant_id         -- which tenant owns this record
created_by        -- user who created it
created_at        -- UTC timestamp
updated_by        -- last user to modify it
updated_at        -- UTC timestamp
status            -- current lifecycle status
effective_from    -- when this record becomes active (where applicable)
effective_to      -- when this record expires (where applicable)
audit_id          -- link to the most recent AuditEvent for this record
is_deleted        -- soft delete flag (never hard-delete records)
```

---

## Content Metadata — Critical Fields

`LearningAsset` metadata drives search, recommendations, gap analysis, and career pathing
in every future release. These are **foreign-key relationships**, never free text or comma-separated strings.

```
skill_ids[]           -> Skill.id[]
competency_area_id    -> CompetencyArea.id
competency_category_id -> CompetencyCategory.id
technology_ids[]      -> Technology.id[]
domain_id             -> Domain.id
proficiency_level_id  -> ProficiencyLevel.id
language              -> ISO 639-1 code
duration_minutes      -> integer
version               -> string
effective_from        -> date
effective_to          -> date
status                -> enum: Draft | InReview | Published | Retired
```

---

## API Contract Backlog (Release 0 + 1)

| Area | Endpoints | Events |
|---|---|---|
| Identity & Access | `GET /users/me` `POST /admin/users` `POST /admin/roles` `GET /access/effective-permissions` | `user.provisioned` `role.assigned` `permission.changed` |
| Catalogue & Search | `GET /catalog/search` `GET /catalog/assets/{id}` `POST /catalog/assets/{id}/save` | `search.performed` `asset.viewed` `learning_asset.published` |
| Assignment & Progress | `POST /assignments` `GET /journeys/me` `POST /progress/events` | `assignment.created` `asset.started` `progress.updated` `asset.completed` |
| Competency & Skills | `POST /skills/declarations` `GET /skills/inventory` `POST /evidence` `GET /gap-analysis` | `skill.declared` `evidence.submitted` `skill.validated` |
| Workflow | `POST /workflows/definitions` `POST /workflows/{id}/actions` `GET /workflows/tasks/me` | `workflow.started` `workflow.task.assigned` `workflow.escalated` |
| Notifications | `POST /notifications/send` `GET /notifications/me` | `notification.sent` `notification.read` |
| Audit & Admin | `GET /audit/events` `POST /tenants/{id}/settings` `GET /admin/health` | `audit.exported` `tenant.config.changed` `feature.flag.changed` |
