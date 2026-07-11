import type { PipelineLogEvent, PipelineLogLevel } from '../../shared/pipelineDebug'
import { logInfo, logWarn, logError } from '../logger'

type LogCallback = (event: PipelineLogEvent) => void

let logCallback: LogCallback | null = null

export function setPipelineLogCallback(cb: LogCallback | null): void {
  logCallback = cb
}

export function pipelineDebugLog(
  projectId: string,
  level: PipelineLogLevel,
  step: string,
  message: string,
  data?: Record<string, unknown>
): void {
  const event: PipelineLogEvent = {
    projectId,
    at: Date.now(),
    level,
    step,
    message,
    ...(data ? { data } : {})
  }

  const prefix = `[Pipeline · ${step}] ${message}`
  if (level === 'error') {
    console.error(prefix, data ?? '')
    logError(`pipeline:${step}`, message, data)
  } else if (level === 'warn') {
    console.warn(prefix, data ?? '')
    logWarn(`pipeline:${step}`, message, data)
  } else {
    console.log(prefix, data ?? '')
    logInfo(`pipeline:${step}`, message, data)
  }

  logCallback?.(event)
}

export function pipelineLogSegmentStatuses(
  projectId: string,
  segments: Array<{ index: number; status: string; scriptText?: string }>
): void {
  pipelineDebugLog(projectId, 'segment', 'status', `Segment status snapshot (${segments.length})`, {
    segments: segments.map((s) => ({
      n: s.index + 1,
      status: s.status,
      script: s.scriptText?.slice(0, 60)
    }))
  })
}
