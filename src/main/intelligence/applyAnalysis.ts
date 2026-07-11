import type {
  LlmAnalyzeResult,
  SegmentPipelineState
} from '../../shared/segmentPipeline'
import { createSegmentFromAnalysis } from '../../shared/segmentPipeline'

export function applyAnalysisToPipeline(
  pipeline: SegmentPipelineState,
  analysis: LlmAnalyzeResult
): SegmentPipelineState {
  const characterIds = new Set(analysis.characters.map((c) => c.id))
  const scriptReferenceIds = new Set((pipeline.scriptReferences ?? []).map((ref) => ref.id))

  return {
    ...pipeline,
    fullScript: pipeline.fullScript.trim(),
    segments: analysis.segments
      .sort((a, b) => a.index - b.index)
      .map((seg) => createSegmentFromAnalysis(seg, characterIds, scriptReferenceIds)),
    characters: analysis.characters.map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role?.trim() || undefined,
      description: c.description,
      anchorStatus: 'pending' as const
    })),
    styleLock: analysis.styleLock,
    pipelineStatus: 'idle',
    analyzedAt: Date.now()
  }
}
