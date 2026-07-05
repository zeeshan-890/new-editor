import { useEffect, useRef } from 'react'
import { useVideoEditorStore } from '@renderer/stores/videoEditorStore'
import { usePlaybackStore } from '@renderer/stores/playbackStore'
import { clipDurationMs } from '@shared/types'
import { clipSourceMsAtTimeline, clipTimelineMsAtSource } from '@renderer/lib/videoEditorTiming'
import { localAudioPathUrl } from '@renderer/lib/localFileProtocol'

function resolveMasterClip(playheadMs: number) {
  const store = useVideoEditorStore.getState()
  const audio = store.audioClipAtPlayhead(playheadMs)
  if (audio) return audio
  const visual = store.visualClipAtPlayhead(playheadMs)
  if (visual?.asset.type === 'video') return visual
  return null
}

export function useVideoEditorPlayback(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  audioRef: React.RefObject<HTMLAudioElement | null>,
  masterPathRef: React.MutableRefObject<string | null>
): void {
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const playheadMs = usePlaybackStore((s) => s.playheadMs)
  const setPlayheadMs = usePlaybackStore((s) => s.setPlayheadMs)
  const setIsPlaying = usePlaybackStore((s) => s.setIsPlaying)
  const durationMs = useVideoEditorStore((s) => s.durationMs)
  const syncAssetDuration = useVideoEditorStore((s) => s.syncAssetDuration)
  const audioClipAtPlayhead = useVideoEditorStore((s) => s.audioClipAtPlayhead)
  const visualClipAtPlayhead = useVideoEditorStore((s) => s.visualClipAtPlayhead)

  const audioActive = audioClipAtPlayhead(playheadMs)
  const active = visualClipAtPlayhead(playheadMs)

  const playbackSessionRef = useRef(0)

  // Load / swap audio source when the clip at the playhead changes.
  useEffect(() => {
    const el = audioRef.current
    if (!el || !audioActive) return

    const { clip, asset } = audioActive

    const onLoadedMetadata = (): void => {
      const actualMs = el.duration * 1000
      if (Number.isFinite(actualMs) && actualMs > 0) {
        syncAssetDuration(asset.id, Math.round(actualMs))
      }
      if (!usePlaybackStore.getState().isPlaying) {
        const sourceMs = clipSourceMsAtTimeline(clip, usePlaybackStore.getState().playheadMs)
        el.currentTime = Math.max(0, sourceMs / 1000)
      }
    }

    if (masterPathRef.current !== asset.path) {
      masterPathRef.current = asset.path
      el.src = localAudioPathUrl(asset.path)
      el.addEventListener('loadedmetadata', onLoadedMetadata, { once: true })
      return
    }

    if (el.readyState >= 1) {
      onLoadedMetadata()
    }
  }, [audioActive?.asset.path, audioActive?.clip.id, audioActive, audioRef, masterPathRef, syncAssetDuration])

  // Scrub preview when paused — never fight the media clock during playback.
  useEffect(() => {
    if (isPlaying) return

    if (audioActive && audioRef.current) {
      const sourceSec = clipSourceMsAtTimeline(audioActive.clip, playheadMs) / 1000
      const el = audioRef.current
      if (Math.abs(el.currentTime - sourceSec) > 0.02) {
        el.currentTime = Math.max(0, sourceSec)
      }
    }

    if (active?.asset.type === 'video' && videoRef.current) {
      const sourceSec = clipSourceMsAtTimeline(active.clip, playheadMs) / 1000
      const el = videoRef.current
      if (Math.abs(el.currentTime - sourceSec) > 0.02) {
        el.currentTime = Math.max(0, sourceSec)
      }
    }
  }, [isPlaying, playheadMs, audioActive, active, audioRef, videoRef])

  // Smooth playback via requestAnimationFrame (timeupdate is ~4 Hz and feels choppy).
  useEffect(() => {
    if (!isPlaying) {
      audioRef.current?.pause()
      videoRef.current?.pause()
      return
    }

    const session = ++playbackSessionRef.current
    const master = resolveMasterClip(usePlaybackStore.getState().playheadMs)
    if (!master) {
      setIsPlaying(false)
      return
    }

    const useAudioMaster = master.asset.type === 'audio' || master.layer.type === 'audio'
    const masterEl = useAudioMaster ? audioRef.current : videoRef.current
    if (!masterEl) {
      setIsPlaying(false)
      return
    }

    const { clip } = master
    const clipEndTimeline = clip.timelineStartMs + clipDurationMs(clip)
    const startSec = clipSourceMsAtTimeline(clip, usePlaybackStore.getState().playheadMs) / 1000

    masterEl.playbackRate = 1
    masterEl.currentTime = Math.max(0, startSec)

    if (useAudioMaster) {
      videoRef.current?.pause()
    } else {
      audioRef.current?.pause()
    }

    void masterEl.play().catch(() => {
      if (playbackSessionRef.current === session) {
        setIsPlaying(false)
      }
    })

    let rafId = 0

    const syncVideoPreview = (timelineMs: number): void => {
      const video = videoRef.current
      if (!video || !useAudioMaster) return
      const visual = useVideoEditorStore.getState().visualClipAtPlayhead(timelineMs)
      if (visual?.asset.type !== 'video') return
      const sourceSec = clipSourceMsAtTimeline(visual.clip, timelineMs) / 1000
      if (Math.abs(video.currentTime - sourceSec) > 0.04) {
        video.currentTime = Math.max(0, sourceSec)
      }
    }

    const tick = (): void => {
      if (playbackSessionRef.current !== session || !usePlaybackStore.getState().isPlaying) {
        return
      }

      const timelineMs = clipTimelineMsAtSource(clip, masterEl.currentTime * 1000)
      const sequenceDuration = useVideoEditorStore.getState().durationMs

      if (timelineMs >= clipEndTimeline - 16 || timelineMs >= sequenceDuration - 16) {
        setIsPlaying(false)
        setPlayheadMs(Math.min(sequenceDuration, clipEndTimeline))
        masterEl.pause()
        return
      }

      setPlayheadMs(Math.max(clip.timelineStartMs, timelineMs))
      syncVideoPreview(timelineMs)
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)

    return () => {
      playbackSessionRef.current = session + 1
      cancelAnimationFrame(rafId)
      masterEl.pause()
    }
  }, [isPlaying, durationMs, setIsPlaying, setPlayheadMs, audioRef, videoRef])
}
