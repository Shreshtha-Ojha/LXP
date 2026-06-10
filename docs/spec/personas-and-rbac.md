# Personas, Roles & Access Model

## Stakeholder Groups

| Group | Who |
|---|---|
| Strategic | Executive Leadership, BU Heads, Practice Heads, Department Heads |
| Talent Development | L&D Team, HR Team, Competency Leaders |
| Operational | Program Managers, Reporting Managers, Trainers, Mentors, Assessors |
| End Users | Associates |
| External | Interns, External Trainers, External Assessors, Consultants, Partners, Vendors |

## Personas

### Associate
- Primary learner and talent-development participant
- Maintains skill inventory, completes learning, takes assessments, pursues certifications, submits evidence, participates in mentoring/communities/knowledge contribution
- **Dashboard:** Personal view of skills, plans, learning, assessments, certifications, career paths, recommendations, evidence, achievements, incentives, communities

### Reporting Manager
- Owns capability growth of direct team members
- Reviews skill declarations, approves dev plans, assigns/recommends learning, validates project implementation claims
- **Dashboard:** Team skill matrix, gaps, learning, certification, readiness, implementation, achievement, recognition, incentive, growth trends

### Program Manager
- Manages capability readiness across projects and programs
- Reviews project readiness, forecasts capability requirements, monitors competency gaps
- **Dashboard:** Project readiness, demand vs supply, certification coverage, learning progress

### Competency Leader
- Owns competency standards and capability strategy
- Defines frameworks, proficiency criteria, assessments; approves competency achievements and implementation validations; manages strategic focus areas
- **Dashboard:** Competency health, skill distribution, certification coverage, future readiness

### Mentor
- Guides associates in learning and career growth
- Conducts sessions, recommends learning, provides career guidance
- **Dashboard:** Assigned mentees, progress, upcoming milestones

### Assessor
- Evaluates competency achievement
- Evaluates assessments, reviews assignments, validates proficiency levels
- **Dashboard:** Pending assessments, completed assessments, evaluation turnaround

### Trainer
- Designs and delivers learning interventions
- Creates content, delivers training, creates assessments, reviews feedback
- **Dashboard:** Upcoming sessions, attendance, feedback, learning effectiveness

### L&D Administrator
- Owns learning operations and platform governance
- Manages learning ecosystem, workflows, reports, analytics, strategic focus areas, achievement frameworks, implementation validation, knowledge review, competency governance
- **Dashboard:** Organisation-wide learning and operations visibility

### HR Administrator
- Supports talent management and workforce planning
- Governs dev plans, talent reviews, career frameworks, incentive exports, payroll integration, reward distribution
- **Dashboard:** Talent readiness, career movement, internal mobility

### Executive Leadership
- Strategic workforce oversight
- Reviews workforce capability, future readiness, organisational competency maturity, learning ROI
- **Dashboard:** Workforce capability index, strategic skill gaps, leadership readiness, learning ROI

### System Super Administrator
- Owns and governs the entire platform
- Administers platform, security, users, roles, workflows, integrations, configuration, audit, health
- **Dashboard:** All dashboards, unrestricted visibility — every access is audit logged

### External Participant
- Accesses only assigned learning, training delivery, assessments, mentoring, or approved activities
- **Dashboard:** Restricted — only explicitly assigned content, nothing org-wide

---

## Role Assignment Rules

- A single user can hold **multiple roles simultaneously** (e.g. Reporting Manager + Mentor + Assessor)
- Permissions are the **union** of all assigned roles
- Segregation-of-duties rules apply — e.g. a user cannot be both submitter and approver for the same workflow instance
- Roles are stored in the database. Never hardcoded in application logic.

### Functional Roles
Reporting Manager, Program Manager, Competency Leader, Mentor, Assessor, Trainer, Knowledge Contributor, Knowledge Reviewer, Community Moderator

### Administrative Roles
System Super Administrator, L&D Administrator, HR Administrator, Security Administrator, Tenant Administrator, Integration Administrator, Practice Administrator

### External Roles
Intern, External Trainer, External Assessor, Consultant, Vendor Partner

---

## RBAC Permission Types

| Permission | Description |
|---|---|
| View | Can see permitted information |
| Create | Can create new records |
| Edit | Can modify existing records |
| Approve | Can approve configured workflow actions |
| Configure | Can modify system or module configurations |
| Administer | Full administrative control for their assigned scope |

Permissions are assigned at: module level, feature level, workflow level, data level, field level.

---

## Visibility Rules

These are enforced at the **data layer** (query level), not just the UI.

| Role | Can see |
|---|---|
| Associate | Own records only. Shared content only via community, mentoring, team, or public contribution. |
| Reporting Manager | Own records + direct reports + team metrics. Cannot see unrelated teams. |
| Program Manager | Own records + assigned projects and programs only. |
| Competency Leader | Own records + assigned competencies and practices only. |
| L&D Administrator | Org-wide learning data subject to configured privacy rules. |
| HR Administrator | Talent readiness, career, mobility, incentive, workforce planning data within HR scope. |
| Executive Leadership | Org-wide strategic analytics. Aggregated by default. Individual drill-down is controlled and audit-logged. |
| External User | Only records explicitly assigned to them. Zero org-wide visibility. |
| Super Administrator | Everything. All access is audit-logged. |

---

## Testing Visibility Rules

For every API endpoint and every data query, test:

1. An **allowed** role can access the resource and gets correct scoped data
2. A **denied** role gets a `403` — never `404`
3. A **Super Admin** access is logged in the audit trail
4. An **External User** cannot see anything not explicitly assigned
