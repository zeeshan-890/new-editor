import type { PipelineLogEvent } from '@shared/pipelineDebug'
import type { SegmentPipelineState } from '@shared/segmentPipeline'

const STEP_COLORS: Record<string, string> = {
  start: '#60a5fa',
  pump: '#38bdf8',
  audio: '#a78bfa',
  anchor: '#f472b6',
  image: '#34d399',
  video: '#fbbf24',
  job: '#fb923c',
  analyze: '#c084fc',
  status: '#94a3b8',
  error: '#f87171'
}

function stepColor(step: string): string {
  const key = Object.keys(STEP_COLORS).find((k) => step.toLowerCase().includes(k))
  return key ? STEP_COLORS[key] : '#22d3ee'
}

export function printPipelineLog(event: PipelineLogEvent): void {
  const time = new Date(event.at).toLocaleTimeString()
  const color = event.level === 'error' ? '#f87171' : event.level === 'warn' ? '#fbbf24' : stepColor(event.step)
  const method =
    event.level === 'error' ? 'error' : event.level === 'warn' ? 'warn' : 'log'

  console[method](
    `%c[Pipeline ${time}]%c ${event.step} %c→ ${event.message}`,
    'color:#64748b',
    `color:${color}; font-weight:600`,
    'color:inherit',
    event.data ?? ''
  )

  if (event.level === 'prompt' && event.data?.prompt) {
    console.log('%c  Prompt:', 'color:#94a3b8; font-weight:600', event.data.prompt)
  }
}

export function printPipelineStateUpdate(projectId: string, pipeline: SegmentPipelineState): void {
  const running = pipeline.segments.filter((s) =>
    ['image_running', 'video_running', 'anchor_running'].includes(s.status)
  ).length
  const done = pipeline.segments.filter((s) =>
    ['image_done', 'video_done', 'timeline_placed'].includes(s.status)
  ).length

  console.groupCollapsed(
    `%c[Pipeline] State update · ${pipeline.pipelineStatus}%c · ${done}/${pipeline.segments.length} done · ${running} active`,
    'color:#22d3ee; font-weight:600',
    'color:#94a3b8'
  )
  console.log('projectId:', projectId)
  console.table(
    pipeline.segments.map((s) => ({
      '#': s.index + 1,
      status: s.status,
      script: s.scriptText.slice(0, 50) + (s.scriptText.length > 50 ? '…' : ''),
      imagePrompt: s.imagePrompt.slice(0, 50) + (s.imagePrompt.length > 50 ? '…' : ''),
      hasImage: Boolean(s.imageLocalPath),
      hasVideo: Boolean(s.videoLocalPath),
      audio: s.scriptMatch
        ? `${(s.scriptMatch.startMs / 1000).toFixed(1)}s–${(s.scriptMatch.endMs / 1000).toFixed(1)}s`
        : '—'
    }))
  )
  if (pipeline.characters.length > 0) {
    console.log('Characters:', pipeline.characters.map((c) => ({
      name: c.name,
      anchor: c.anchorStatus ?? (c.anchorImagePath ? 'done' : 'pending')
    })))
  }
  console.groupEnd()
}
