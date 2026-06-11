/**
 * Content items shown inside the Node Content Viewer
 * (`/learn/paths/:pathId/nodes/:nodeIndex/learn`).
 *
 * Hardcoded for the demo per AGENTS.md ("do not build ahead of the current
 * release") — Release 1 wires real LearningAsset records into each
 * PathNode, at which point `NODE_CONTENT_ITEMS` becomes an API response
 * keyed by node id. Only the two nodes reachable in the demo
 * (`SYSTEM_DESIGN_PATH` nodes 1 and 3) have content defined.
 */

export type NodeItemType = 'video' | 'article' | 'pdf'

export interface NodeContentItem {
  id: string
  title: string
  type: NodeItemType
  duration: string
  /** YouTube or Vimeo URL — video items only. Empty/undefined renders the placeholder. */
  videoUrl?: string
  /** Video items only. */
  description?: string
  /** Article/PDF items only — parsed by parseLessonContent. */
  content?: string
}

export const NODE_CONTENT_ITEMS: Record<string, NodeContentItem[]> = {
  'node-1': [
    {
      id: 'item-1-1',
      title: 'What is system design?',
      type: 'video',
      duration: '18 min',
      videoUrl: 'https://www.youtube.com/watch?v=SqcXvc3ZmRU',
      description:
        'System design is the process of defining the architecture, components, modules, interfaces, and data flow of a system to satisfy specified requirements. In this video we cover the fundamentals every engineer needs to know.',
    },
    {
      id: 'item-1-2',
      title: 'Key principles of system design',
      type: 'article',
      duration: '8 min',
      content: `
System design is not about memorising solutions. It is about developing a framework for thinking through trade-offs.

## The four pillars

Every system design decision comes down to four dimensions:

**Reliability** — Does the system work correctly even when things go wrong? Hardware fails, software crashes, networks drop. A reliable system handles these gracefully.

**Scalability** — Can the system handle growth? This means more users, more data, more requests. Scalability is about having options, not just one solution.

**Maintainability** — Can the team evolve the system over time? Code is read far more than it is written. Maintainability is about the humans who will work with this system in the future.

**Efficiency** — Does the system use resources wisely? CPU, memory, network, and storage all cost money and have limits.

> INFO: These four pillars are not always compatible. A highly available system may sacrifice some consistency. A highly scalable system may be harder to maintain. Your job as a designer is to understand the trade-offs.

## Starting any system design problem

Always begin with:
1. Clarify requirements — what exactly needs to be built?
2. Estimate scale — how many users, how much data, what traffic?
3. Define the API — what does the system expose?
4. Design the data model — what needs to be stored?
5. High level design — draw the boxes and arrows
6. Deep dive — focus on the hardest parts

> TIP: In an interview, spend the first 5 minutes only on requirements. Jumping to solutions before understanding the problem is the most common mistake.

## What makes a good system designer?

Not memorisation of patterns. Pattern recognition comes from understanding why each pattern exists — what problem it solves and what problems it creates.

\`\`\`
Good question to always ask:
"What happens when this component fails?"
\`\`\`

A system that works perfectly in the happy path but catastrophically fails under load or partial failure is not a well-designed system.
      `,
    },
  ],
  'node-3': [
    {
      id: 'item-3-1',
      title: 'Horizontal vs vertical scaling',
      type: 'video',
      duration: '22 min',
      videoUrl: 'https://www.youtube.com/watch?v=xpDnVSmNFX0',
      description:
        'Understanding when to scale up (vertical) versus scale out (horizontal) is one of the most fundamental decisions in system design. This video covers real-world examples from companies like Netflix and Twitter.',
    },
    {
      id: 'item-3-2',
      title: 'Load balancers explained',
      type: 'video',
      duration: '18 min',
      videoUrl: 'https://www.youtube.com/watch?v=K0Ta65OqQkY',
      description:
        'Load balancers are the traffic directors of the internet. Learn how round-robin, least-connections, and consistent hashing work, and when to use each strategy.',
    },
    {
      id: 'item-3-3',
      title: 'CAP theorem',
      type: 'article',
      duration: '10 min',
      content: `
The CAP theorem is one of the most important — and most misunderstood — concepts in distributed systems.

## What CAP theorem states

In any distributed system, you can only guarantee two of these three properties simultaneously:

**Consistency (C)** — Every read receives the most recent write or an error. All nodes see the same data at the same time.

**Availability (A)** — Every request receives a response (not necessarily the most recent data). The system stays operational.

**Partition tolerance (P)** — The system continues to function even when network partitions occur (some nodes cannot communicate with others).

> WARNING: Network partitions are not optional in real distributed systems. They happen. This means you are always choosing between C and A when a partition occurs.

## The real choice: CP vs AP

**CP systems** (Consistency + Partition tolerance):
When a partition occurs, the system refuses to respond rather than return potentially stale data.
Examples: HBase, Zookeeper, traditional RDBMS in distributed mode

**AP systems** (Availability + Partition tolerance):
When a partition occurs, the system continues to respond but may return stale data.
Examples: DynamoDB, Cassandra, CouchDB

## What this means in practice

\`\`\`
Ask yourself: "What is worse for my users?"
- Getting an error (CP choice)
- Getting slightly stale data (AP choice)
\`\`\`

For a banking system: getting stale balance data is catastrophic. Choose CP.
For a social media feed: showing a post that is 2 seconds delayed is fine. Choose AP.

> TIP: CAP theorem applies during network partitions specifically.
During normal operation, you can have all three.
The choice only matters when things go wrong.

## Beyond CAP — the PACELC model

CAP theorem only describes behaviour during partitions. The PACELC model extends this:
- During a Partition: choose between Availability and Consistency (same as CAP)
- Else (normal operation): choose between Latency and Consistency

This is more realistic for everyday system design decisions.
      `,
    },
  ],
}

const YOUTUBE_PATTERN = /(?:youtu\.be\/|youtube\.com(?:\/embed\/|\/v\/|\/watch\?v=|\/watch\?.+&v=))([\w-]{11})/
const VIMEO_PATTERN = /vimeo\.com\/(\d+)/

export function getYouTubeId(url: string): string | null {
  const match = url.match(YOUTUBE_PATTERN)
  return match ? match[1] : null
}

export function getVimeoId(url: string): string | null {
  const match = url.match(VIMEO_PATTERN)
  return match ? match[1] : null
}
