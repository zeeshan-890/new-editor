import { join } from 'path'
import type { GenerationProject, VideoEditorProject } from '../../shared/types'
import { normalizeGenerationProject, normalizeVideoEditorProject } from '../../shared/types'
import { normalizePipelineState, createEmptyPipelineState } from '../../shared/segmentPipeline'
import type { SegmentPipelineState } from '../../shared/segmentPipeline'
import { loadProject, saveProject, mediaDir } from '../projects/store'
import { exportTimelineAudioMix } from '../video/export'

const TIMELINE_MASTER_FILENAME = 'timeline-master.mp3'

function resolveVideoEditor(
  project: GenerationProject,
  editorOverride?: VideoEditorProject
): VideoEditorProject {
  if (editorOverride) {
    return normalizeVideoEditorProject(editorOverride, project.name)
  }
  return normalizeVideoEditorProject(project.videoEditor, project.name)
}

export async function syncPipelineMasterAudioFromTimeline(
  projectId: string,
  editorOverride?: VideoEditorProject,
  pipelineOverride?: SegmentPipelineState
): Promise<GenerationProject> {
  const loaded = await loadProject(projectId)
  if (!loaded) {
    throw new Error('Project not found.')
  }

  const project = normalizeGenerationProject(loaded)
  const videoEditor = resolveVideoEditor(project, editorOverride)
  const outputPath = join(mediaDir(projectId), TIMELINE_MASTER_FILENAME)

  const { outputPath: exportedPath, durationMs } = await exportTimelineAudioMix(
    videoEditor.assets,
    videoEditor.layers,
    outputPath
  )

  const basePipeline = normalizePipelineState(
    pipelineOverride ?? project.pipeline ?? createEmptyPipelineState()
  )

  const pipeline = normalizePipelineState({
    ...basePipeline,
    masterAudioPath: exportedPath,
    masterAudioSource: 'timeline',
    masterAudioSyncedAt: Date.now(),
    masterAudioDurationMs: durationMs
  })

  return saveProject({
    ...project,
    videoEditor: editorOverride ? videoEditor : project.videoEditor,
    pipeline,
    updatedAt: Date.now()
  })
}

export async function ensurePipelineMasterAudioFromTimeline(
  projectId: string
): Promise<string> {
  const project = await syncPipelineMasterAudioFromTimeline(projectId)
  const path = project.pipeline?.masterAudioPath
  if (!path) {
    throw new Error('Failed to export timeline audio for the pipeline.')
  }
  return path
}
