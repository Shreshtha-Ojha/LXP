# SPEC-002: Learning Catalog, Search & Discovery

**Status:** Planned  
**Release:** 1  
**Owner:** TBD

---

## Problem Statement

Learners need a single, searchable, role-aware catalogue to discover relevant learning assets by skill, competency, career aspiration, development need, project requirement, and organisational priority. Without this, the platform has no learner-facing value.

## Primary Personas
Associate, Reporting Manager, L&D Administrator, Competency Leader, External Participant

## Goals
- Searchable learning asset catalogue with full metadata
- Browse, search, filter, sort, save, and view content
- Visibility rules enforced — users only see what they're permitted to
- Semantic search (metadata-driven in Release 1, AI-powered in Release 4)
- Retired/expired content hidden from learners; preserved for admin/audit

## Non-Goals
- No AI recommendations in Release 1 (basic job-title matching only)
- No SCORM runtime/player in this spec (separate spec)
- No content authoring in this spec (separate spec)

## Functional Requirements

1. Every learning asset has: title, description, skills[], competency area, technologies[], domain, proficiency level, duration, language, tags[], version, effective date, expiry date, author, status
2. Skills and competencies are foreign-key relationships — never free text
3. Search covers: title, description, skills, technologies, domain, tags
4. Filters: content type, skill, proficiency level, duration range, language, domain/technology
5. Sort by: newest, most popular (completion count), relevance (default for search)
6. Retired content is hidden from learner search but accessible to admins
7. Draft content is only visible to L&D admins and content creators
8. Restricted content (e.g. practice-specific) is hidden from users outside that scope
9. External users see only explicitly assigned content
10. Saving/bookmarking content is per-user and does not affect visibility
11. Each content item has a detail page: full metadata, skills covered, a Start/Enrol button

## Acceptance Criteria

```
Given a learner searches "Kubernetes beginner"
When matching visible assets exist
Then results show relevant courses, modules, concepts, and learning paths

Given restricted customer content exists
When an unauthorised learner searches related keywords
Then that content is not returned

Given content is retired
When a learner searches
Then it does not appear in results

Given the same search by an L&D admin
When retired content exists
Then it appears in results with a "Retired" label

Given an external participant logs in
When they browse the catalogue
Then they see only explicitly assigned content — not the full catalogue
```

## Data Model

```
LearningAsset {
  id, tenant_id, title, description, content_type,
  skill_ids[], competency_area_id, competency_category_id,
  technology_ids[], domain_id, proficiency_level_id,
  duration_minutes, language, tags[], version,
  effective_from, effective_to, status,
  author_user_id, created_at, updated_at
}

SavedItem { user_id, asset_id, saved_at }
SearchIndexRecord { asset_id, indexed_content, last_indexed_at }
```

## APIs

```
GET  /catalog/search?q=&skills=&proficiency=&type=&sort=
GET  /catalog/assets/{id}
POST /catalog/assets/{id}/save
DELETE /catalog/assets/{id}/save
GET  /catalog/browse/skills/{skillId}
GET  /recommendations/learning          -- basic version: match job title to content tags
```

## Events

```
search.performed { user_id, query, filters, result_count, timestamp }
asset.viewed { user_id, asset_id, timestamp }
asset.saved { user_id, asset_id, timestamp }
learning_asset.published { asset_id, published_by, timestamp }
learning_asset.retired { asset_id, retired_by, timestamp }
```

## Open Questions

- Will SCORM/xAPI content be searched by metadata only or indexed internally?
- What content providers/types are in scope for Release 1?
- What is the minimum viable search ranking algorithm? (keyword match? TF-IDF? metadata weight?)
