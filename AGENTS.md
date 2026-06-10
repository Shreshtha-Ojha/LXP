# AGENTS.md

This file is for AI coding agents (Claude Code, Codex, Copilot, etc.).
Read this before touching any file in this repository.

---

## What this repo is

An enterprise Learning Experience Platform (LXP) built spec-first.
The product spec lives in `/docs/spec/`. The release checklists are in the Notion workspace.

**Current release:** Release 0 — Platform Foundation
Do not implement Release 1 features until the Release 0 checklist is complete.

---

## Repo structure

```
/
├── CLAUDE.md              # Coding rules — read first
├── AGENTS.md              # This file — agent operating instructions
├── docs/
│   ├── spec/
│   │   ├── product-vision.md        # Why this product exists
│   │   ├── personas-and-rbac.md     # All personas, roles, visibility rules
│   │   ├── data-model.md            # All entities and API contracts
│   │   └── module-catalogue.md      # All 22 modules — full platform context
│   └── releases/
│       └── roadmap.md               # Release plan and open decisions
└── specs/
    ├── 000-product-vision/          # Product constitution
    ├── 001-platform-foundation/     # Release 0 spec
    └── 002-learning-catalog-discovery/  # Release 1 first slice spec
```

---

## Before writing any code

1. Read `CLAUDE.md` — all coding rules live there
2. Read the spec for the feature you are implementing (`specs/00x-feature-name/spec.md`)
3. Confirm the feature is in the current release — do not build ahead
4. Check `specs/00x-feature-name/tasks.md` — implement only the next task
5. Run existing tests to confirm nothing is broken before starting

---

## How to implement

- Implement **one task at a time** from `tasks.md`
- Keep diffs small and reviewable
- Write or update tests **alongside** the code — not after
- Do not modify files unrelated to the current task
- After implementing: run tests, run lint, run build
- Summarise: files changed, tests added/updated, assumptions made, risks remaining

---

## How to plan (without coding)

Read `spec.md`, `CLAUDE.md`, `AGENTS.md`, and relevant docs.
Do not edit any files.
Output: scope summary, affected architecture areas, data model changes, API contracts, integration impacts, migration impacts, test strategy, risks, implementation tasks.
Flag missing or ambiguous requirements before any implementation begins.

---

## How to review a diff

Compare the diff against `spec.md`, `tasks.md`, and acceptance criteria.
Flag: missing behaviour, overbuilt behaviour, security gaps, RBAC/visibility gaps, audit gaps, test gaps, documentation gaps.
Suggest fixes. Do not approve a diff that fails any of the 10 rules in `CLAUDE.md`.

---

## Non-negotiables — violations block merge

- Every API endpoint goes through the central permission engine
- Every state-changing action writes to the audit log in the same transaction
- Every database query is filtered by `tenant_id`
- No role names, status values, or business rules hardcoded in application code
- No migration without a tested `down` function
- No AI output auto-published — always Draft, always requires human review
- At least one RBAC test per endpoint: one allowed role succeeds, one denied role gets 403

---

## Build and test commands

> Update these when your stack is confirmed.

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Lint
npm run lint

# Build
npm run build

# Run locally
npm run dev
```

---

## Glossary

| Term | Definition |
|---|---|
| Associate | A standard employee — the primary learner persona |
| Competency | A named capability area (e.g. Cloud Engineering) |
| Skill | A specific, measurable ability within a competency (e.g. Kubernetes) |
| Proficiency | The level of mastery of a skill (e.g. Beginner / Intermediate / Advanced / Expert) |
| Evidence | Proof that a skill has been applied in real work (files, URLs, repos, descriptions) |
| Learning Asset | Any piece of learning content (video, PDF, article, SCORM package, external link) |
| Learning Path | An ordered sequence of learning assets designed to develop a skill or prepare for a role |
| Workflow | A configurable approval/review process with steps, approvers, SLAs, and escalation rules |
| Tenant | A single organisation using the platform (relevant from Release 5 onward, but data model must be tenant-aware from Release 0) |
| Applied Learning | Evidence that a learner used what they learned in real work — counts toward competency validation |
| Validation | The act of a manager, assessor, or competency leader confirming a skill claim is accurate |
| Gap | The difference between a person's current proficiency and the required proficiency for their role, project, or career aspiration |
