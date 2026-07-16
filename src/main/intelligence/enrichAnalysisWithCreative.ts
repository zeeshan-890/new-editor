import type { LlmAnalyzeResult } from '../../shared/segmentPipeline'
import {
  appendCreativeGuidance,
  creativeStyleLockHint,
  condenseCreativeInstructions
} from '../../shared/creativeInstructions'
import {
  classifySceneVisualMode,
  extractDiagramSubject,
  MEDICAL_DIAGRAM_PROMPT_PREFIX
} from '../../shared/pipelinePromptGuards'

/**
 * After freeform (or any) LLM analysis: ensure creative instructions land in
 * every segment prompt + styleLock. The model often under-applies the rulebook.
 * Diagram segments get a clean anatomy-only rewrite — never clinic/creative dumps.
 */
export function enrichAnalysisWithCreative(
  result: LlmAnalyzeResult,
  creative: string | undefined | null
): LlmAnalyzeResult {
  const condensed = condenseCreativeInstructions(creative)
  const styleHint = creativeStyleLockHint(creative)
  const visualStyle = result.styleLock.visualStyle?.trim() || ''
  const nextVisualStyle =
    condensed &&
    styleHint &&
    !visualStyle.toLowerCase().includes(styleHint.slice(0, 40).toLowerCase())
      ? visualStyle
        ? `${visualStyle}. ${styleHint}`
        : styleHint
      : visualStyle || styleHint || result.styleLock.visualStyle

  return {
    ...result,
    styleLock: {
      ...result.styleLock,
      visualStyle: nextVisualStyle || result.styleLock.visualStyle
    },
    segments: result.segments.map((segment) => {
      const isDiagram =
        classifySceneVisualMode(segment.imagePrompt, segment.scriptText) === 'diagram'

      if (isDiagram) {
        const subject = extractDiagramSubject(segment.imagePrompt, segment.scriptText)
        return {
          ...segment,
          imagePrompt: `${MEDICAL_DIAGRAM_PROMPT_PREFIX} ${subject}`,
          videoMotionPrompt: `${MEDICAL_DIAGRAM_PROMPT_PREFIX} Slow orbit around ${subject}; plain background; no text, clinic, or screen.`
        }
      }

      if (!condensed) return segment

      return {
        ...segment,
        imagePrompt: appendCreativeGuidance(segment.imagePrompt, condensed),
        videoMotionPrompt: appendCreativeGuidance(segment.videoMotionPrompt ?? '', condensed, {
          forVideo: true
        })
      }
    })
  }
}
