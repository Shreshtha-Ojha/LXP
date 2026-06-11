import { LessonContent } from '@/components/lesson/LessonContent'
import { LESSON_COLORS as COLOR } from '@/components/lesson/colors'
import type { ContentBlock } from '@/components/lesson/contentParser'
import type { PathNode } from '@/components/path/types'
import type { NodeContentItem } from './types'

export interface ArticleItemViewProps {
  item: NodeContentItem
  node: PathNode
  blocks: ContentBlock[]
}

export function ArticleItemView({ item, node, blocks }: ArticleItemViewProps) {
  return (
    <div>
      <div className="text-[10px] font-medium tracking-[0.1em] uppercase" style={{ color: COLOR.accentText60 }}>
        Node {node.index} · {node.title}
      </div>

      <h1 className="mt-2 mb-2 text-[22px] font-medium" style={{ color: COLOR.pageTitle, letterSpacing: '-0.02em' }}>
        {item.title}
      </h1>

      <div className="mb-6 flex flex-wrap items-center gap-3.5 pb-5 text-[13px]" style={{ color: COLOR.muted35, borderBottom: `0.5px solid ${COLOR.border05}` }}>
        <span>{item.duration}</span>
        <span>{node.title}</span>
        <span>Article</span>
      </div>

      <LessonContent blocks={blocks} />
    </div>
  )
}
