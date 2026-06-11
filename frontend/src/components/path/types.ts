/**
 * Shared types and mock data for the gamified Learning Path experience.
 *
 * Hardcoded for the demo per AGENTS.md ("do not build ahead of the current
 * release") — Release 1 adds GET /learning-paths/:id, at which point
 * `getPathById` swaps to a fetch and the types here become the API contract.
 */

export type PathNodeType = 'video' | 'article' | 'mixed' | 'quiz' | 'final'
export type PathNodeStatus = 'completed' | 'active' | 'locked'
export type PathItemType = 'video' | 'article' | 'quiz'

export interface PathItem {
  title: string
  type: PathItemType
  duration?: string
}

export interface PathNode {
  id: string
  index: number
  title: string
  type: PathNodeType
  status: PathNodeStatus
  coins: number
  items: PathItem[]
}

export interface LearningPath {
  id: string
  title: string
  subtitle: string
  total_coins: number
  nodes: PathNode[]
}

export interface QuizQuestion {
  q: string
  options: string[]
  correct: number
}

export const SYSTEM_DESIGN_PATH: LearningPath = {
  id: 'system-design-101',
  title: 'System Design',
  subtitle: '9 nodes · ~6 hours · Backend engineering',
  total_coins: 925,
  nodes: [
    {
      id: 'node-1',
      index: 1,
      title: 'Foundations',
      type: 'mixed',
      status: 'completed',
      coins: 50,
      items: [
        { title: 'What is system design?', type: 'video', duration: '18 min' },
        { title: 'Key principles', type: 'article', duration: '8 min' },
      ],
    },
    {
      id: 'node-2',
      index: 2,
      title: 'Knowledge check',
      type: 'quiz',
      status: 'completed',
      coins: 75,
      items: [{ title: '5 questions on fundamentals', type: 'quiz' }],
    },
    {
      id: 'node-3',
      index: 3,
      title: 'Scalability',
      type: 'mixed',
      status: 'active',
      coins: 50,
      items: [
        { title: 'Horizontal vs vertical scaling', type: 'video', duration: '22 min' },
        { title: 'Load balancers explained', type: 'video', duration: '18 min' },
        { title: 'CAP theorem', type: 'article', duration: '10 min' },
      ],
    },
    {
      id: 'node-4',
      index: 4,
      title: 'Knowledge check',
      type: 'quiz',
      status: 'locked',
      coins: 75,
      items: [{ title: '5 questions on scalability', type: 'quiz' }],
    },
    {
      id: 'node-5',
      index: 5,
      title: 'Data & Storage',
      type: 'mixed',
      status: 'locked',
      coins: 50,
      items: [
        { title: 'SQL vs NoSQL', type: 'video', duration: '20 min' },
        { title: 'Indexing strategies', type: 'article', duration: '12 min' },
        { title: 'Caching patterns', type: 'video', duration: '16 min' },
      ],
    },
    {
      id: 'node-6',
      index: 6,
      title: 'Knowledge check',
      type: 'quiz',
      status: 'locked',
      coins: 75,
      items: [{ title: '5 questions on data & storage', type: 'quiz' }],
    },
    {
      id: 'node-7',
      index: 7,
      title: 'APIs & Communication',
      type: 'mixed',
      status: 'locked',
      coins: 50,
      items: [
        { title: 'REST vs GraphQL vs gRPC', type: 'video', duration: '25 min' },
        { title: 'Event-driven architecture', type: 'article', duration: '15 min' },
      ],
    },
    {
      id: 'node-8',
      index: 8,
      title: 'Real World Design',
      type: 'mixed',
      status: 'locked',
      coins: 100,
      items: [
        { title: 'Design Twitter', type: 'video', duration: '35 min' },
        { title: 'Design a URL shortener', type: 'video', duration: '28 min' },
        { title: 'Trade-offs and decisions', type: 'article', duration: '12 min' },
      ],
    },
    {
      id: 'node-9',
      index: 9,
      title: 'Final challenge',
      type: 'final',
      status: 'locked',
      coins: 500,
      items: [{ title: '15 questions — full assessment', type: 'quiz' }],
    },
  ],
}

export const QUIZ_QUESTIONS: Record<string, QuizQuestion[]> = {
  'node-2': [
    {
      q: 'What is the primary goal of system design?',
      options: ['Write clean code', 'Build scalable and reliable systems', 'Use the latest technology', 'Minimise development time'],
      correct: 1,
    },
    {
      q: 'Which of these is NOT a key principle of system design?',
      options: ['Scalability', 'Reliability', 'Complexity', 'Maintainability'],
      correct: 2,
    },
    {
      q: 'What does CAP theorem stand for?',
      options: [
        'Cache, API, Performance',
        'Consistency, Availability, Partition tolerance',
        'Cost, Architecture, Planning',
        'Concurrency, Async, Processing',
      ],
      correct: 1,
    },
    {
      q: 'A load balancer primarily helps with:',
      options: ['Database queries', 'Distributing traffic across servers', 'Writing faster code', 'Encrypting data'],
      correct: 1,
    },
    {
      q: 'Horizontal scaling means:',
      options: [
        'Making one server more powerful',
        'Adding more servers to handle load',
        'Optimising database indexes',
        'Reducing code complexity',
      ],
      correct: 1,
    },
  ],
  'node-4': [
    {
      q: 'Which scaling approach is generally more cost-effective at large scale?',
      options: ['Vertical scaling', 'Horizontal scaling', 'Both are equal', 'Neither works at large scale'],
      correct: 1,
    },
    {
      q: 'A CDN (Content Delivery Network) helps primarily with:',
      options: [
        'Database performance',
        'Reducing latency by serving content closer to users',
        'Encrypting API calls',
        'Managing user authentication',
      ],
      correct: 1,
    },
    {
      q: 'In the CAP theorem, during a network partition you must choose between:',
      options: ['Cost and performance', 'Speed and security', 'Consistency and availability', 'Scalability and reliability'],
      correct: 2,
    },
    {
      q: 'Which of these is a valid load balancing strategy?',
      options: ['Random selection only', 'Round robin', 'Always pick the first server', 'Pick the slowest server'],
      correct: 1,
    },
    {
      q: 'Caching is most useful when:',
      options: [
        'Data changes every millisecond',
        'Data is frequently read but rarely changes',
        'You want to avoid using a database',
        'You need real-time accuracy always',
      ],
      correct: 1,
    },
  ],
}

const PATHS_BY_ID: Record<string, LearningPath> = {
  [SYSTEM_DESIGN_PATH.id]: SYSTEM_DESIGN_PATH,
}

export function getPathById(pathId: string): LearningPath | undefined {
  return PATHS_BY_ID[pathId]
}

export function getNodeByIndex(path: LearningPath, index: number): PathNode | undefined {
  return path.nodes.find((node) => node.index === index)
}

/**
 * Recomputes node statuses from the path's seed data plus any nodes
 * completed during this session: a node already marked `completed` (or
 * completed this session) stays completed, the first remaining node
 * becomes `active`, and everything after it stays `locked`. This keeps the
 * trail's unlock cascade correct after the user finishes the active node,
 * without needing a backend round trip.
 */
export function getEffectiveNodes(path: LearningPath, sessionCompletedIds: readonly string[]): PathNode[] {
  const sessionCompleted = new Set(sessionCompletedIds)
  let activeAssigned = false

  return path.nodes.map((node) => {
    if (node.status === 'completed' || sessionCompleted.has(node.id)) {
      return { ...node, status: 'completed' }
    }
    if (!activeAssigned) {
      activeAssigned = true
      return { ...node, status: 'active' }
    }
    return { ...node, status: 'locked' }
  })
}

export function getCompletedCount(nodes: readonly PathNode[]): number {
  return nodes.filter((node) => node.status === 'completed').length
}
