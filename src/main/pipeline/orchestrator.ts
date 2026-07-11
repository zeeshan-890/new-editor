import { join } from 'path'
import { existsSync } from 'fs'
import { promises as fs } from 'fs'
import type { HiggsfieldGenerationJob } from '../../shared/types'
import type { PipelineJobType, PipelineGenerationPhase, SegmentPipelineState } from '../../shared/segmentPipeline'
import {
  allSegmentImagesComplete,
  anchorsInFlight,
  createEmptyPipelineState,
  imagesInFlight,
  normalizePipelineState,
  videosInFlight
} from '../../shared/segmentPipeline'
import type { GenerationProject } from '../../shared/types'
import { normalizeLoadedGenerationProject } from '../../shared/segmentPipeline'
import { loadProject, saveProject, mediaDir, importMediaToProject } from '../projects/store'
import { enqueueJob, getJob } from '../higgsfield/queue'
import { batchMatchScriptAudio } from '../alignment/batchMatchScript'
import {
  buildCharacterAnchorEnqueue,
  buildSegmentImageEnqueue,
  buildSegmentVideoEnqueue,
  validatePipelineImagesReady,
  validatePipelineVideosReady
} from './jobHandlers'
import { PIPELINE_LIMITS, PIPELINE_BATCH_SIZE } from './limits'
import { logError, logInfo } from '../logger'
import { syncPipelineMasterAudioFromTimeline } from './timelineAudio'
import type { VideoEditorProject } from '../../shared/types'
import {
  pipelineDebugLog,
  pipelineLogSegmentStatuses,
  setPipelineLogCallback
} from './debugLog'
import {
  buildCharacterAnchorPrompt,
  buildSegmentImagePrompt
} from './jobHandlers'

export interface PipelineJobMeta {
  projectId: string
  type: PipelineJobType
  segmentId?: string
  characterId?: string
}

type NotifyFn = (projectId: string, pipeline: SegmentPipelineState) => void

const jobMeta = new Map<string, PipelineJobMeta>()
const runningCounts: Record<string, number> = {
  character_anchor: 0,
  segment_image: 0,
  segment_audio_match: 0,
  segment_video: 0
}
const pausedProjects = new Set<string>()
const imageBatchQuota = new Map<string, number>()
const videoBatchQuota = new Map<string, number>()
let notifyCallback: NotifyFn | null = null

export function setPipelineNotifyCallback(cb: NotifyFn | null): void {
  notifyCallback = cb
}

function emit(projectId: string, pipeline: SegmentPipelineState): void {
  notifyCallback?.(projectId, pipeline)
}

async function loadProjectPipeline(projectId: string): Promise<{
  project: GenerationProject
  pipeline: SegmentPipelineState
} | null> {
  const project = await loadProject(projectId)
  if (!project) return null
  const normalized = normalizeLoadedGenerationProject(project)
  if (!normalized.pipeline) return null
  return {
    project: normalized,
    pipeline: normalizePipelineState(normalized.pipeline)
  }
}

async function persistPipeline(
  project: GenerationProject,
  pipeline: SegmentPipelineState
): Promise<GenerationProject> {
  const next = { ...project, pipeline, updatedAt: Date.now() }
  return saveProject(next)
}

async function appendPipelineLog(
  projectId: string,
  message: string,
  data?: Record<string, unknown>
): Promise<void> {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    message,
    ...data
  })
  const logPath = join(mediaDir(projectId), 'pipeline-log.jsonl')
  await fs.appendFile(logPath, `${line}\n`, 'utf-8').catch(() => {})
  logInfo('pipeline', message, data)
}

function registerJob(jobId: string, meta: PipelineJobMeta): void {
  jobMeta.set(jobId, meta)
}

export function getPipelineJobMeta(jobId: string): PipelineJobMeta | undefined {
  return jobMeta.get(jobId)
}

function canRun(type: PipelineJobType): boolean {
  if (type === 'timeline_place') return true
  const key = type as keyof typeof PIPELINE_LIMITS
  return runningCounts[key] < PIPELINE_LIMITS[key]
}

function incRunning(type: PipelineJobType): void {
  if (type !== 'timeline_place') {
    runningCounts[type as keyof typeof PIPELINE_LIMITS] += 1
  }
}

function decRunning(type: PipelineJobType): void {
  if (type !== 'timeline_place') {
    runningCounts[type as keyof typeof PIPELINE_LIMITS] = Math.max(
      0,
      runningCounts[type as keyof typeof PIPELINE_LIMITS] - 1
    )
  }
}

async function verifyMediaFileAsync(localPath: string): Promise<boolean> {
  try {
    if (!existsSync(localPath)) return false
    const stat = await fs.stat(localPath)
    return stat.size > 0
  } catch {
    return false
  }
}

function isInProjectMedia(projectId: string, filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  const root = mediaDir(projectId).replace(/\\/g, '/')
  return normalized.startsWith(root)
}

async function persistPipelineJobMedia(
  projectId: string,
  localPath: string
): Promise<string> {
  if (isInProjectMedia(projectId, localPath)) return localPath
  const imported = await importMediaToProject(projectId, localPath)
  return imported.localPath
}

function anchorsReady(pipeline: SegmentPipelineState): boolean {
  return pipeline.characters.every(
    (c) =>
      !pipeline.segments.some((s) => s.characters.includes(c.id)) ||
      Boolean(c.anchorImagePath) ||
      c.anchorStatus === 'done'
  )
}

function segmentImageReady(segmentId: string, pipeline: SegmentPipelineState): boolean {
  const segment = pipeline.segments.find((s) => s.id === segmentId)
  if (!segment) return false
  for (const charId of segment.characters) {
    const ch = pipeline.characters.find((c) => c.id === charId)
    if (!ch) continue
    if (ch.anchorImagePath) continue
    if (ch.anchorStatus === 'failed') continue
    if (ch.anchorStatus === 'running') return false
    return false
  }
  return true
}

function canStartNextImageBatch(pipeline: SegmentPipelineState): boolean {
  return !imagesInFlight(pipeline) && !anchorsInFlight(pipeline)
}

function canStartNextVideoBatch(pipeline: SegmentPipelineState): boolean {
  return !videosInFlight(pipeline)
}

function isActiveGenerationJob(jobId: string | undefined): boolean {
  if (!jobId) return false
  const job = getJob(jobId)
  return job?.status === 'queued' || job?.status === 'running'
}

function releaseOrphanedJobMeta(jobId: string | undefined): void {
  if (!jobId) return
  const meta = jobMeta.get(jobId)
  if (!meta) return
  decRunning(meta.type)
  jobMeta.delete(jobId)
}

/** Clear segments/anchors stuck in *_running when their job is gone or already terminal. */
function clearStaleRunningStatuses(pipeline: SegmentPipelineState): {
  pipeline: SegmentPipelineState
  cleared: number
} {
  let cleared = 0
  const interrupted = 'Generation was interrupted or the job is no longer running'

  const characters = pipeline.characters.map((character) => {
    if (character.anchorStatus !== 'running') return character
    if (isActiveGenerationJob(character.anchorImageJobId)) return character
    releaseOrphanedJobMeta(character.anchorImageJobId)
    cleared += 1
    return {
      ...character,
      anchorStatus: character.anchorImagePath ? ('done' as const) : ('failed' as const)
    }
  })

  const segments = pipeline.segments.map((segment) => {
    if (segment.status === 'image_running') {
      if (isActiveGenerationJob(segment.imageJobId)) return segment
      releaseOrphanedJobMeta(segment.imageJobId)
      cleared += 1
      if (segment.imageLocalPath) {
        return {
          ...segment,
          status: 'image_done' as const,
          error: undefined
        }
      }
      return {
        ...segment,
        status: 'failed' as const,
        error: interrupted,
        imageJobId: undefined
      }
    }

    if (segment.status === 'video_running') {
      if (isActiveGenerationJob(segment.videoJobId)) return segment
      releaseOrphanedJobMeta(segment.videoJobId)
      cleared += 1
      if (segment.videoLocalPath) {
        return {
          ...segment,
          status: 'video_done' as const,
          error: undefined
        }
      }
      return {
        ...segment,
        status: segment.imageLocalPath ? ('image_done' as const) : ('failed' as const),
        error: interrupted,
        videoJobId: undefined
      }
    }

    return segment
  })

  if (cleared === 0) return { pipeline, cleared: 0 }
  return { pipeline: { ...pipeline, characters, segments }, cleared }
}

async function reconcileStaleRunning(
  projectId: string,
  project: GenerationProject,
  pipeline: SegmentPipelineState
): Promise<{ project: GenerationProject; pipeline: SegmentPipelineState }> {
  const { pipeline: next, cleared } = clearStaleRunningStatuses(pipeline)
  if (cleared === 0) return { project, pipeline }
  pipelineDebugLog(projectId, 'warn', 'pump', `Cleared ${cleared} stuck running segment(s)/anchor(s)`, {
    cleared
  })
  await appendPipelineLog(projectId, 'Cleared stuck running statuses', { cleared })
  const saved = await persistPipeline(project, next)
  emit(projectId, next)
  return { project: saved, pipeline: next }
}

async function finishManualBatchIfIdle(
  projectId: string,
  pipeline: SegmentPipelineState
): Promise<SegmentPipelineState> {
  if (pipeline.pipelineStatus !== 'running' || pausedProjects.has(projectId)) {
    return pipeline
  }

  const phase = pipeline.activePhase
  if (phase === 'images' && canStartNextImageBatch(pipeline)) {
    imageBatchQuota.delete(projectId)
    const next = { ...pipeline, pipelineStatus: 'idle' as const, activePhase: undefined }
    if (allSegmentImagesComplete(next)) {
      pipelineDebugLog(projectId, 'step', 'pump', 'All images complete — ready for videos')
      await appendPipelineLog(projectId, 'All segment images complete')
    } else {
      pipelineDebugLog(projectId, 'step', 'pump', 'Image batch complete — generate next batch when ready')
      await appendPipelineLog(projectId, 'Image batch complete')
    }
    return next
  }

  if (phase === 'videos' && canStartNextVideoBatch(pipeline)) {
    videoBatchQuota.delete(projectId)
    if (allVideosDone(pipeline)) {
      const allOk = pipeline.segments.every((s) => s.videoLocalPath || s.status === 'failed')
      pipelineDebugLog(projectId, 'step', 'pump', 'All videos complete')
      await appendPipelineLog(projectId, 'Video generation complete')
      return { ...pipeline, pipelineStatus: allOk ? 'complete' : 'failed', activePhase: undefined }
    }
    pipelineDebugLog(projectId, 'step', 'pump', 'Video batch complete — generate next batch when ready')
    await appendPipelineLog(projectId, 'Video batch complete')
    return { ...pipeline, pipelineStatus: 'idle', activePhase: undefined }
  }

  return pipeline
}

async function enqueueCharacterAnchors(
  projectId: string,
  project: GenerationProject,
  pipeline: SegmentPipelineState
): Promise<SegmentPipelineState> {
  let next = { ...pipeline }
  const runningAnchors = next.characters.filter((c) => c.anchorStatus === 'running').length
  if (runningAnchors >= PIPELINE_BATCH_SIZE.character_anchor) {
    pipelineDebugLog(projectId, 'info', 'anchor', 'Waiting for character anchor batch to finish', {
      running: runningAnchors
    })
    return next
  }

  let enqueued = 0
  const batchLimit = Math.min(
    PIPELINE_BATCH_SIZE.character_anchor,
    PIPELINE_LIMITS.character_anchor - runningAnchors
  )

  for (const character of next.characters) {
    if (enqueued >= batchLimit) break
    if (character.anchorImagePath || character.anchorStatus === 'running') continue
    if (!canRun('character_anchor')) {
      pipelineDebugLog(projectId, 'warn', 'anchor', 'Character anchor limit reached — waiting', {
        character: character.name
      })
      break
    }

    const used = next.segments.some((s) => s.characters.includes(character.id))
    if (!used) {
      character.anchorStatus = 'done'
      continue
    }

    const prompt = buildCharacterAnchorPrompt(character, next)
    const request = buildCharacterAnchorEnqueue(
      projectId,
      character,
      next,
      next.workspaceId ?? project.workspaceId
    )
    pipelineDebugLog(projectId, 'prompt', 'anchor', `Enqueue character anchor: ${character.name}`, {
      characterId: character.id,
      model: request.model,
      prompt
    })
    const job = await enqueueJob(request)
    registerJob(job.id, {
      projectId,
      type: 'character_anchor',
      characterId: character.id
    })
    character.anchorStatus = 'running'
    character.anchorImageJobId = job.id
    incRunning('character_anchor')
    enqueued += 1
    pipelineDebugLog(projectId, 'job', 'anchor', `Character anchor job queued: ${character.name}`, {
      characterId: character.id,
      jobId: job.id
    })
    await appendPipelineLog(projectId, 'Enqueued character anchor', {
      characterId: character.id,
      jobId: job.id
    })
  }
  return next
}

async function enqueueSegmentImages(
  projectId: string,
  project: GenerationProject,
  pipeline: SegmentPipelineState
): Promise<SegmentPipelineState> {
  let next = { ...pipeline, segments: [...pipeline.segments] }

  let quota = imageBatchQuota.get(projectId) ?? 0
  if (quota <= 0) {
    pipelineDebugLog(projectId, 'info', 'image', 'No image batch quota — waiting for user to start next batch')
    return next
  }

  const sorted = [...next.segments].sort((a, b) => a.index - b.index)
  let enqueued = 0

  for (let i = 0; i < sorted.length; i++) {
    if (quota <= 0) break
    const segment = sorted[i]
    const idx = next.segments.findIndex((s) => s.id === segment.id)
    if (idx < 0) continue
    const current = next.segments[idx]
    if (
      current.imageLocalPath ||
      current.status === 'image_running' ||
      current.status === 'image_done' ||
      current.status === 'video_running' ||
      current.status === 'video_done' ||
      current.status === 'timeline_placed'
    ) {
      continue
    }
    if (!segmentImageReady(segment.id, next)) {
      pipelineDebugLog(projectId, 'info', 'image', `Segment ${segment.index + 1} waiting for character anchors`, {
        segmentId: segment.id,
        characters: segment.characters
      })
      continue
    }
    if (!canRun('segment_image')) {
      pipelineDebugLog(projectId, 'warn', 'image', 'Segment image limit reached — waiting', {
        segment: segment.index + 1
      })
      break
    }

    const prevSegment = i > 0 ? sorted[i - 1] : undefined
    const prompt = buildSegmentImagePrompt(current, next)
    const request = buildSegmentImageEnqueue(
      projectId,
      current,
      next,
      prevSegment?.imageLocalPath,
      next.workspaceId ?? project.workspaceId
    )
    pipelineDebugLog(projectId, 'prompt', 'image', `Enqueue segment ${segment.index + 1} image`, {
      segmentId: segment.id,
      model: request.model,
      referenceCount: request.references?.length ?? 0,
      script: current.scriptText.slice(0, 100),
      prompt
    })
    const job = await enqueueJob(request)
    registerJob(job.id, { projectId, type: 'segment_image', segmentId: segment.id })
    next.segments[idx] = { ...current, status: 'image_running', imageJobId: job.id, error: undefined }
    incRunning('segment_image')
    enqueued += 1
    quota -= 1
    pipelineDebugLog(projectId, 'job', 'image', `Segment ${segment.index + 1} image job queued`, {
      segmentId: segment.id,
      jobId: job.id
    })
    await appendPipelineLog(projectId, 'Enqueued segment image', {
      segmentId: segment.id,
      jobId: job.id
    })
  }
  imageBatchQuota.set(projectId, quota)
  return next
}

async function runAudioMatches(
  projectId: string,
  pipeline: SegmentPipelineState
): Promise<SegmentPipelineState> {
  if (!pipeline.masterAudioPath) return pipeline
  if (!canRun('segment_audio_match')) return pipeline
  if (imagesInFlight(pipeline) || anchorsInFlight(pipeline)) return pipeline

  const pending = pipeline.segments.filter((s) => !s.scriptMatch)
  if (pending.length === 0) return pipeline

  const allSegments = [...pipeline.segments].sort((a, b) => a.index - b.index)
  pipelineDebugLog(projectId, 'step', 'audio', `Matching ${allSegments.length} segments to timeline audio`, {
    audioPath: pipeline.masterAudioPath,
    segments: allSegments.map((s) => ({ n: s.index + 1, script: s.scriptText.slice(0, 80) }))
  })

  incRunning('segment_audio_match')
  try {
    const result = await batchMatchScriptAudio({
      audioPath: pipeline.masterAudioPath,
      fullScript: pipeline.fullScript,
      segments: allSegments.map((s) => ({
        id: s.id,
        scriptText: s.scriptText,
        index: s.index
      })),
      audioDurationMs: pipeline.masterAudioDurationMs
    })

    if (result.matches.length === 0) {
      const summary =
        result.warnings[0] ??
        'Audio matching failed for all segments. Check that timeline audio matches the script.'
      for (const warning of result.warnings) {
        await appendPipelineLog(projectId, 'Audio match failed', { warning })
        pipelineDebugLog(projectId, 'warn', 'audio', warning)
      }
      return {
        ...pipeline,
        lastError: summary
      }
    }

    let next = {
      ...pipeline,
      lastError: undefined,
      segments: pipeline.segments.map((s) => ({ ...s }))
    }

    for (const { segmentId, match } of result.matches) {
      const idx = next.segments.findIndex((s) => s.id === segmentId)
      if (idx >= 0) {
        next.segments[idx] = {
          ...next.segments[idx],
          scriptMatch: match,
          status:
            next.segments[idx].status === 'pending'
              ? 'audio_match_done'
              : next.segments[idx].status
        }
      }
    }

    for (const warning of result.warnings) {
      await appendPipelineLog(projectId, 'Audio match warning', { warning })
      pipelineDebugLog(projectId, 'warn', 'audio', warning)
    }

    pipelineDebugLog(projectId, 'step', 'audio', `Audio match complete: ${result.matches.length}/${allSegments.length}`, {
      matched: result.matches.map((m) => ({
        segmentId: m.segmentId,
        startMs: m.match.startMs,
        endMs: m.match.endMs,
        durationMs: m.match.durationMs
      }))
    })

    return next
  } finally {
    decRunning('segment_audio_match')
  }
}

async function enqueueSegmentVideos(
  projectId: string,
  project: GenerationProject,
  pipeline: SegmentPipelineState
): Promise<SegmentPipelineState> {
  let next = { ...pipeline, segments: [...pipeline.segments] }

  if (!allSegmentImagesComplete(next)) {
    pipelineDebugLog(projectId, 'info', 'video', 'Video phase waiting — images still generating', {
      imagesDone: next.segments.filter((s) => s.imageLocalPath).length,
      total: next.segments.length,
      inFlight: imagesInFlight(next)
    })
    return next
  }

  let quota = videoBatchQuota.get(projectId) ?? 0
  if (quota <= 0) {
    pipelineDebugLog(projectId, 'info', 'video', 'No video batch quota — waiting for user to start next batch')
    return next
  }

  const sorted = [...next.segments].sort((a, b) => a.index - b.index)
  let enqueued = 0

  for (const segment of sorted) {
    if (quota <= 0) break
    if (!segment.imageLocalPath || !segment.scriptMatch) continue
    if (
      segment.videoLocalPath ||
      segment.status === 'video_running' ||
      segment.status === 'video_done' ||
      segment.status === 'timeline_placed'
    ) {
      continue
    }
    if (!canRun('segment_video')) {
      pipelineDebugLog(projectId, 'warn', 'video', 'Segment video limit reached — waiting', {
        segment: segment.index + 1
      })
      break
    }

    try {
      const request = buildSegmentVideoEnqueue(
        projectId,
        segment,
        next,
        next.workspaceId ?? project.workspaceId
      )
      const motion =
        segment.videoMotionPrompt?.trim() ||
        'Subtle natural motion, gentle camera movement, cinematic pacing.'
      pipelineDebugLog(projectId, 'prompt', 'video', `Enqueue segment ${segment.index + 1} video`, {
        segmentId: segment.id,
        model: request.model,
        duration: request.params?.duration,
        startImage: segment.imageLocalPath,
        audioMatch: segment.scriptMatch
          ? `${segment.scriptMatch.startMs}–${segment.scriptMatch.endMs}ms`
          : null,
        prompt: motion
      })
      const job = await enqueueJob(request)
      registerJob(job.id, { projectId, type: 'segment_video', segmentId: segment.id })
      const idx = next.segments.findIndex((s) => s.id === segment.id)
      next.segments[idx] = {
        ...segment,
        status: 'video_running',
        videoJobId: job.id,
        error: undefined
      }
      incRunning('segment_video')
      enqueued += 1
      quota -= 1
      pipelineDebugLog(projectId, 'job', 'video', `Segment ${segment.index + 1} video job queued`, {
        segmentId: segment.id,
        jobId: job.id
      })
      await appendPipelineLog(projectId, 'Enqueued segment video', {
        segmentId: segment.id,
        jobId: job.id
      })
    } catch (err) {
      const idx = next.segments.findIndex((s) => s.id === segment.id)
      next.segments[idx] = {
        ...segment,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }
  videoBatchQuota.set(projectId, quota)
  if (enqueued === 0) {
    const missingMatch = next.segments.filter(
      (s) =>
        s.imageLocalPath &&
        !s.videoLocalPath &&
        !s.scriptMatch &&
        s.status !== 'failed' &&
        s.status !== 'video_running'
    ).length
    if (missingMatch > 0) {
      next = {
        ...next,
        lastError: `${missingMatch} segment(s) have no audio timing — sync timeline audio and try again.`
      }
    }
  }
  return next
}

function allVideosDone(pipeline: SegmentPipelineState): boolean {
  return (
    pipeline.segments.length > 0 &&
    pipeline.segments.every((s) => s.videoLocalPath || s.status === 'failed')
  )
}

async function pump(projectId: string): Promise<void> {
  if (pausedProjects.has(projectId)) {
    pipelineDebugLog(projectId, 'info', 'pump', 'Pump skipped — pipeline paused')
    return
  }

  const loaded = await loadProjectPipeline(projectId)
  if (!loaded) return
  let { project, pipeline } = loaded

  const reconciled = await reconcileStaleRunning(projectId, project, pipeline)
  project = reconciled.project
  pipeline = reconciled.pipeline

  if (pipeline.pipelineStatus !== 'running') {
    pipelineDebugLog(projectId, 'info', 'pump', `Pump skipped — status is ${pipeline.pipelineStatus}`)
    return
  }

  const phase = pipeline.activePhase ?? 'images'

  pipelineDebugLog(projectId, 'step', 'pump', 'Pump cycle started', {
    phase,
    imageQuota: imageBatchQuota.get(projectId) ?? 0,
    videoQuota: videoBatchQuota.get(projectId) ?? 0,
    segments: pipeline.segments.length,
    runningCounts: { ...runningCounts }
  })
  pipelineLogSegmentStatuses(projectId, pipeline.segments)

  if (phase === 'images') {
    if (!imagesInFlight(pipeline) && !anchorsInFlight(pipeline)) {
      pipeline = await runAudioMatches(projectId, pipeline)
      project = await persistPipeline(project, pipeline)
      emit(projectId, pipeline)
    }

    pipeline = await enqueueCharacterAnchors(projectId, project, pipeline)
    project = await persistPipeline(project, pipeline)
    emit(projectId, pipeline)

    pipeline = await enqueueSegmentImages(projectId, project, pipeline)
    project = await persistPipeline(project, pipeline)
    emit(projectId, pipeline)

    pipeline = await finishManualBatchIfIdle(projectId, pipeline)
  } else if (phase === 'videos') {
    if (!allSegmentImagesComplete(pipeline)) {
      pipelineDebugLog(projectId, 'warn', 'pump', 'Video phase blocked — images not complete')
    } else {
      if (!videosInFlight(pipeline)) {
        pipeline = await runAudioMatches(projectId, pipeline)
        project = await persistPipeline(project, pipeline)
        emit(projectId, pipeline)
      }

      pipeline = await enqueueSegmentVideos(projectId, project, pipeline)
      pipeline = await finishManualBatchIfIdle(projectId, pipeline)
    }
  }

  project = await persistPipeline(project, pipeline)
  emit(projectId, pipeline)
  pipelineLogSegmentStatuses(projectId, pipeline.segments)
  pipelineDebugLog(projectId, 'step', 'pump', 'Pump cycle finished')
}

async function beginPipelinePhase(
  projectId: string,
  phase: PipelineGenerationPhase,
  editorOverride?: VideoEditorProject,
  pipelineOverride?: SegmentPipelineState
): Promise<SegmentPipelineState> {
  let project: GenerationProject
  let pipeline: SegmentPipelineState

  if (phase === 'videos') {
    const synced = await syncPipelineMasterAudioFromTimeline(
      projectId,
      editorOverride,
      pipelineOverride
    )
    project = synced
    pipeline = normalizePipelineState(synced.pipeline)
  } else {
    const loaded = await loadProjectPipeline(projectId)
    if (!loaded) throw new Error('Project not found.')
    project = loaded.project
    if (editorOverride) {
      project = {
        ...project,
        videoEditor: editorOverride
      }
    }
    pipeline = normalizePipelineState(
      pipelineOverride ?? project.pipeline ?? createEmptyPipelineState()
    )
  }

  const err =
    phase === 'videos'
      ? validatePipelineVideosReady(pipeline)
      : validatePipelineImagesReady(pipeline)
  if (err) throw new Error(err)

  const reconciled = await reconcileStaleRunning(projectId, project, pipeline)
  project = reconciled.project
  pipeline = reconciled.pipeline

  if (phase === 'videos') {
    if (imagesInFlight(pipeline) || anchorsInFlight(pipeline)) {
      throw new Error('Image generation is still in progress. Wait for the current batch to finish.')
    }
    if (!allSegmentImagesComplete(pipeline)) {
      const missing = pipeline.segments.filter(
        (s) => !s.imageLocalPath && s.status !== 'failed'
      ).length
      throw new Error(
        `${missing} segment image(s) are still missing. Generate all image batches before starting videos.`
      )
    }
  }

  if (phase === 'images') {
    if (imagesInFlight(pipeline) || anchorsInFlight(pipeline)) {
      throw new Error('Wait for the current image batch to finish before starting the next one.')
    }
  }

  pausedProjects.delete(projectId)
  if (phase === 'images') {
    imageBatchQuota.set(projectId, PIPELINE_BATCH_SIZE.segment_image)
  } else {
    videoBatchQuota.set(projectId, PIPELINE_BATCH_SIZE.segment_video)
  }
  pipeline = { ...pipeline, pipelineStatus: 'running', activePhase: phase, lastError: undefined }
  pipelineDebugLog(projectId, 'step', 'start', `Pipeline ${phase} phase started`, {
    segments: pipeline.segments.length,
    masterAudioPath: pipeline.masterAudioPath,
    imageModel: pipeline.imageModel,
    videoModel: pipeline.videoModel
  })
  await persistPipeline(project, pipeline)
  await appendPipelineLog(
    projectId,
    phase === 'videos'
      ? 'Pipeline videos phase started (timeline audio synced)'
      : 'Pipeline images phase started'
  )
  emit(projectId, pipeline)
  await pump(projectId)
  const latest = await loadProjectPipeline(projectId)
  return latest?.pipeline ?? pipeline
}

export async function startPipelineImages(
  projectId: string,
  editorOverride?: VideoEditorProject,
  pipelineOverride?: SegmentPipelineState
): Promise<SegmentPipelineState> {
  return beginPipelinePhase(projectId, 'images', editorOverride, pipelineOverride)
}

export async function startPipelineVideos(
  projectId: string,
  editorOverride?: VideoEditorProject,
  pipelineOverride?: SegmentPipelineState
): Promise<SegmentPipelineState> {
  return beginPipelinePhase(projectId, 'videos', editorOverride, pipelineOverride)
}

/** @deprecated Use startPipelineImages */
export async function startPipeline(
  projectId: string,
  editorOverride?: VideoEditorProject,
  pipelineOverride?: SegmentPipelineState
): Promise<SegmentPipelineState> {
  return startPipelineImages(projectId, editorOverride, pipelineOverride)
}

export async function pausePipeline(projectId: string): Promise<SegmentPipelineState> {
  pausedProjects.add(projectId)
  const loaded = await loadProjectPipeline(projectId)
  if (!loaded) throw new Error('Project not found.')
  const pipeline = { ...loaded.pipeline, pipelineStatus: 'paused' as const }
  await persistPipeline(loaded.project, pipeline)
  emit(projectId, pipeline)
  return pipeline
}

export async function resumePipeline(
  projectId: string,
  editorOverride?: VideoEditorProject,
  pipelineOverride?: SegmentPipelineState
): Promise<SegmentPipelineState> {
  pausedProjects.delete(projectId)
  const loaded = await loadProjectPipeline(projectId)
  if (!loaded) throw new Error('Project not found.')

  let project = loaded.project
  let pipeline = normalizePipelineState(pipelineOverride ?? loaded.pipeline)

  if (pipeline.activePhase === 'videos') {
    const synced = await syncPipelineMasterAudioFromTimeline(
      projectId,
      editorOverride,
      pipeline
    )
    project = synced
    pipeline = normalizePipelineState(synced.pipeline)
  } else if (editorOverride) {
    project = { ...project, videoEditor: editorOverride }
  }

  pipeline = {
    ...pipeline,
    pipelineStatus: 'running' as const
  }
  await persistPipeline(project, pipeline)
  emit(projectId, pipeline)
  await appendPipelineLog(
    projectId,
    pipeline.activePhase === 'videos'
      ? 'Pipeline resumed (timeline audio re-synced)'
      : 'Pipeline resumed'
  )
  await pump(projectId)
  return pipeline
}

export async function retrySegment(
  projectId: string,
  segmentId: string,
  stage: 'image' | 'video' | 'full'
): Promise<SegmentPipelineState> {
  const loaded = await loadProjectPipeline(projectId)
  if (!loaded) throw new Error('Project not found.')

  let pipeline = { ...loaded.pipeline, segments: [...loaded.pipeline.segments] }
  const idx = pipeline.segments.findIndex((s) => s.id === segmentId)
  if (idx < 0) throw new Error('Segment not found.')

  const segment = pipeline.segments[idx]
  if (stage === 'image' || stage === 'full') {
    pipeline.segments[idx] = {
      ...segment,
      status: 'pending',
      imageJobId: undefined,
      imageLocalPath: undefined,
      videoJobId: undefined,
      videoLocalPath: undefined,
      timelineClipId: undefined,
      error: undefined
    }
  } else if (stage === 'video') {
    pipeline.segments[idx] = {
      ...segment,
      status: 'image_done',
      videoJobId: undefined,
      videoLocalPath: undefined,
      timelineClipId: undefined,
      error: undefined
    }
  }

  pipeline.pipelineStatus = 'running'
  pipeline.activePhase = stage === 'video' ? 'videos' : 'images'
  if (stage === 'video') {
    videoBatchQuota.set(projectId, 1)
  } else {
    imageBatchQuota.set(projectId, 1)
  }
  await persistPipeline(loaded.project, pipeline)
  emit(projectId, pipeline)
  await pump(projectId)
  return pipeline
}

export async function markSegmentsTimelinePlaced(
  projectId: string,
  placements: Array<{ segmentId: string; clipId: string }>
): Promise<GenerationProject> {
  const loaded = await loadProjectPipeline(projectId)
  if (!loaded) throw new Error('Project not found.')

  const pipeline = {
    ...loaded.pipeline,
    segments: loaded.pipeline.segments.map((s) => {
      const placement = placements.find((p) => p.segmentId === s.id)
      if (!placement) return s
      return { ...s, status: 'timeline_placed' as const, timelineClipId: placement.clipId }
    }),
    pipelineStatus: 'complete' as const
  }

  const project = await persistPipeline(loaded.project, pipeline)
  emit(projectId, pipeline)
  return project
}

export async function handlePipelineJobUpdate(job: HiggsfieldGenerationJob): Promise<void> {
  const meta = jobMeta.get(job.id)
  if (!meta) return

  if (job.status !== 'completed' && job.status !== 'failed' && job.status !== 'cancelled') {
    pipelineDebugLog(meta.projectId, 'job', 'job', `Job ${job.status}`, {
      jobId: job.id,
      type: meta.type,
      segmentId: meta.segmentId,
      characterId: meta.characterId,
      progress: job.progressMessage
    })
    return
  }

  pipelineDebugLog(meta.projectId, 'job', 'job', `Job ${job.status}: ${meta.type}`, {
    jobId: job.id,
    type: meta.type,
    segmentId: meta.segmentId,
    characterId: meta.characterId,
    localPath: job.localPath,
    error: job.error
  })

  decRunning(meta.type)
  jobMeta.delete(job.id)

  const loaded = await loadProjectPipeline(meta.projectId)
  if (!loaded) return

  let { project, pipeline } = loaded
  pipeline = { ...pipeline, characters: [...pipeline.characters], segments: [...pipeline.segments] }

  if (job.status === 'completed' && job.localPath && (await verifyMediaFileAsync(job.localPath))) {
    let persistedPath = job.localPath
    try {
      persistedPath = await persistPipelineJobMedia(meta.projectId, job.localPath)
    } catch (err) {
      logError(
        'pipeline:media-import',
        err instanceof Error ? err.message : String(err),
        { jobId: job.id, localPath: job.localPath }
      )
    }

    if (meta.type === 'character_anchor' && meta.characterId) {
      const idx = pipeline.characters.findIndex((c) => c.id === meta.characterId)
      if (idx >= 0) {
        pipeline.characters[idx] = {
          ...pipeline.characters[idx],
          anchorImagePath: persistedPath,
          anchorStatus: 'done'
        }
      }
    } else if (meta.type === 'segment_image' && meta.segmentId) {
      const idx = pipeline.segments.findIndex((s) => s.id === meta.segmentId)
      if (idx >= 0) {
        pipeline.segments[idx] = {
          ...pipeline.segments[idx],
          imageLocalPath: persistedPath,
          status: 'image_done'
        }
      }
    } else if (meta.type === 'segment_video' && meta.segmentId) {
      const idx = pipeline.segments.findIndex((s) => s.id === meta.segmentId)
      if (idx >= 0) {
        pipeline.segments[idx] = {
          ...pipeline.segments[idx],
          videoLocalPath: persistedPath,
          status: 'video_done'
        }
      }
    }
    await appendPipelineLog(meta.projectId, 'Job completed', {
      jobId: job.id,
      type: meta.type,
      localPath: persistedPath
    })
  } else if (job.status === 'completed') {
    if (meta.type === 'character_anchor' && meta.characterId) {
      const idx = pipeline.characters.findIndex((c) => c.id === meta.characterId)
      if (idx >= 0) {
        pipeline.characters[idx] = { ...pipeline.characters[idx], anchorStatus: 'failed' }
      }
    } else if (meta.segmentId) {
      const idx = pipeline.segments.findIndex((s) => s.id === meta.segmentId)
      if (idx >= 0) {
        pipeline.segments[idx] = {
          ...pipeline.segments[idx],
          status: 'failed',
          error: job.localPath
            ? 'Generation completed but the file was not downloaded properly'
            : 'Generation completed without output file'
        }
      }
    }
    logError('pipeline:job-empty', 'completed without localPath', { jobId: job.id, type: meta.type })
  } else if (job.status === 'failed' || job.status === 'cancelled') {
    const error =
      job.status === 'cancelled'
        ? 'Generation was cancelled'
        : (job.error ?? 'Generation failed')
    if (meta.type === 'character_anchor' && meta.characterId) {
      const idx = pipeline.characters.findIndex((c) => c.id === meta.characterId)
      if (idx >= 0) {
        pipeline.characters[idx] = { ...pipeline.characters[idx], anchorStatus: 'failed' }
      }
    } else if (meta.segmentId) {
      const idx = pipeline.segments.findIndex((s) => s.id === meta.segmentId)
      if (idx >= 0) {
        const segment = pipeline.segments[idx]
        if (meta.type === 'segment_video' && segment.imageLocalPath) {
          pipeline.segments[idx] = {
            ...segment,
            status: 'image_done',
            videoJobId: undefined,
            error: undefined
          }
        } else if (meta.type === 'segment_image' && segment.imageLocalPath) {
          pipeline.segments[idx] = {
            ...segment,
            status: 'image_done',
            imageJobId: undefined,
            error: undefined
          }
        } else {
          pipeline.segments[idx] = {
            ...segment,
            status: 'failed',
            error
          }
        }
      }
    }
    logError(
      job.status === 'cancelled' ? 'pipeline:job-cancelled' : 'pipeline:job-failed',
      error,
      { jobId: job.id, type: meta.type }
    )
  }

  project = await persistPipeline(project, pipeline)
  emit(meta.projectId, pipeline)

  if (pipeline.pipelineStatus === 'running' && !pausedProjects.has(meta.projectId)) {
    const phase = pipeline.activePhase
    const imageQuota = imageBatchQuota.get(meta.projectId) ?? 0
    if (phase === 'images' && imageQuota > 0) {
      await pump(meta.projectId)
      return
    }
    const loadedAfter = await loadProjectPipeline(meta.projectId)
    if (!loadedAfter) return
    let finished = await finishManualBatchIfIdle(meta.projectId, loadedAfter.pipeline)
    if (finished.pipelineStatus !== loadedAfter.pipeline.pipelineStatus) {
      await persistPipeline(loadedAfter.project, finished)
      emit(meta.projectId, finished)
    }
  }
}

export async function getPipelineState(projectId: string): Promise<SegmentPipelineState | null> {
  const loaded = await loadProjectPipeline(projectId)
  if (!loaded) return null
  const reconciled = await reconcileStaleRunning(projectId, loaded.project, loaded.pipeline)
  return reconciled.pipeline
}
