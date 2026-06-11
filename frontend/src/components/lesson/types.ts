import type { ApiLearningAsset } from '@/components/catalogue/types'

/**
 * `lessons_in_course`, `body_content`, `quiz`, and `category` are
 * forward-looking fields — `/content/assets/:id` doesn't return a course
 * outline or rich body content yet (mirrors the `lessons?` extension on
 * `CourseAsset` in `app/(app)/learn/[assetId]/page.tsx`). Each outline item's
 * `id` is itself an asset id: the course outline is a sequence of sibling
 * Learning Assets, and "Previous"/"Next lesson" navigate between their
 * `/learn/:assetId/lesson` pages.
 */
export type LessonAsset = ApiLearningAsset & {
  body_content?: string
  lessons_in_course?: OutlineLesson[]
  quiz?: QuizQuestion[]
  category?: string | null
}

export type OutlineLessonStatus = 'completed' | 'active' | 'locked' | 'available'

export interface OutlineLesson {
  id: string
  title: string
  status: OutlineLessonStatus
}

export interface QuizOption {
  id: string
  text: string
  is_correct: boolean
}

export interface QuizQuestion {
  id: string
  question: string
  options: QuizOption[]
  explanation: string
}

export interface LessonNote {
  id: string
  text: string
  /** e.g. "At 3:42 in video" or "Section: Naming resources correctly" */
  anchor: string
  createdAt: string
}

export interface LessonBookmark {
  id: string
  label: string
  /** Heading id (article/PDF) or formatted timestamp (video) to scroll/seek to. */
  anchor: string
}

export const mockLesson: LessonAsset = {
  id: '1',
  tenantId: 'mock-tenant',
  title: 'REST API design patterns and versioning',
  description: null,
  contentType: 'article',
  proficiencyLevel: { id: 'intermediate', name: 'Intermediate', levelOrder: 2 },
  durationMinutes: 12,
  language: 'English',
  version: 1,
  status: 'published',
  effectiveFrom: null,
  effectiveTo: null,
  authorUserId: null,
  storageUrl: null,
  externalUrl: null,
  tags: ['REST', 'API design'],
  skills: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  category: 'API Design',
  body_content: `
    REST is not a protocol — it is a set of architectural constraints.

    ## Naming resources correctly
    Resources are nouns, not verbs. The verb is the HTTP method.

    > INFO: Richardson Maturity Model levels your API from 0 to 3.
    Most production APIs land at level 2.

    ## Code example
    \`\`\`
    POST   /users
    GET    /users/123
    DELETE /users/123
    \`\`\`

    > WARNING: Avoid verbs in URIs even when the action does not map
    cleanly to CRUD.
  `,
  quiz: [
    {
      id: 'q1',
      question: 'Which URI follows REST naming conventions for fetching a single user?',
      options: [
        { id: 'a', text: 'GET /getUser?id=123', is_correct: false },
        { id: 'b', text: 'GET /users/123', is_correct: true },
        { id: 'c', text: 'POST /users/fetch/123', is_correct: false },
      ],
      explanation: 'Resources are nouns addressed by path — the HTTP method (GET) supplies the verb, so /users/123 is correct.',
    },
  ],
  lessons_in_course: [
    { id: '1a', title: 'HTTP fundamentals', status: 'completed' },
    { id: '1b', title: 'Resource modelling', status: 'completed' },
    { id: '1', title: 'REST patterns', status: 'active' },
    { id: '1c', title: 'Versioning strategies', status: 'locked' },
    { id: '1d', title: 'Auth patterns', status: 'locked' },
  ],
}
