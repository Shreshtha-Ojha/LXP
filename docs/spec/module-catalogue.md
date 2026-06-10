# Functional Module Catalogue

> Reference document. All 22 modules of the full platform.
> Only modules relevant to the current release should be actively built.
> This file exists so Claude understands the full domain context and does not
> make architectural decisions that break future modules.

---

## Module 1 — Organisation & User Management
Configurable org hierarchy (Org → BU → Practice → Dept → Account → Program → Project → Team), user profiles, HRMS sync, SSO (OAuth/OIDC/SAML/Entra/Okta), MFA, RBAC, multi-hierarchy support (reporting, program, competency, mentoring, assessor chains), full user lifecycle (joiner/transfer/promotion/exit automation), audit logs.

**Release:** 0

---

## Module 2 — Competency Framework Management
Competency areas, categories, items, proficiency models (Beginner→Expert), role/grade/project-based requirements, career path competency maps, gap analysis engine (11 gap types), readiness calculation engine, experience/applied learning evidence framework, governance workflows.

**Release:** 0 (schema) / 2 (full)

---

## Module 3 — Skill Inventory Management
Personal skill inventory per associate. Multiple evidence sources per skill (self-declaration, assessments, certs, project work, manager validation). Skill validation workflows, progression tracking (current → target proficiency), skill relationships, bulk upload, gap analysis at individual/team/org levels.

**Release:** 2

---

## Module 4 — Career Pathing, Mobility & Succession Management
Configurable career tracks (Technical, Cloud, AI, Management, etc.), vertical/horizontal/lateral growth paths, career aspiration capture (multi-aspiration with AI recommendations), role readiness scoring across 9 dimensions, career scenario comparison, internal mobility marketplace, mentor matching, succession pipelines with talent pools.

**Release:** 3

---

## Module 5 — Development Plan Management & HRMS Alignment
IDPs, competency plans, project readiness plans. Bidirectional HRMS sync. Concept-level learning recommendations. Implementation planning and validation, progress tracking across 6 dimensions, achievement/incentive readiness outputs.

**Release:** 3

---

## Module 6 — AI-Enabled Learning Experience Platform (LXP)
Every learning modality: self-paced, ILT, VILT, blended, cohort, social, micro, experiential, AI-assisted. Learning catalog. Personalized learning paths. AI recommendation engine (semantic). Conversational AI learning assistant, AI tutor. Gamification. Completion may require assessment + project.

**Release:** 1 (catalogue/paths/progress) / 4 (AI features)

---

## Module 7 — Learning Content Management & Authoring Studio
Central content repository (SCORM, xAPI, video, audio, PDF, articles, quizzes, labs, simulations). Course builder with Course→Module→Topic→Concept→LO hierarchy. Microlearning authoring. AI course generation. AI question generation. Content versioning, approval workflows, competency tagging.

**Release:** 1 (basic) / 4 (AI authoring)

---

## Module 8 — Training Administration & Operations Management
ILT/VILT/Workshop/Bootcamp/Hackathon scheduling. Training calendar. Outlook calendar integration, Teams meeting auto-creation, attendance tracking (QR code, Teams integration). Trainer management, nomination + waitlist management, feedback collection, Kirkpatrick model effectiveness tracking.

**Release:** Can be parallelised if training ops are urgent

---

## Module 9 — Assessment, Evaluation & Validation Management
16 assessment types. Question bank (18 question types including coding, SQL, debugging, secure coding, simulation). Assessment builder with manual/random/rule-based/AI selection. Coding evaluation. Lab-based assessments. Human assessor evaluation, viva scheduling. Evidence-based assessment. Appeals, reassessment, calibration. Optional proctoring.

**Release:** 2

---

## Module 10 — Virtual Labs, Practice Environments & Experiential Learning
9 lab types. Dynamic environment provisioning for Java/Python/C#/Go/Rust, AWS/Azure/GCP, Oracle/Postgres/MongoDB, Docker/Kubernetes/Jenkins, GenAI/ML/MLOps. Lab authoring. Browser-based coding. Git integration. Automated evaluation. AI practice coach, AI coding coach, AI project coach.

**Release:** 2 (basic) / 4 (AI coaching)

---

## Module 11 — Certification, Credentialing & Digital Badging
Internal and external certs (AWS/Azure/GCP/Oracle/PMI/ISTQB/SAFe). Certification catalog, readiness calculation, gap analysis, learning path linkage. Digital credential wallet. Badge types. Expiry tracking + renewal workflows. Cert-to-competency mapping. HRMS sync.

**Release:** 3

---

## Module 12 — Mentoring, Coaching, Communities of Practice & Collaboration
8 mentor types. AI mentor matching. Mentoring relationship structures (1:1, 1:many, circles, group, community). Mentoring lifecycle + session tracking + outcome tracking. Coaching types. Communities of Practice with governance roles, open/approval/invite-only membership, discussion forums. Ask an Expert. SME network registry. Peer learning circles. Knowledge sharing events. Innovation communities.

**Release:** 3

---

## Module 13 — Knowledge Management, Sharing & Organisational Intelligence
20+ knowledge asset types. Centralized enterprise knowledge repository. Discussion-to-knowledge conversion. Knowledge-to-learning conversion. Expert registry. Exit knowledge capture. AI-powered semantic search, AI knowledge assistant, AI summarization, AI gap detection, AI classification, AI expert identification. Knowledge health index.

**Release:** 3 (basic) / 4 (AI features)

---

## Module 14 — Workforce Intelligence, Talent Analytics & Strategic Capability Planning
Org-wide capability inventory. Strategic/emerging/critical/future skill definitions. Skill demand planning vs supply analysis, gap forecasting. Workforce readiness. Talent segmentation. Strategic talent pools. Build vs buy workforce analysis. Succession coverage. Predictive analytics. AI capability forecasting, AI strategic planning assistant.

**Release:** 4

---

## Module 15 — Recognition, Rewards, Incentives & Achievement Management
Configurable achievement categories. Points engine with configurable matrices, multipliers, weightages. Incentive eligibility framework (nothing hardcoded). Applied learning validation required before eligibility. Incentive approval workflow ending in payroll submission. Payroll integration. Leaderboards. Digital recognition.

**Release:** 4/5

---

## Module 16 — Notifications, Communications, Campaigns & Engagement
Multi-channel notifications (in-app, email, Teams, mobile push, SMS, WhatsApp). Event-triggered and workflow-triggered. Smart nudges. Escalation rules. Campaign types. Template management with dynamic variables and multi-language support. User preference management. Digests. AI message generation, AI personalization, AI nudge recommendations.

**Release:** 0 (in-app + email) / 4 (AI features)

---

## Module 17 — Workflow, Approvals, Business Rules & Process Automation Engine
No-code workflow builder. 8 workflow types. Standard actions: Approve/Reject/Send Back/Request Info/Escalate/Delegate/Hold/Withdraw. SLA configuration + automatic escalation. Proxy/delegation management. Business rules engine. Trigger-based automation. Exception management (waivers, deadline extensions, manual overrides).

**Release:** 0

---

## Module 18 — System Administration, Security, Access Control & Platform Governance
Configurable admin roles. RBAC + ABAC. Data-level security. Super Admin control center. Multi-tenant architecture with data/config/security isolation, branding per tenant. Security: MFA, password policies, session/device/IP controls. Compliance: ISO 27001, SOC 2, GDPR. Full audit management. Data governance. AI governance layer. Backup & recovery.

**Release:** 0 (core) / 5 (full multi-tenant)

---

## Module 19 — Integration Hub, API Management & External Ecosystem Connectivity
API + event + webhook + file + batch + real-time integration architecture. HRMS bidirectional sync. Outlook + Teams integration. Identity providers. Content standards: SCORM, xAPI, AICC, LTI. External learning providers. Assessment platforms. Virtual lab providers. Cert providers. Knowledge systems. Code repos. Payroll integration. BI platforms. Centralized API gateway.

**Release:** 0 (SSO/HRMS) / 3+ (full ecosystem)

---

## Module 20 — Enterprise Analytics, Dashboards, Reporting & Decision Intelligence
11 stakeholder-specific dashboards. KPI framework across 10 domains (all configurable). Standard + self-service report builder. 4 analytics levels: Descriptive → Diagnostic → Predictive → Prescriptive. Report formats: PDF/Excel/CSV/PPT/API. Scheduled reports. AI executive assistant, AI insight generation, AI forecasting.

**Release:** 1 (basic dashboards) / 4 (full intelligence)

---

## Module 21 — Experience, Project Implementation, Innovation & Portfolio Management
Implementation portfolio management. Project/POC/capstone/innovation/hackathon lifecycle. Deliverable management. Business impact measurement. Innovation programs. Reusable asset library. Multi-level validation workflows. Experience-to-competency mapping. AI project recommendations, AI business impact analysis, AI deliverable review.

**Release:** 3/4

---

## Module 22 — SaaS Platform Management, Tenant Administration, Subscription, Licensing & Marketplace
Single/multi/hybrid tenant deployment. Tenant lifecycle management. White labeling. Subscription models. Named/concurrent/enterprise/module/add-on licensing. Billing framework. Marketplace for learning content, assessment packs, cert packs, competency frameworks, integrations, AI extensions. Customer success management. Tenant analytics. Feature flags.

**Release:** 5
