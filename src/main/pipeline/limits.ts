/** Keys must match `PipelineJobType` values used in orchestrator `canRun()`. */
export const PIPELINE_LIMITS = {
  character_anchor: 4,
  segment_image: 10,
  segment_audio_match: 1,
  segment_video: 5
} as const

/** Max jobs enqueued per pump wave — next wave starts only after the current one finishes. */
export const PIPELINE_BATCH_SIZE = {
  character_anchor: 4,
  segment_image: 10,
  segment_video: 5
} as const

/** Max Higgsfield CLI jobs executing at once (pipeline + manual generation). */
export const HIGGSFIELD_MAX_CONCURRENCY = 10
