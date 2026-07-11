import type {
  AnalyzeScriptInput,
  LlmAnalyzeResult,
  LlmAnalyzeSegmentInput
} from '../../shared/segmentPipeline'
import type { ParsedScene } from './parseStructuredScript'

/** Keep only reference ids that exist on the project brief. Prefer the model's choices. */
export function pickReferenceIdsForScene(
  _scene: ParsedScene,
  references: AnalyzeScriptInput['references'] | undefined,
  existing?: string[]
): string[] {
  const known = new Set((references ?? []).map((r) => r.id).filter(Boolean))
  if (known.size === 0) return []
  return [...new Set((existing ?? []).filter((id) => known.has(id)))]
}

/**
 * Strip accidental verbatim dumps (filenames, "Creative direction:" blocks).
 * Does not invent style rules — those come from the LLM at analyze time.
 */
export function sanitizeGeneratedPrompt(text: string): string {
  let cleaned = text.trim()
  cleaned = cleaned.replace(/\bKeep creative direction:\s*/gi, '')
  cleaned = cleaned.replace(/\bCreative direction:\s*/gi, '')
  cleaned = cleaned.replace(/\bStay consistent with references:\s*/gi, '')
  cleaned = cleaned.replace(/\bFollow attached reference images[^\n]*/gi, '')
  cleaned = cleaned.replace(/\bReference images for this shot:\s*/gi, '')
  cleaned = cleaned.replace(
    /[A-Za-z0-9_\- ]+\.(?:png|jpe?g|webp|gif)\s*:\s*[^\n.]*(?:\.|$)/gi,
    ''
  )
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n')
  return cleaned.replace(/[ \t]{2,}/g, ' ').trim()
}

function clipFallbackPrompt(scene: ParsedScene): string {
  const clipText =
    scene.clips.length > 0
      ? scene.clips.map((c) => c.description).join('. ')
      : scene.voText
  return `${clipText}. Single unified cinematic frame suitable for image-to-video. Not a collage or multi-panel.`
}

function clipFallbackMotion(scene: ParsedScene): string {
  if (scene.clips.length > 1) {
    return `Subtle cinematic motion: ${scene.clips.map((c) => c.description).join('; ')}`
  }
  if (scene.clips[0]) {
    return `Gentle camera motion on: ${scene.clips[0].description}`
  }
  return 'Subtle natural motion, gentle camera movement, cinematic pacing.'
}

/**
 * Lock VO text, keep LLM-written prompts (sanitized), keep LLM reference assignments.
 * Creative instructions are NOT re-appended here — the model already wove them in.
 */
export function finalizeStructuredSegments(
  result: LlmAnalyzeResult,
  scenes: ParsedScene[],
  input: AnalyzeScriptInput
): LlmAnalyzeResult {
  if (result.segments.length !== scenes.length) {
    throw new Error(
      `Structured analysis must return ${scenes.length} segments (one per Scene), got ${result.segments.length}.`
    )
  }

  const segments: LlmAnalyzeSegmentInput[] = result.segments
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((segment, index) => {
      const scene = scenes[index]
      const referenceIds = pickReferenceIdsForScene(scene, input.references, segment.referenceIds)
      const imagePrompt =
        sanitizeGeneratedPrompt(segment.imagePrompt) || clipFallbackPrompt(scene)
      let videoMotionPrompt = sanitizeGeneratedPrompt(segment.videoMotionPrompt ?? '')
      if (!videoMotionPrompt) videoMotionPrompt = clipFallbackMotion(scene)
      if (videoMotionPrompt.length > 280) {
        videoMotionPrompt = videoMotionPrompt.slice(0, 280).replace(/\s+\S*$/, '')
      }

      return {
        ...segment,
        index,
        scriptText: scene.voText,
        referenceIds: referenceIds.length ? referenceIds : undefined,
        imagePrompt,
        videoMotionPrompt
      }
    })

  return { ...result, segments }
}

/** Last-resort segments from Scene/VO/Clip only (no hardcoded creative-rule engine). */
export function buildDeterministicStructuredResult(
  scenes: ParsedScene[],
  input: AnalyzeScriptInput
): LlmAnalyzeResult {
  const draft: LlmAnalyzeResult = {
    segments: scenes.map((scene, index) => ({
      index,
      scriptText: scene.voText,
      imagePrompt: clipFallbackPrompt(scene),
      videoMotionPrompt: clipFallbackMotion(scene),
      characters: ['woman'],
      referenceIds: undefined,
      continuityFromPrevious: index > 0
    })),
    characters: [
      {
        id: 'woman',
        name: 'Woman',
        role: 'protagonist',
        description:
          'Woman aged 50-60, natural features, everyday clothing, emotionally expressive face'
      }
    ],
    styleLock: {
      aspectRatio: '9:16',
      visualStyle: 'cinematic realism, natural soft lighting',
      setting: 'domestic bathroom and lifestyle interiors'
    }
  }

  return finalizeStructuredSegments(draft, scenes, input)
}
