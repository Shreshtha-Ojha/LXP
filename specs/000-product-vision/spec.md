# SPEC-000: Product Constitution & Platform Foundation

**Status:** Active  
**Release:** 0  
**Owner:** All three team members

---

## Problem Statement

The platform needs stable product principles, architecture constraints, access rules, audit rules, and implementation standards before any feature development begins. Without this, every developer makes different assumptions and the codebase becomes inconsistent.

## Primary Personas
Product Owner, Architect, Security Admin, System Super Administrator

## Goals
- Establish the product constitution: the non-negotiable principles all code must follow
- Create AGENTS.md and CLAUDE.md with repo conventions, build/test commands, coding standards, security constraints, and agent rules
- Define the global glossary
- Define the core audit event taxonomy
- Define the data classification model

## Non-Goals
- No user-facing features in this spec
- No UI of any kind

## Acceptance Criteria

1. Given a feature spec is created, when it is reviewed, it must declare personas, RBAC, data visibility, audit, NFR, and test impact before planning starts
2. Given Claude Code is asked to implement, when AGENTS.md and CLAUDE.md exist, it must follow the documented implementation and quality rules
3. Given a new term is introduced in a spec, when it is not in the glossary, the spec must either add it or map it to an existing term

## Core Entities
`User` `Role` `Permission` `AuditEvent` `Configuration` `Tenant`

## Events
`user.created` `role.assigned` `permission.changed` `configuration.changed`

## Open Questions
- Which regulatory frameworks are mandatory for first release?
- What is the official data classification standard?
