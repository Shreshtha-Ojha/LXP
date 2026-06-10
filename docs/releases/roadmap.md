# Release Roadmap

## Overview

| Release | Name | Scope | Status |
|---|---|---|---|
| Release 0 | Platform Foundation | User/org management, RBAC, visibility rules, workflow engine, notifications, audit, configuration, initial HRMS/SSO integration, basic content repository | 🔴 In Progress |
| Release 1 | LXP MVP | Learning catalogue, search, filtering, content metadata, learning paths, assignments, progress tracking, basic dashboards, manager visibility, mobile responsive UX | 🟡 Next |
| Release 2 | Assessment & Applied Validation | Question bank, assessments, evidence submission, manager validation, competency leader validation, applied learning status, validation dashboards | ⚪ Planned |
| Release 3 | Development, Career, Certification, Knowledge | IDP/HRMS alignment, skill inventory, career aspirations, certification tracking, knowledge repository, communities, mentoring basics | ⚪ Planned |
| Release 4 | Workforce Intelligence & AI Expansion | Strategic skill analytics, readiness indexes, forecasting, AI recommendations, AI tutor, AI summaries, AI risk analysis | ⚪ Planned |
| Release 5 | SaaS & Commercialisation | Tenant model, subscriptions, licensing, tenant admin, marketplace, release management, customer success, billing/export hooks | ⚪ Planned |

---

## MVP Recommendation

Begin with Release 0 and a narrow Release 1 slice: **Learning Catalog and Discovery**.

This exercises identity, content metadata, competency/skill tags, visibility, search, recommendations, progress, and audit without requiring every downstream module to be complete.

---

## Open Decisions (must be resolved before implementation)

| ID | Question | Status |
|---|---|---|
| D-001 | Internal single tenant, tenant-aware internal, or commercial SaaS from day one? | Open |
| D-002 | Which roles are enabled in Release 1? | Open |
| D-003 | Which system is source of truth — HRMS or platform — for user profiles, org hierarchy, dev plans, certs, skills? | Open |
| D-004 | Which AI features are allowed in MVP? Which require human review? | Open |
| D-005 | Which assessment types are MVP vs later release? | Open |
| D-006 | Which integrations are release blockers — HRMS, SSO, Teams, Outlook, payroll, labs, assessment engine? | Open |
| D-007 | How are Strategic Skill Readiness Index, Learning-to-Implementation Conversion Rate, and Knowledge Reuse Rate calculated? | Open |
| D-008 | Does deny override allow when a user holds multiple conflicting roles? | Open |

---

## Definition of Ready

A feature is ready to implement when:

- It has a named business owner and technical owner
- Primary personas, access rules, and visibility scope are documented
- Functional requirements are written as testable statements
- Acceptance criteria include success, failure, permission, audit, and edge cases
- Data model, event model, APIs, integrations, and migration impacts are identified
- NFRs are declared for performance, security, privacy, accessibility, reliability, observability, auditability
- AI behavior, grounding, human review, audit, override, and evaluation requirements are defined where AI is involved
- Open questions are either resolved or explicitly carried as assumptions

## Definition of Done

A feature is done when:

- Implementation satisfies the spec and all acceptance criteria
- Unit, integration, contract, workflow, security, accessibility, and regression tests are added or updated
- Audit events, metrics, logs, and notifications are verified
- Role and visibility rules are tested for allowed and denied users
- Data migrations are reversible or have approved rollback procedures
- AI outputs are evaluated against approved test cases and include human review where required
- Documentation, release notes, config notes, and support runbooks are updated
