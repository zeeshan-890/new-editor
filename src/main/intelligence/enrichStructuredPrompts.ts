import type {
  AnalyzeScriptInput,
  LlmAnalyzeResult,
  LlmAnalyzeSegmentInput
} from '../../shared/segmentPipeline'
import type { ParsedScene, ParsedSegmentBlock } from './parseStructuredScript'
import {
  classifySceneVisualMode,
  extractDiagramSubject,
  MEDICAL_DIAGRAM_PROMPT_PREFIX
} from '../../shared/pipelinePromptGuards'
import { enrichAnalysisWithCreative } from './enrichAnalysisWithCreative'
import { creativeStyleLockHint } from '../../shared/creativeInstructions'

/** Keep only reference ids that exist on the project brief. Prefer the model's choices. */
export function pickReferenceIdsForScene(
  _scene: ParsedScene | ParsedSegmentBlock,
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
  if (classifySceneVisualMode(clipText, scene.voText) === 'diagram') {
    const subject = extractDiagramSubject(clipText, scene.voText)
    return [
      MEDICAL_DIAGRAM_PROMPT_PREFIX,
      subject,
      'Isolated full-frame 3D medical render only — NOT a clinic photo, NOT on a monitor/TV/screen.',
      'Empty plain solid neutral background. No text, labels, people, rooms, or equipment.'
    ].join(' ')
  }
  return `${clipText}. Single unified cinematic frame suitable for image-to-video. Not a collage or multi-panel.`
}

/** Ensure diagram imagePrompts lead with 3D medical diagram + anatomy-only subject. */
function ensureMedicalDiagramPrompt(prompt: string, scriptText = ''): string {
  const subject = extractDiagramSubject(prompt, scriptText)
  const body = `Unlabeled full-frame 3D medical diagram of ${subject}. The anatomy IS the image — NOT a clinic photo, NOT on a monitor/TV/screen.`
  if (/^create\s+3d\s+medical\s+diagram/i.test(prompt.trim())) {
    return `${MEDICAL_DIAGRAM_PROMPT_PREFIX} ${subject}`
  }
  return `${MEDICAL_DIAGRAM_PROMPT_PREFIX} ${body}`
}

function clipFallbackMotion(scene: ParsedScene): string {
  const clipText =
    scene.clips.length > 0
      ? scene.clips.map((c) => c.description).join('. ')
      : scene.voText
  if (classifySceneVisualMode(clipText, scene.voText) === 'diagram') {
    return `Slow cinematic orbit and gentle push-in around the medical diagram (${clipText.slice(0, 160)}). Soft lighting drift; keep unlabeled on a plain background — no text appearing.`
  }
  if (scene.clips.length > 1) {
    return `Clear continuous motion through the shot: ${scene.clips.map((c) => c.description).join('; ')}. Slow cinematic push-in; subjects move naturally — not a still.`
  }
  if (scene.clips[0]) {
    return `Animate with visible action matching: ${scene.clips[0].description}. Camera slowly pushes in; natural body language and secondary motion (hands, fabric, face).`
  }
  return 'Visible subject motion and camera movement: natural body language, expressive face, secondary motion (hair, fabric, hands), and a slow cinematic push-in or orbit. Do not hold as a still frame.'
}

/**
 * Lock VO text, keep LLM-written prompts (sanitized), keep LLM reference assignments.
 * Then bake creative instructions so freeform-style briefs still land in prompts.
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
      let imagePrompt =
        sanitizeGeneratedPrompt(segment.imagePrompt) || clipFallbackPrompt(scene)
      if (classifySceneVisualMode(imagePrompt, scene.voText) === 'diagram') {
        imagePrompt = ensureMedicalDiagramPrompt(imagePrompt, scene.voText)
      }
      let videoMotionPrompt = sanitizeGeneratedPrompt(segment.videoMotionPrompt ?? '')
      if (!videoMotionPrompt) videoMotionPrompt = clipFallbackMotion(scene)
      if (videoMotionPrompt.length > 360) {
        videoMotionPrompt = videoMotionPrompt.slice(0, 360).replace(/\s+\S*$/, '')
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

  return enrichAnalysisWithCreative({ ...result, segments }, input.creativeInstructions)
}
export function buildDeterministicStructuredResult(
  scenes: ParsedScene[],
  input: AnalyzeScriptInput
): LlmAnalyzeResult {
  const styleHint = creativeStyleLockHint(input.creativeInstructions)
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
      visualStyle: styleHint || 'cinematic realism, natural soft lighting',
      setting: 'domestic bathroom and lifestyle interiors'
    }
  }

  return finalizeStructuredSegments(draft, scenes, input)
}

function segmentFallbackMotion(block: ParsedSegmentBlock): string {
  const prompt = block.imagePrompt.trim()
  if (classifySceneVisualMode(prompt, block.scriptText) === 'diagram') {
    return prompt
      ? `Slow cinematic orbit and gentle push-in around the medical diagram (${prompt.slice(0, 160)}). Soft lighting drift; keep unlabeled on a plain background — no text appearing.`
      : 'Slow cinematic orbit and gentle push-in around the medical diagram on a plain background. Soft lighting drift; keep it unlabeled — no text appearing.'
  }
  if (prompt) {
    return `Animate with visible action matching: ${prompt.slice(0, 220)}. Camera slowly pushes in; natural body language and secondary motion (hands, fabric, face).`
  }
  return 'Visible subject motion and camera movement: natural body language, expressive face, secondary motion (hair, fabric, hands), and a slow cinematic push-in or orbit. Do not hold as a still frame.'
}

/**
 * Lock Script + V0 Prompt from the deterministic parse.
 * LLM may supply motion / characters / refs / style — never rewrites scriptText or imagePrompt.
 */
export function finalizeStructuredSegmentBlocks(
  result: LlmAnalyzeResult,
  blocks: ParsedSegmentBlock[],
  input: AnalyzeScriptInput
): LlmAnalyzeResult {
  if (result.segments.length !== blocks.length) {
    throw new Error(
      `Structured analysis must return ${blocks.length} segments (one per Segment block), got ${result.segments.length}.`
    )
  }

  const segments: LlmAnalyzeSegmentInput[] = result.segments
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((segment, index) => {
      const block = blocks[index]
      const referenceIds = pickReferenceIdsForScene(block, input.references, segment.referenceIds)
      let imagePrompt =
        sanitizeGeneratedPrompt(block.imagePrompt) || block.imagePrompt
      if (classifySceneVisualMode(imagePrompt, block.scriptText) === 'diagram') {
        imagePrompt = ensureMedicalDiagramPrompt(imagePrompt, block.scriptText)
      }
      let videoMotionPrompt = sanitizeGeneratedPrompt(segment.videoMotionPrompt ?? '')
      if (!videoMotionPrompt) videoMotionPrompt = segmentFallbackMotion(block)
      if (videoMotionPrompt.length > 360) {
        videoMotionPrompt = videoMotionPrompt.slice(0, 360).replace(/\s+\S*$/, '')
      }

      return {
        ...segment,
        index,
        scriptText: block.scriptText,
        referenceIds: referenceIds.length ? referenceIds : undefined,
        imagePrompt,
        videoMotionPrompt
      }
    })

  return enrichAnalysisWithCreative({ ...result, segments }, input.creativeInstructions)
}

/** Last-resort segments from Segment/Script/V0 Prompt only. */
export function buildDeterministicSegmentBlockResult(
  blocks: ParsedSegmentBlock[],
  input: AnalyzeScriptInput
): LlmAnalyzeResult {
  const styleHint = creativeStyleLockHint(input.creativeInstructions)
  const draft: LlmAnalyzeResult = {
    segments: blocks.map((block, index) => ({
      index,
      scriptText: block.scriptText,
      imagePrompt: block.imagePrompt,
      videoMotionPrompt: segmentFallbackMotion(block),
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
      visualStyle: styleHint || 'cinematic realism, natural soft lighting',
      setting: 'inferred from segment prompts'
    }
  }

  return finalizeStructuredSegmentBlocks(draft, blocks, input)
}
