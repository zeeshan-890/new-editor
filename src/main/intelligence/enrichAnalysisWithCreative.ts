import type { LlmAnalyzeResult } from '../../shared/segmentPipeline'
import {
  appendCreativeGuidance,
  creativeStyleLockHint,
  condenseCreativeInstructions
} from '../../shared/creativeInstructions'
import { classifySceneVisualMode } from '../../shared/pipelinePromptGuards'

/**
 * After freeform (or any) LLM analysis: ensure creative instructions land in
 * every segment prompt + styleLock. The model often under-applies the rulebook.
 */
export function enrichAnalysisWithCreative(
  result: LlmAnalyzeResult,
  creative: string | undefined | null
): LlmAnalyzeResult {
  const condensed = condenseCreativeInstructions(creative)
  if (!condensed) return result

  const styleHint = creativeStyleLockHint(creative)
  const visualStyle = result.styleLock.visualStyle?.trim() || ''
  const nextVisualStyle =
    styleHint && !visualStyle.toLowerCase().includes(styleHint.slice(0, 40).toLowerCase())
      ? visualStyle
        ? `${visualStyle}. ${styleHint}`
        : styleHint
      : visualStyle || styleHint

  return {
    ...result,
    styleLock: {
      ...result.styleLock,
      visualStyle: nextVisualStyle || result.styleLock.visualStyle
    },
    segments: result.segments.map((segment) => {
      const isDiagram = classifySceneVisualMode(segment.imagePrompt, segment.scriptText) === 'diagram'
      return {
        ...segment,
        imagePrompt: appendCreativeGuidance(segment.imagePrompt, condensed, {
          forDiagram: isDiagram
        }),
        videoMotionPrompt: appendCreativeGuidance(
          segment.videoMotionPrompt ?? '',
          condensed,
          { forVideo: true, forDiagram: isDiagram }
        )
      }
    })
  }
}
