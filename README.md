# SG LXP — Learning Experience Platform

> SenecaGlobal's internal Learning Experience Platform - the full talent development lifecycle — from learning and skill validation to career pathing, assessments, and workforce intelligence.

---

## What is this?

SG LXP is a full-stack enterprise learning platform built spec-first by a team of 3. It is designed to feel like a tool people *want* to use, not one they *have* to use.

Design philosophy:
- **Linear** for layout, navigation, and information density
- **Duolingo** for progression, motivation, and achievement systems (without the mascot)
- **Notion** for content consumption and the reading experience

Target users: Associates (learners), Reporting Managers, L&D Administrators, Competency Leaders, HR Administrators, Executive Leadership.

---

## Current Status

| Release | Scope | Status |
|---|---|---|
| Release 0 — Platform Foundation | Auth, RBAC, workflow engine, audit, notifications, config | ✅ Complete |
| Release 1 — LXP MVP | Learning catalogue, paths, assignments, progress, dashboards | ✅ Backend complete, Frontend in progress |
| Release 2 — Assessments & Validation | Question bank, coding assessments, skill validation, evidence | 🔜 Planned |
| Release 3 — Career, Certs, Knowledge | IDPs, career pathing, certifications, mentoring, knowledge base | 🔜 Planned |
| Release 4 — AI & Workforce Intelligence | AI recommendations, AI tutor, strategic analytics, forecasting | 🔜 Planned |
| Release 5 — SaaS & Multi-tenant | Tenant model, subscriptions, marketplace, white-labelling | 🔜 Planned |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router, Turbopack), TypeScript, Tailwind CSS |
| Backend | Node.js, Express.js |
| Database | PostgreSQL (Supabase in production, local PostgreSQL in development) |
| State management | Zustand, React Query |
| Auth | JWT, bcrypt, SSO-ready (SAML 2.0 / OpenID Connect) |
| File storage | Supabase Storage |
| Testing | Jest, Supertest |
| Linting | ESLint 9 |

---

## Repository Structure

```
lxp/
├── CLAUDE.md                  # Coding rules for AI agents — read first
├── AGENTS.md                  # Agent operating instructions
├── backend/                   # Node.js + Express API
│   ├── src/
│   │   ├── db/
│   │   │   ├── index.js       # PostgreSQL connection pool
│   │   │   ├── migrations/    # 18 SQL migrations (run in order)
│   │   │   └── seeds/         # Development seed data
│   │   ├── middleware/
│   │   │   └── authenticate.js # JWT verification middleware
│   │   └── modules/
│   │       ├── auth/          # Login, logout, JWT issuance
│   │       ├── users/         # User management, bulk upload
│   │       ├── roles/         # RBAC, permission engine, role switching
│   │       ├── audit/         # Append-only audit log service
│   │       ├── workflow/      # Central approval engine
│   │       ├── notifications/ # In-app + email notifications
│   │       ├── config/        # Configuration + feature flags
│   │       ├── content/       # Learning assets, search, SCORM runtime
│   │       ├── learning/      # Paths, assignments, progress tracking
│   │       └── dashboard/     # Associate, manager, admin dashboard APIs
│   └── tests/
│       ├── unit/              # Unit tests per module
│       └── rbac/              # Permission engine + visibility tests
├── frontend/                  # Next.js app
│   └── src/
│       ├── app/
│       │   ├── (auth)/login/  # Login page
│       │   └── (app)/         # Authenticated routes
│       │       ├── dashboard/ # Associate home dashboard
│       │       ├── team/      # Manager team dashboard
│       │       ├── learn/     # Learning catalogue + course pages
│       │       │   ├── [assetId]/          # Course detail
│       │       │   │   ├── lesson/         # Lesson page
│       │       │   │   └── complete/       # Completion screen
│       │       │   └── paths/[pathId]/     # Gamified learning path
│       │       │       └── nodes/[nodeIndex]/learn/ # Node content viewer
│       │       └── growth/    # My Growth page (coming soon)
│       ├── components/
│       │   ├── ui/            # Base components (Button, Card, Badge etc.)
│       │   ├── nav/           # Navbar with role switcher + coin display
│       │   ├── catalogue/     # CourseCard component
│       │   └── path/          # PathTrail gamified component
│       ├── lib/
│       │   ├── api.ts         # Axios instance with JWT interceptor
│       │   ├── auth.ts        # Token helpers
│       │   └── tokens.ts      # Design system tokens
│       └── store/
│           └── authStore.ts   # Zustand auth store
└── docs/
    ├── spec/                  # Product specs converted from PDFs
    └── releases/              # Release roadmap
```

---

## Database

18 migrations, 24 tables. Run in order against PostgreSQL.

| Migration | What it creates |
|---|---|
| 001 | tenants |
| 002 | organisation_units |
| 003 | users, user_profiles |
| 004 | roles, permissions, role_permissions, user_roles |
| 005 | audit_events (append-only) |
| 006 | workflow_definitions, workflow_steps, workflow_instances, workflow_tasks |
| 007 | notification_templates, notifications, notification_preferences |
| 008 | configurations, feature_flags |
| 009 | competency_areas, competency_categories, skills, proficiency_levels, learning_assets, learning_asset_skills |
| 010 | Seed: role permissions |
| 011 | Seed: workflow permissions |
| 012 | Seed: notification permissions |
| 013 | Seed: config permissions |
| 014 | user_active_roles (active role switching — D-008) |
| 015 | Search index (tsvector full text search) |
| 016 | learning_paths, learning_path_items, assignments |
| 017 | progress_events, completion_records |
| 018 | scorm_sessions |

---

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL 14+ (local) or Supabase project
- npm 9+

### 1. Clone and install

```bash
git clone https://github.com/Shreshtha-Ojha/LXP.git
cd LXP
cd backend && npm install
cd ../frontend && npm install
```

### 2. Set up environment variables

```bash
cd backend
cp .env.example .env
```

Edit `.env`:
```
DATABASE_URL=postgresql://user:password@localhost:5432/lxp
JWT_SECRET=your_long_random_secret_minimum_32_chars
PORT=3001
NODE_ENV=development
INTERNAL_TENANT_ID=00000000-0000-0000-0000-000000000001
```

```bash
cd ../frontend
```

Create `frontend/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### 3. Set up the database (local PostgreSQL)

```bash
# Create the database
psql -U postgres -c "CREATE USER lxp WITH PASSWORD 'lxp123';"
psql -U postgres -c "CREATE DATABASE lxp OWNER lxp;"

# Run all migrations in order
cd backend
for f in src/db/migrations/*.sql; do
  echo "Running $f..."
  PGPASSWORD=lxp123 psql -U lxp -d lxp -h localhost -f "$f"
done

# Seed development data
PGPASSWORD=lxp123 psql -U lxp -d lxp -h localhost -f src/db/seeds/001_seed_content.sql
```

### 4. Create a test user

```bash
PGPASSWORD=lxp123 psql -U lxp -d lxp -h localhost << 'EOF'
INSERT INTO users (id, tenant_id, email, password_hash, status, user_type)
VALUES (
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  'you@sg.com',
  '$2b$12$a0/gt3ds.wUokpeZps98HejXpmHyYT9Dr02mgE9LYO1o9TtUS38yS',
  'active',
  'internal'
);

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u, roles r
WHERE u.email = 'you@sg.com'
AND r.name = 'associate'
AND r.tenant_id = '00000000-0000-0000-0000-000000000001';

INSERT INTO user_profiles (user_id, first_name, last_name, designation, grade)
SELECT id, 'Your', 'Name', 'Software Engineer', 'L3'
FROM users WHERE email = 'you@sg.com';
EOF
```

Default password: `Password123!`

### 5. Run the platform

```bash
# Terminal 1 — backend
cd backend && npm run dev
# Runs on http://localhost:3001

# Terminal 2 — frontend
cd frontend && npm run dev
# Runs on http://localhost:3000
```

---

## Key Architecture Decisions

### D-008 — Active Role Switching
Users with multiple roles explicitly switch their active role. Permissions are evaluated against the active role only. No deny/allow conflicts. Role badge in navbar shows current active role. `POST /auth/switch-role` issues a new JWT with the updated `activeRoleId`.

### ABAC-Ready Data Model
Release 0 implements RBAC only. The `role_permissions` table includes a `scope_conditions JSONB` column for future attribute-based rules. All visibility filtering routes through a `VisibilityScopeResolver` service so ABAC rules can be added in Release 3 without rewriting queries.

### Nothing Hardcoded
Every business rule, workflow, role name, status value, scoring threshold, and completion rule comes from the database. Admins can change them through a UI without a code deployment.

### Central Workflow Engine
All approvals across every module use the same `WorkflowDefinition` → `WorkflowInstance` → `WorkflowTask` engine. No approval logic is written inside individual features.

### Audit by Design
Every state change writes to `audit_events` in the same database transaction. The table is append-only — database rules prevent any UPDATE or DELETE. Super Admin access is fully logged.

### Tenant-Aware from Day One
Every entity has a `tenant_id` column. Every query filters by it. The platform runs single-tenant internally today but the data model is ready for Release 5 multi-tenancy without a rebuild.

---

## API Overview

Base URL: `http://localhost:3001`

| Area | Key endpoints |
|---|---|
| Auth | `POST /auth/login` `POST /auth/logout` `POST /auth/switch-role` |
| Users | `GET /users/me` `POST /admin/users` `POST /admin/users/bulk-upload` |
| Roles | `GET /admin/roles` `POST /admin/users/:id/roles` `GET /access/effective-permissions` |
| Catalogue | `GET /catalog/search` `GET /catalog/browse` `GET /catalog/assets/:id` |
| Learning | `POST /learning-paths` `POST /assignments` `GET /assignments/me` |
| Progress | `POST /progress/events` `GET /progress/me` `GET /progress/resume/:assetId` |
| Dashboard | `GET /dashboard/me` `GET /dashboard/team` `GET /dashboard/admin` |
| Workflow | `POST /workflows/:id/actions` `GET /workflows/tasks/me` |
| Notifications | `GET /notifications/me` `POST /notifications/:id/read` |
| SCORM | `POST /scorm/initialize` `POST /scorm/set-value` `POST /scorm/terminate` |
| Admin | `GET /audit/events` `GET /admin/config` `PUT /admin/features/:feature` |
| Health | `GET /health` |

All endpoints except `/health` and `/auth/login` require `Authorization: Bearer <token>`.

---

## Testing

```bash
cd backend

# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Lint
npm run lint
```

Current: **318 tests passing across 14 suites** in ~3 seconds.

Test coverage includes:
- Unit tests for all business logic
- Integration tests for all API endpoints
- RBAC tests: every persona type, allowed and denied access
- Workflow tests: all 7 actions (approve/reject/send back/escalate/delegate/hold/withdraw)
- Visibility tests: associate, manager, competency leader, L&D admin, external user

---

## Frontend Screens

| Screen | Route | Status |
|---|---|---|
| Login | `/login` | ✅ |
| Associate dashboard | `/dashboard` | ✅ |
| Manager team dashboard | `/team` | ✅ |
| Learning catalogue | `/learn` | ✅ |
| Course detail | `/learn/[assetId]` | ✅ |
| Lesson page | `/learn/[assetId]/lesson` | ✅ |
| Completion screen | `/learn/[assetId]/complete` | ✅ |
| Gamified learning path | `/learn/paths/[pathId]` | ✅ |
| Node content viewer | `/learn/paths/[pathId]/nodes/[nodeIndex]/learn` | ✅ |
| My Growth | `/growth` | 🔜 Release 2/3 |
| Content upload (L&D) | `/admin/content/upload` | 🔜 Release 1 remaining |
| Admin panel | `/admin` | 🔜 Release 1 remaining |

---

## Design System

Single violet accent: `#7C6AF7`

| Token | Value | Usage |
|---|---|---|
| Surface 0 | `#0f0f10` | Page background |
| Surface 1 | `#161618` | Cards |
| Surface 2 | `#1e1e21` | Elevated cards |
| Accent | `#7C6AF7` | Primary actions, active states |
| Growth | `#4ade80` | Validated, completed, positive |
| Milestone | `#f59e0b` | Due dates, warnings, coins |
| Danger | `#f87171` | At risk, overdue, missing |
| Text primary | `#e2e0f9` | Headings |
| Text secondary | `rgba(255,255,255,0.55)` | Body |
| Text muted | `rgba(255,255,255,0.3)` | Labels, meta |
| Border | `rgba(255,255,255,0.07)` | Card borders (always 0.5px) |

Skill validation state is communicated by colour alone:
- **Green** = validated by a human
- **Violet** = self-declared
- **Amber** = pending review
- **Grey** = unvalidated / beginner

---

## Gamified Learning Path — System Design

The platform includes one fully built gamified learning path: **System Design** (9 nodes, ~6 hours).

Features:
- Hexagonal nodes on a curved zigzag trail
- Sequential unlocking (complete node N to unlock node N+1)
- Quiz-only nodes (mandatory to complete, not to pass)
- Real YouTube video embeds (System Design playlist)
- Coin rewards per node (localStorage-persisted)
- Coin overlay animation on node completion
- Progress persists across page refreshes

Node structure:
1. Foundations — video + article — 50 coins
2. Knowledge check — quiz — 75 coins ⚡ mandatory
3. Scalability — 2 videos + article — 50 coins
4. Knowledge check — quiz — 75 coins ⚡ mandatory
5. Data & Storage — video + article + video — 50 coins
6. Knowledge check — quiz — 75 coins ⚡ mandatory
7. APIs & Communication — video + article — 50 coins
8. Real World Design — 2 videos + article — 100 coins
9. Final challenge — 15 questions — 500 coins 🏆

---

## What's Coming Next

**Immediate (Release 1 remaining):**
- Content upload UI for L&D admins
- My Growth page (skill inventory + learning activity)
- Wire frontend to real backend APIs (replace mock data)
- Assignment UI for managers

**Release 2 — Assessments:**
- Question bank management
- Coding assessments (browser-based IDE)
- Evidence submission + skill validation workflows
- SGPolaris integration (automated competency assessment via GitHub Actions)

**Release 3 — Career & Knowledge:**
- Career aspiration setting + readiness calculation
- Individual Development Plans
- Certification tracking + credential wallet
- Knowledge repository + communities of practice
- Mentoring relationships

**Release 4 — AI & Intelligence:**
- AI learning recommendations (explainable)
- AI tutor inside courses
- AI content generation (draft only, human review required)
- Executive workforce intelligence dashboard
- Predictive analytics (skill gap forecasting, certification risk)

**Release 5 — SaaS:**
- Multi-tenant architecture
- White-labelling per tenant
- Subscription + licensing
- Content marketplace

---

## Contributing

Three-person team. All work goes through pull requests — no one merges their own code.

Before every PR check:
1. Does anything that should be configurable end up hardcoded?
2. Does every API endpoint check permissions through the permission engine?
3. Does every state change write to the audit log?
4. Is every database query filtered by `tenant_id`?
5. Can every migration be rolled back safely?
6. Is there at least one test proving a forbidden role gets a 403?

See `CLAUDE.md` for the full coding rulebook.

---
