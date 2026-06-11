'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import { LESSON_COLORS as COLOR } from './colors'

interface EmbedInfo {
  platform: 'youtube' | 'vimeo'
  embedUrl: string
  origin: string
}

interface PlayerMessage {
  event?: string
  info?: { playerState?: number; currentTime?: number; duration?: number }
  data?: { percent?: number; seconds?: number }
}

function getEmbedInfo(externalUrl: string, resumeSeconds: number): EmbedInfo | null {
  const youTubeMatch = externalUrl.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]+)/)
  if (youTubeMatch) {
    const params = new URLSearchParams({ enablejsapi: '1', playsinline: '1' })
    if (resumeSeconds > 0) params.set('start', String(Math.floor(resumeSeconds)))
    return {
      platform: 'youtube',
      embedUrl: `https://www.youtube-nocookie.com/embed/${youTubeMatch[1]}?${params.toString()}`,
      origin: 'https://www.youtube-nocookie.com',
    }
  }

  const vimeoMatch = externalUrl.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  if (vimeoMatch) {
    const params = new URLSearchParams({ api: '1' })
    if (resumeSeconds > 0) params.set('t', `${Math.floor(resumeSeconds)}s`)
    return {
      platform: 'vimeo',
      embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}?${params.toString()}`,
      origin: 'https://player.vimeo.com',
    }
  }

  return null
}

/** How often (while playing) to push a `progress_updated` event to `/progress/events`. */
const PROGRESS_REPORT_INTERVAL_MS = 30_000

export interface VideoProgress {
  progressPct: number
  positionSeconds: number
}

export interface VideoPlayerHandle {
  /** Seek to (and play from) a given timestamp — used by bookmarks. */
  seekTo: (seconds: number) => void
}

export interface VideoPlayerProps {
  title: string
  externalUrl: string | null
  /** Resume position from `/progress/resume/:assetId`. */
  resumeSeconds?: number | null
  durationLabel?: string | null
  /** Current playback rate, applied to the embedded player. */
  playbackRate?: number
  /** Called roughly every 30s of playback with the current watched % and position. */
  onProgress: (progress: VideoProgress) => void
  /** Called once, the first time the player reports the video ended. */
  onComplete: (progress: VideoProgress) => void
  /** Called on every player time update — used to anchor notes/bookmarks to a timestamp. */
  onTimeUpdate?: (seconds: number) => void
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer(
  { title, externalUrl, resumeSeconds, durationLabel, playbackRate, onProgress, onComplete, onTimeUpdate },
  ref
) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const watchedPctRef = useRef(0)
  const currentTimeRef = useRef(0)
  const completedRef = useRef(false)

  // Effects below subscribe via refs so passing fresh inline callbacks on
  // every render doesn't tear down and re-attach the postMessage listener.
  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const onTimeUpdateRef = useRef(onTimeUpdate)
  onTimeUpdateRef.current = onTimeUpdate

  const [started, setStarted] = useState(false)
  const [watchedPct, setWatchedPct] = useState(0)

  const embed = useMemo(
    () => (externalUrl ? getEmbedInfo(externalUrl, resumeSeconds ?? 0) : null),
    [externalUrl, resumeSeconds]
  )

  useEffect(() => {
    if (!embed) return

    function markComplete() {
      if (completedRef.current) return
      completedRef.current = true
      watchedPctRef.current = 100
      setWatchedPct(100)
      onCompleteRef.current({ progressPct: 100, positionSeconds: Math.floor(currentTimeRef.current) })
    }

    function handleMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return

      let data: PlayerMessage
      try {
        data = (typeof event.data === 'string' ? JSON.parse(event.data) : event.data) as PlayerMessage
      } catch {
        return
      }

      if (embed?.platform === 'youtube' && (data.event === 'onStateChange' || data.event === 'infoDelivery')) {
        if (data.info?.playerState === 1) setStarted(true)
        if (typeof data.info?.currentTime === 'number') {
          currentTimeRef.current = data.info.currentTime
          onTimeUpdateRef.current?.(data.info.currentTime)
        }
        if (typeof data.info?.currentTime === 'number' && typeof data.info?.duration === 'number' && data.info.duration > 0) {
          const pct = Math.min(100, Math.round((data.info.currentTime / data.info.duration) * 100))
          watchedPctRef.current = pct
          setWatchedPct(pct)
        }
        if (data.info?.playerState === 0) markComplete()
      }

      if (embed?.platform === 'vimeo') {
        if (data.event === 'play') setStarted(true)
        if (data.event === 'timeupdate') {
          if (typeof data.data?.seconds === 'number') {
            currentTimeRef.current = data.data.seconds
            onTimeUpdateRef.current?.(data.data.seconds)
          }
          if (typeof data.data?.percent === 'number') {
            const pct = Math.min(100, Math.round(data.data.percent * 100))
            watchedPctRef.current = pct
            setWatchedPct(pct)
          }
        }
        if (data.event === 'finish') markComplete()
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [embed])

  useEffect(() => {
    if (!embed) return
    const interval = setInterval(() => {
      if (watchedPctRef.current > 0 && !completedRef.current) {
        onProgressRef.current({ progressPct: watchedPctRef.current, positionSeconds: Math.floor(currentTimeRef.current) })
      }
    }, PROGRESS_REPORT_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [embed])

  // Apply playback rate changes to the live player.
  useEffect(() => {
    const player = iframeRef.current?.contentWindow
    if (!player || !embed || playbackRate == null) return

    if (embed.platform === 'youtube') {
      player.postMessage(JSON.stringify({ event: 'command', func: 'setPlaybackRate', args: [playbackRate] }), embed.origin)
    } else {
      player.postMessage(JSON.stringify({ method: 'setPlaybackRate', value: playbackRate }), embed.origin)
    }
  }, [embed, playbackRate])

  useImperativeHandle(
    ref,
    () => ({
      seekTo(seconds: number) {
        const player = iframeRef.current?.contentWindow
        if (!player || !embed) return
        setStarted(true)
        if (embed.platform === 'youtube') {
          player.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [seconds, true] }), embed.origin)
          player.postMessage(JSON.stringify({ event: 'command', func: 'playVideo' }), embed.origin)
        } else {
          player.postMessage(JSON.stringify({ method: 'setCurrentTime', value: seconds }), embed.origin)
          player.postMessage(JSON.stringify({ method: 'play' }), embed.origin)
        }
      },
    }),
    [embed]
  )

  /** Subscribe to player events once the embedded iframe has loaded. */
  function handleIframeLoad() {
    const player = iframeRef.current?.contentWindow
    if (!player || !embed) return

    if (embed.platform === 'youtube') {
      player.postMessage(JSON.stringify({ event: 'listening', id: title }), embed.origin)
      player.postMessage(JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onStateChange'] }), embed.origin)
    }

    if (embed.platform === 'vimeo') {
      player.postMessage(JSON.stringify({ method: 'addEventListener', value: 'play' }), embed.origin)
      player.postMessage(JSON.stringify({ method: 'addEventListener', value: 'timeupdate' }), embed.origin)
      player.postMessage(JSON.stringify({ method: 'addEventListener', value: 'finish' }), embed.origin)
    }
  }

  function handlePlayClick() {
    setStarted(true)
    const player = iframeRef.current?.contentWindow
    if (!player || !embed) return

    if (embed.platform === 'youtube') {
      player.postMessage(JSON.stringify({ event: 'command', func: 'playVideo' }), embed.origin)
    }
    if (embed.platform === 'vimeo') {
      player.postMessage(JSON.stringify({ method: 'play' }), embed.origin)
    }
  }

  return (
    <div className="overflow-hidden rounded-[9px]" style={{ backgroundColor: COLOR.card }}>
      <div className="relative aspect-video" style={{ background: 'linear-gradient(135deg,#1a1a2e,#16213e)' }}>
        {embed && (
          <iframe
            ref={iframeRef}
            src={embed.embedUrl}
            title={title}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            onLoad={handleIframeLoad}
          />
        )}

        {!started && (
          <button
            type="button"
            onClick={handlePlayClick}
            aria-label="Play video"
            className="absolute inset-0 flex items-center justify-center"
          >
            <span
              className="flex h-11 w-11 items-center justify-center rounded-full"
              style={{ backgroundColor: COLOR.accentBg25, border: `1.5px solid ${COLOR.accentBorder4}` }}
            >
              <Play className="h-4 w-4 fill-current" style={{ color: COLOR.accent }} />
            </span>
          </button>
        )}
      </div>

      <div className="h-0.5 w-full" style={{ backgroundColor: COLOR.muted07 }}>
        <div className="h-full transition-[width]" style={{ width: `${watchedPct}%`, backgroundColor: COLOR.accent }} />
      </div>

      <div className="flex items-center justify-between px-4 py-2.5 text-[13px]" style={{ color: COLOR.muted35 }}>
        <span className="truncate">{title}</span>
        <span className="shrink-0 pl-3">
          {durationLabel ? `${durationLabel} · ` : ''}
          {watchedPct}% watched
        </span>
      </div>
    </div>
  )
})
