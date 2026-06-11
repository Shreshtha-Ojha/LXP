import { Play } from 'lucide-react'
import { LESSON_COLORS as COLOR } from '@/components/lesson/colors'
import type { PathNode } from '@/components/path/types'
import { getVimeoId, getYouTubeId, type NodeContentItem } from './types'

function VideoEmbed({ item }: { item: NodeContentItem }) {
  const youTubeId = item.videoUrl ? getYouTubeId(item.videoUrl) : null
  const vimeoId = !youTubeId && item.videoUrl ? getVimeoId(item.videoUrl) : null

  if (youTubeId) {
    return (
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${youTubeId}?rel=0&modestbranding=1`}
        title={item.title}
        allowFullScreen
        className="h-full w-full border-0"
      />
    )
  }

  if (vimeoId) {
    return (
      <iframe
        src={`https://player.vimeo.com/video/${vimeoId}?byline=0&portrait=0`}
        title={item.title}
        allowFullScreen
        className="h-full w-full border-0"
      />
    )
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ background: 'linear-gradient(135deg, #1a1a2e, #16213e)' }}>
      <span
        className="flex h-14 w-14 items-center justify-center rounded-full"
        style={{ backgroundColor: 'rgba(124,106,247,0.2)', border: '1.5px solid rgba(124,106,247,0.35)' }}
      >
        <Play className="h-6 w-6" style={{ color: '#9d8ff7' }} />
      </span>
      <span className="text-[13px]" style={{ color: COLOR.muted35 }}>
        Video will be embedded here
      </span>
    </div>
  )
}

export interface VideoItemViewProps {
  item: NodeContentItem
  node: PathNode
}

export function VideoItemView({ item, node }: VideoItemViewProps) {
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
        <span>Video</span>
      </div>

      <div className="mb-6 overflow-hidden rounded-[10px]" style={{ backgroundColor: COLOR.card }}>
        <div className="aspect-video">
          <VideoEmbed item={item} />
        </div>
      </div>

      {item.description && (
        <p className="text-[15px]" style={{ color: COLOR.muted60, lineHeight: 1.8 }}>
          {item.description}
        </p>
      )}
    </div>
  )
}
