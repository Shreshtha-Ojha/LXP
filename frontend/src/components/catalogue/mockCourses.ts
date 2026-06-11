import { type CatalogueCourse } from './types'

/**
 * Reference fixture for `CatalogueCourse` — documents the exact shape
 * `CourseCard` expects (and is handy for local rendering checks) without
 * being shown to real users. The `/learn` page renders skeletons while the
 * real `/catalog/*`, `/assignments/me`, and `/progress/me` queries resolve,
 * per the loading-state requirement in the design spec.
 */
export const mockCourses: CatalogueCourse[] = [
  {
    id: '1',
    title: 'REST API design patterns and versioning',
    content_type: 'video',
    duration_minutes: 135,
    proficiency_level: 'Intermediate',
    skills: ['Backend engineering', 'API design'],
    status: 'in_progress',
    progress_pct: 40,
  },
  {
    id: '2',
    title: 'Docker fundamentals and container orchestration',
    content_type: 'video',
    duration_minutes: 210,
    proficiency_level: 'Beginner',
    skills: ['DevOps', 'Cloud & infra'],
    status: 'completed',
  },
  {
    id: '3',
    title: 'OWASP Top 10 — security awareness',
    content_type: 'article',
    duration_minutes: 60,
    proficiency_level: 'All levels',
    skills: ['Security & quality'],
    status: 'assigned',
    due_date: '2026-06-15',
  },
  {
    id: '4',
    title: 'Kubernetes for backend engineers',
    content_type: 'video',
    duration_minutes: 180,
    proficiency_level: 'Intermediate',
    skills: ['Cloud & infra', 'DevOps'],
    status: 'not_started',
  },
  {
    id: '5',
    title: 'System design fundamentals',
    content_type: 'article',
    duration_minutes: 90,
    proficiency_level: 'Advanced',
    skills: ['System design'],
    status: 'not_started',
  },
  {
    id: '6',
    title: 'PostgreSQL advanced patterns',
    content_type: 'video',
    duration_minutes: 150,
    proficiency_level: 'Advanced',
    skills: ['Data & persistence'],
    status: 'not_started',
  },
]
