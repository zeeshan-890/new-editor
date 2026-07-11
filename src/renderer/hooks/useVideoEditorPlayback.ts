import { useEffect, useRef } from 'react'
import { useVideoEditorStore } from '@renderer/stores/videoEditorStore'
import { usePlayheadStore } from '@renderer/stores/playheadStore'
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
  const isPlaying = usePlayheadStore((s) => s.isPlaying)
  const playheadMs = usePlayheadStore((s) => s.playheadMs)
  const setPlayheadMs = usePlayheadStore((s) => s.setPlayheadMs)
  const setIsPlaying = usePlayheadStore((s) => s.setIsPlaying)
  const durationMs = useVideoEditorStore((s) => s.durationMs)
  const syncAssetDuration = useVideoEditorStore((s) => s.syncAssetDuration)
  const audioClipAtPlayhead = useVideoEditorStore((s) => s.audioClipAtPlayhead)
  const visualClipAtPlayhead = useVideoEditorStore((s) => s.visualClipAtPlayhead)

  const audioActive = audioClipAtPlayhead(playheadMs)
  const active = visualClipAtPlayhead(playheadMs)

  const playbackSessionRef = useRef(0)
  const lastCommittedPlayheadMsRef = useRef(0)

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
      if (!usePlayheadStore.getState().isPlaying) {
        const sourceMs = clipSourceMsAtTimeline(clip, usePlayheadStore.getState().playheadMs)
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
    const master = resolveMasterClip(usePlayheadStore.getState().playheadMs)
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
    const startSec = clipSourceMsAtTimeline(clip, usePlayheadStore.getState().playheadMs) / 1000
    lastCommittedPlayheadMsRef.current = usePlayheadStore.getState().playheadMs
    let usingWallClock = false
    let lastTs = performance.now()

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
      if (!video) return
      const visual = useVideoEditorStore.getState().visualClipAtPlayhead(timelineMs)
      if (visual?.asset.type !== 'video') {
        video.pause()
        return
      }
      const sourceSec = clipSourceMsAtTimeline(visual.clip, timelineMs) / 1000
      if (Math.abs(video.currentTime - sourceSec) > 0.04) {
        video.currentTime = Math.max(0, sourceSec)
      }
      if (video.paused) {
        void video.play().catch(() => {})
      }
    }

    const syncAudioPreview = (timelineMs: number): void => {
      const audio = audioRef.current
      if (!audio) return
      const audioHit = useVideoEditorStore.getState().audioClipAtPlayhead(timelineMs)
      if (!audioHit) {
        audio.pause()
        return
      }
      const sourceSec = clipSourceMsAtTimeline(audioHit.clip, timelineMs) / 1000
      if (audio.src !== localAudioPathUrl(audioHit.asset.path)) {
        masterPathRef.current = audioHit.asset.path
        audio.src = localAudioPathUrl(audioHit.asset.path)
      }
      if (Math.abs(audio.currentTime - sourceSec) > 0.04) {
        audio.currentTime = Math.max(0, sourceSec)
      }
      if (audio.paused) {
        void audio.play().catch(() => {})
      }
    }

    const tick = (ts: number): void => {
      if (playbackSessionRef.current !== session || !usePlayheadStore.getState().isPlaying) {
        return
      }

      const sequenceDuration = useVideoEditorStore.getState().durationMs

      if (usingWallClock) {
        const delta = ts - lastTs
        lastTs = ts
        const next = usePlayheadStore.getState().playheadMs + delta
        if (next >= sequenceDuration - 16) {
          setIsPlaying(false)
          setPlayheadMs(sequenceDuration)
          audioRef.current?.pause()
          videoRef.current?.pause()
          return
        }
        setPlayheadMs(next)
        lastCommittedPlayheadMsRef.current = next
        syncVideoPreview(next)
        syncAudioPreview(next)
        rafId = requestAnimationFrame(tick)
        return
      }

      const timelineMs = clipTimelineMsAtSource(clip, masterEl.currentTime * 1000)

      if (
        useAudioMaster &&
        timelineMs >= clipEndTimeline - 16 &&
        clipEndTimeline < sequenceDuration - 16
      ) {
        usingWallClock = true
        masterEl.pause()
        lastTs = ts
        const handoffMs = Math.max(clip.timelineStartMs, Math.min(clipEndTimeline, timelineMs))
        setPlayheadMs(handoffMs)
        lastCommittedPlayheadMsRef.current = handoffMs
        syncVideoPreview(handoffMs)
        rafId = requestAnimationFrame(tick)
        return
      }

      if (timelineMs >= clipEndTimeline - 16 || timelineMs >= sequenceDuration - 16) {
        setIsPlaying(false)
        setPlayheadMs(Math.min(sequenceDuration, clipEndTimeline))
        masterEl.pause()
        return
      }

      const nextPlayheadMs = Math.max(clip.timelineStartMs, timelineMs)
      if (Math.abs(nextPlayheadMs - lastCommittedPlayheadMsRef.current) >= 15) {
        setPlayheadMs(nextPlayheadMs)
        lastCommittedPlayheadMsRef.current = nextPlayheadMs
      }
      syncVideoPreview(timelineMs)
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)

    return () => {
      playbackSessionRef.current = session + 1
      cancelAnimationFrame(rafId)
      masterEl.pause()
    }
  }, [isPlaying, durationMs, setIsPlaying, setPlayheadMs, audioRef, videoRef, masterPathRef])
}
