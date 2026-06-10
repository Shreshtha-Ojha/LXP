# LXP — Learning Experience Platform

An enterprise Learning Experience Platform. Associates find and complete courses,
managers assign training and track their teams, L&D administers the platform,
skills are validated, careers are developed, and every action is auditable.

This repository is currently **spec-first**: the product, data model, and
release plan are defined before implementation begins. There is no application
code yet.

**Current release:** Release 0 — Platform Foundation
(see [`docs/releases/roadmap.md`](docs/releases/roadmap.md))

---

## Where to start

| If you are... | Start here |
|---|---|
| New to the product | [`docs/spec/product-vision.md`](docs/spec/product-vision.md) |
| Looking for roles, personas, or access rules | [`docs/spec/personas-and-rbac.md`](docs/spec/personas-and-rbac.md) |
| Looking for entities, fields, or API contracts | [`docs/spec/data-model.md`](docs/spec/data-model.md) |
| Trying to understand the full platform scope | [`docs/spec/module-catalogue.md`](docs/spec/module-catalogue.md) |
| Planning what ships when | [`docs/releases/roadmap.md`](docs/releases/roadmap.md) |
| Implementing or reviewing a feature | [`specs/`](specs/) — one numbered folder per feature, each with a `spec.md` |
| An AI coding agent (Claude Code, Codex, Copilot, etc.) | [`AGENTS.md`](AGENTS.md) and [`CLAUDE.md`](CLAUDE.md) — read both before touching code |

---

## Repo structure

```
/
├── CLAUDE.md              # Coding rules and non-negotiables
├── AGENTS.md              # Agent operating instructions
├── docs/
│   ├── spec/              # Product-level reference docs
│   └── releases/          # Release roadmap and open decisions
└── specs/                  # Per-feature specs, numbered by build order
    ├── 000-product-vision/
    ├── 001-platform-foundation/
    └── 002-learning-catalog-discovery/
```

---

## Core rules

The full rules live in [`CLAUDE.md`](CLAUDE.md). In short:

- No business rule (roles, statuses, scoring thresholds, approval chains, workflows)
  is hardcoded — everything configurable lives in the database
- Every API endpoint goes through the central permission engine and is scoped by `tenant_id`
- Every state-changing action writes to the audit log in the same transaction
- All approvals go through the central workflow engine
- AI features are advisory, logged, and labelled — never auto-published

Do not build features ahead of the current release. Check
[`docs/releases/roadmap.md`](docs/releases/roadmap.md) before starting new work.

Notion Checklist for Phase 0 : https://app.notion.com/p/Release-0-Checklist-Platform-Foundation-37ab6ec88e9481dc99aeffe0da79128f?source=copy_link 
