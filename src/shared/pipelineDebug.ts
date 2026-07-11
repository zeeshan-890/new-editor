export type PipelineLogLevel = 'step' | 'segment' | 'prompt' | 'job' | 'warn' | 'error' | 'info'

export interface PipelineLogEvent {
  projectId: string
  at: number
  level: PipelineLogLevel
  step: string
  message: string
  data?: Record<string, unknown>
}
