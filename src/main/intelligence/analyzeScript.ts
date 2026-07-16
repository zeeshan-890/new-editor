import { loadLlmSettings } from '../llm/settings'
import { createOpenAiCompatibleProvider } from '../llm/openaiCompatible'
import type { AnalyzeScriptInput, LlmAnalyzeResult } from '../../shared/segmentPipeline'
import {
  formatValidationError,
  parseLlmJsonResponse,
  validateAnalysisResult
} from './validateAnalysis'
import {
  formatScenesForLlm,
  formatSegmentBlocksForLlm,
  isStructuredSceneScript,
  isStructuredSegmentScript,
  narrationScriptFromScenes,
  narrationScriptFromSegmentBlocks,
  parseStructuredSceneScript,
  parseStructuredSegmentScript,
  type ParsedScene,
  type ParsedSegmentBlock
} from './parseStructuredScript'
import {
  buildDeterministicSegmentBlockResult,
  buildDeterministicStructuredResult,
  finalizeStructuredSegmentBlocks,
  finalizeStructuredSegments
} from './enrichStructuredPrompts'
import { enrichAnalysisWithCreative } from './enrichAnalysisWithCreative'

const FREEFORM_SYSTEM_PROMPT = `You are a professional script-to-storyboard analyst for video production.

Your task: analyze a narration script and split it into the MAXIMUM number of short visual segments. Prefer MORE segments over fewer. Each segment must be the smallest useful narration beat that can be shown as ONE animatable scene frame (one unified photograph — never a character sheet, reference board, or multi-panel collage).

The user may also provide creative instructions (separate from the script) and reference images with per-image usage notes.

CREATIVE INSTRUCTIONS (critical for freeform scripts):
- Treat them as a free-form runtime rulebook that MUST shape the visuals
- For EVERY segment, weave the relevant creative rules into imagePrompt as natural visual language (look, lighting, wardrobe, props, color, camera, brand tone, diagram style, forbidden elements)
- Apply only the parts that fit that segment's beat — but do not skip the brief entirely; most segments should clearly reflect the creative look
- Never paste the full creative-instructions block verbatim and never write labels like "Creative direction:" or "Keep creative direction:"
- Process/pipeline notes (e.g. "first generate images then videos") are NOT visual content — ignore those when writing prompts
- Assign reference ids only to segments where that image should guide generation

Segmentation rules (fine-grain — critical):
- Default to the SHORTEST possible segment: ideally one clause, one subject, or one concrete visual beat (~3–18 words of scriptText)
- Split whenever the camera could cut: action change, location change, time change, emotion shift, subject change, product feature, or new example
- Split lists and enumerations into SEPARATE segments (e.g. "toddlers…, teenagers…, and grown men…" → 3 segments)
- Split compound sentences on commas, em dashes (—), semicolons, colons, and "and/or/but/while/when" when each side has its own visual
- A single sentence SHOULD become multiple segments whenever it mentions multiple people, places, products, problems, or payoffs
- Do NOT keep a long story beat in one segment just because it is one grammatical sentence
- Do NOT merge adjacent short beats; never combine unrelated examples into one segment
- Prefer over-splitting: if unsure whether to split, SPLIT
- Keep segment scriptText as the EXACT verbatim narration words only (never include labels like Scene, VO, Clip, or stage directions)
- Concatenating all scriptText values in order must reconstruct the full narration with original wording
- Order segments in narration order with index starting at 0

Character rules:
- Extract every recurring character with a stable id (snake_case, e.g. "doctor_chen", "patient_maria")
- Each character MUST have a "role" — their function in the story (e.g. "attending physician", "patient", "clinic receptionist")
- "description" = physical traits PLUS role-appropriate wardrobe, props, and demeanor
- Doctor → white coat or scrubs, stethoscope. Patient → everyday or hospital-appropriate clothing, never a medical uniform.
- List character ids in each segment's characters array; order by visual prominence (most important on screen first)

Setting rules:
- Infer the primary story setting from the script and put it in styleLock.setting
- Examples: "modern primary care clinic with exam rooms", "night-time emergency room", "suburban home kitchen"
- Every segment imagePrompt must place characters in a location that fits styleLock.setting unless the script clearly moves elsewhere

Image prompt rules:
- Format: [Subject(s) with roles] in [Location matching setting], [Action], [Lighting/Time], [Mood/Emotion], [Camera/Composition], [Style]
- When multiple characters appear, show them interacting naturally in context (e.g. doctor speaking with patient in exam room)
- Be specific and visual — describe what the camera sees, not abstract concepts
- Each imagePrompt must describe ONE full scene frame suitable for image-to-video animation
- Focus the frame on ONLY this segment's beat (do not cram the whole sentence's other beats into the same image)
- Never ask for character sheets, reference boards, turnaround views, contact sheets, split panels, or collages
- Live-action/lifestyle scenes: never add floating medical diagrams, holographic anatomy, HUD panels, X-ray overlays, or educational infographic layers unless the beat is explicitly a diagram
- MEDICAL / DIAGRAM scenes (when the beat is an anatomy diagram, organ, cross-section, medical illustration, scan, or scientific visualization):
  - imagePrompt must describe ONLY the diagram subject (e.g. "unlabeled 3D anatomical diagram of a human kidney, accurate medical illustration")
  - Empty plain solid neutral background — the diagram is the ONLY visual in the entire frame
  - No other visuals of any kind: no props, icons, insets, charts, secondary objects, rooms, furniture, people, hands, packaging
  - Explicitly forbid text: no labels, captions, titles, arrows with words, callouts, watermarks, or UI
  - Single isolated diagram, textbook-quality, centered — nothing else in frame
- Prefer medium or wide shots with environmental context for live scenes; for diagrams prefer centered isolated subject
- 40-120 words per imagePrompt

Reference image rules:
- When reference images are provided, read each id and its free-form usage note
- Decide per segment whether that reference applies; put ids in segment.referenceIds only then
- Synthesize matching guidance into imagePrompt prose — never paste filenames or raw usage notes
- Creative instructions are free-form: interpret and apply only where relevant; never paste them verbatim

Video motion (required per segment):
- 1–2 sentences of CONCRETE motion for image-to-video (who moves, how hands/face change, camera push-in/orbit/pan)
- NEVER write only "subtle", "gentle", or "minimal motion" — models treat that as nearly static
- Medical/diagram segments: slow orbit or push-in around the diagram; soft lighting drift; never invent people or on-screen text/labels appearing
- No creative-instruction dumps

continuityFromPrevious: true only when the scene is a direct visual continuation of the previous segment (same location, continuous action).

Respond with ONLY valid JSON matching this schema:
{
  "segments": [
    {
      "index": 0,
      "scriptText": "exact narration words only",
      "imagePrompt": "detailed scene prompt with roles and setting",
      "videoMotionPrompt": "concrete subject + camera motion",
      "characters": ["doctor_chen"],
      "referenceIds": ["optional_reference_id"],
      "continuityFromPrevious": false
    }
  ],
  "characters": [
    {
      "id": "doctor_chen",
      "name": "Dr. Chen",
      "role": "attending physician",
      "description": "50-year-old woman, short grey hair, glasses, white lab coat, stethoscope, calm professional demeanor"
    }
  ],
  "styleLock": {
    "aspectRatio": "9:16",
    "visualStyle": "cinematic realism, natural soft lighting",
    "setting": "modern medical clinic examination room with neutral walls and soft daylight"
  }
}`

const STRUCTURED_SYSTEM_PROMPT = `You are a professional script-to-storyboard analyst for video production.

The input is ALREADY segmented into Scene blocks. Your job is NOT to re-split the script.

Structure meaning (fixed):
- Scene N = ONE output segment (index = scene order starting at 0)
- VO = spoken narration → scriptText (copy EXACTLY; never add Scene/VO/Clip labels)
- Clip descriptions = what is on screen → primary visual content for imagePrompt / videoMotionPrompt
- Creative instructions = a free-form RULEBOOK written by the user at runtime (content can be ANYTHING)
- Attached reference images = optional assets with free-form usage notes (also anything)

Your job for creative instructions + references (critical — do this with reasoning, not fixed templates):
1. Read the entire creative-instructions block and understand what each part means in context
   (camera look, diagram style, product rules, brand tone, forbidden elements, process notes, etc.).
2. Process notes about pipeline order (e.g. "first generate images then videos") are NOT visual prompt content — ignore them when writing prompts.
3. For EACH scene, decide which instruction parts are RELEVANT to that scene's clips/VO.
   - Only apply a rule if it fits this scene's visual context.
   - Do not apply every rule to every scene.
4. SYNTHESIZE relevant rules into natural prompt language for that scene.
5. NEVER paste creative instructions verbatim. NEVER write "Creative direction:" or "Keep creative direction:".
6. NEVER paste reference filenames or raw usage notes into prompts.

Reference images:
1. Read each usage note and decide which scenes need that image.
2. Put the reference id in segment.referenceIds ONLY for scenes where it should guide generation.
3. In imagePrompt, describe matching behavior in prose when a ref applies
   (e.g. match packaging / likeness / style of the attached reference) — do not dump "filename: note".
4. If a reference is irrelevant to a scene, leave it out of that segment's referenceIds.

Hard rules:
1. Return EXACTLY one segment per Scene, same count and order.
2. scriptText MUST equal the provided VO text.
3. Never create one segment per Clip.
4. imagePrompt: one unified still (40-140 words) from clips + only applicable synthesized guidance.
   - Live scenes: cinematic frame; must not invent floating medical/HUD overlays.
   - MEDICAL / DIAGRAM scenes (anatomy, organ, cross-section, medical illustration, scan, scientific viz): describe ONLY the unlabeled diagram subject on an empty plain solid neutral background. The diagram is the ONLY visual in frame — NO other visuals, text, labels, captions, people, hands, rooms, props, icons, insets, packaging, or extra diagrams. Textbook-quality isolated medical diagram.
5. videoMotionPrompt: REQUIRED concrete motion from clips (1-2 sentences): specific subject actions + camera move. Never "subtle/gentle only". No instruction dumps. No filenames. For diagram scenes: slow orbit/push-in around the diagram — never invent people or on-screen text.
6. Extract characters with snake_case ids, role, description.
7. continuityFromPrevious: true only for direct visual continuations.
8. styleLock.visualStyle / setting should reflect overall look inferred from the brief + script (synthesized, not pasted).

Respond with ONLY valid JSON matching this schema:
{
  "segments": [
    {
      "index": 0,
      "scriptText": "exact VO narration only",
      "imagePrompt": "synthesized scene prompt — no raw instruction paste",
      "videoMotionPrompt": "concrete subject + camera motion",
      "characters": ["woman"],
      "referenceIds": ["only_if_this_scene_needs_that_image"],
      "continuityFromPrevious": false
    }
  ],
  "characters": [
    {
      "id": "woman",
      "name": "Woman",
      "role": "protagonist",
      "description": "50-60 year old woman, natural features, everyday wardrobe"
    }
  ],
  "styleLock": {
    "aspectRatio": "9:16",
    "visualStyle": "overall look synthesized from brief + script",
    "setting": "primary story setting"
  }
}`

const SEGMENT_BLOCK_SYSTEM_PROMPT = `You are a professional script-to-storyboard analyst for video production.

The input is ALREADY segmented into Segment / Script / V0 Prompt blocks. Your job is NOT to re-split the script.

Structure meaning (fixed):
- Segment N = ONE output segment (index = segment order starting at 0)
- Script = spoken narration → scriptText (copy EXACTLY; never add Segment/Script/V0 Prompt labels)
- V0 Prompt (aka VO Prompt) = the image prompt → imagePrompt (copy EXACTLY; do not rewrite or shorten)
- Creative instructions = a free-form RULEBOOK written by the user at runtime (content can be ANYTHING)
- Attached reference images = optional assets with free-form usage notes (also anything)

Your job (critical):
1. Return EXACTLY one segment per Segment block, same count and order.
2. scriptText MUST equal the provided Script text exactly.
3. imagePrompt MUST equal the provided V0 Prompt text exactly.
4. Write videoMotionPrompt from the V0 Prompt: concrete subject + camera motion (1-2 sentences). Never "subtle/gentle only". If the V0 Prompt is a medical/scientific diagram, use slow orbit/push-in around the diagram and never invent people or on-screen text.
5. Extract characters with snake_case ids, role, description from Script + V0 Prompt.
6. Apply creative instructions / references via reasoning: synthesize into videoMotionPrompt / character descriptions / styleLock only — NEVER paste verbatim, NEVER rewrite scriptText or imagePrompt.
7. Put reference ids in segment.referenceIds only when that image should guide generation.
8. continuityFromPrevious: true only for direct visual continuations.
9. styleLock.visualStyle / setting should reflect overall look inferred from the brief + prompts (synthesized, not pasted).

Respond with ONLY valid JSON matching this schema:
{
  "segments": [
    {
      "index": 0,
      "scriptText": "exact Script narration only",
      "imagePrompt": "exact V0 Prompt text only",
      "videoMotionPrompt": "concrete subject + camera motion",
      "characters": ["woman"],
      "referenceIds": ["only_if_this_segment_needs_that_image"],
      "continuityFromPrevious": false
    }
  ],
  "characters": [
    {
      "id": "woman",
      "name": "Woman",
      "role": "protagonist",
      "description": "50-60 year old woman, natural features, everyday wardrobe"
    }
  ],
  "styleLock": {
    "aspectRatio": "9:16",
    "visualStyle": "overall look synthesized from brief + script",
    "setting": "primary story setting"
  }
}`

function appendBriefSections(parts: string[], input: AnalyzeScriptInput): void {
  const creative = input.creativeInstructions?.trim()
  if (creative) {
    parts.push(
      '---',
      'CREATIVE INSTRUCTIONS (free-form runtime rulebook — interpret yourself; apply only where each scene needs it; NEVER paste verbatim):',
      creative
    )
  }

  const references = input.references?.filter((ref) => ref.id && ref.name) ?? []
  if (references.length > 0) {
    parts.push(
      '---',
      'ATTACHED REFERENCE IMAGES (free-form usage notes — decide per scene; assign via referenceIds; do NOT paste filename/notes into prompts):'
    )
    for (const ref of references) {
      const instruction = ref.instruction.trim() || 'visual reference'
      parts.push(`- id: ${ref.id} | file: ${ref.name} | usage note: ${instruction}`)
    }
  }
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/** True when freeform analysis still produced overly long narration beats. */
function isCoarseSegmentation(result: LlmAnalyzeResult, fullScript: string): boolean {
  const segments = result.segments
  if (segments.length === 0) return true

  const counts = segments.map((segment) => wordCount(segment.scriptText))
  const avg = counts.reduce((sum, n) => sum + n, 0) / counts.length
  const hasLong = counts.some((n) => n > 20)
  const scriptWords = wordCount(fullScript)
  const expectedMin = Math.max(4, Math.ceil(scriptWords / 12))

  return hasLong || avg > 14 || segments.length < expectedMin
}

function buildFineSplitRetryNote(result: LlmAnalyzeResult): string {
  const longOnes = result.segments
    .filter((segment) => wordCount(segment.scriptText) > 14)
    .slice(0, 6)
    .map(
      (segment) =>
        `- segment ${segment.index + 1} (${wordCount(segment.scriptText)} words): "${segment.scriptText.slice(0, 120)}"`
    )

  return [
    `Previous response was too coarse (${result.segments.length} segments).`,
    'Re-split into MANY more short segments. Prefer over-splitting.',
    'Break lists/examples and compound sentences into separate segments.',
    'Target roughly 3–18 words of scriptText per segment when possible.',
    longOnes.length > 0 ? 'Especially split these long beats:' : '',
    ...longOnes
  ]
    .filter(Boolean)
    .join('\n')
}

function buildUserMessage(input: AnalyzeScriptInput): string {
  const script = input.script.trim()
  const hasCreative = Boolean(input.creativeInstructions?.trim())
  const parts: string[] = [
    'Split this narration into the MAXIMUM number of short visual segments (prefer over-splitting).',
    'Lists, examples, and compound sentences must become separate segments.'
  ]
  if (hasCreative) {
    parts.push(
      'CREATIVE INSTRUCTIONS are provided below — you MUST synthesize relevant rules into EVERY segment imagePrompt (and styleLock.visualStyle). Do not ignore the brief.'
    )
  }
  parts.push('', script)
  appendBriefSections(parts, input)
  return parts.join('\n\n')
}

function buildStructuredUserMessage(input: AnalyzeScriptInput, scenes: ParsedScene[]): string {
  const parts: string[] = [
    `Return exactly ${scenes.length} segments (one per Scene below).`,
    'Do not re-split. scriptText must match each VO exactly.',
    'For each scene: start from its clips, then reason about which creative-instruction parts and which reference images apply to THAT scene only. Synthesize into prompts — never copy the rulebook or filenames into the prompt fields.'
  ]

  appendBriefSections(parts, input)

  parts.push('---', 'SCENES:', formatScenesForLlm(scenes))
  return parts.join('\n\n')
}

function buildSegmentBlockUserMessage(
  input: AnalyzeScriptInput,
  blocks: ParsedSegmentBlock[]
): string {
  const parts: string[] = [
    `Return exactly ${blocks.length} segments (one per Segment below).`,
    'Do not re-split. scriptText must match each Script exactly. imagePrompt must match each V0 Prompt exactly.',
    'Enrich characters, styleLock, referenceIds, and videoMotionPrompt only — never rewrite Script or V0 Prompt text.'
  ]

  appendBriefSections(parts, input)

  parts.push('---', 'SEGMENTS:', formatSegmentBlocksForLlm(blocks))
  return parts.join('\n\n')
}

export async function analyzeScript(
  input: AnalyzeScriptInput | string
): Promise<LlmAnalyzeResult> {
  const normalized: AnalyzeScriptInput =
    typeof input === 'string' ? { script: input } : input
  const trimmed = normalized.script.trim()
  if (!trimmed) {
    throw new Error('Script is empty. Enter your full script before analyzing.')
  }

  const referenceIds = new Set((normalized.references ?? []).map((ref) => ref.id))
  const structuredBlocks = parseStructuredSegmentScript(trimmed)
  const useSegmentBlocks = Boolean(structuredBlocks && isStructuredSegmentScript(trimmed))
  const structuredScenes = parseStructuredSceneScript(trimmed)
  const useStructuredScenes = Boolean(structuredScenes && isStructuredSceneScript(trimmed))

  const settings = await loadLlmSettings()
  const provider = createOpenAiCompatibleProvider(settings)

  if (useSegmentBlocks && structuredBlocks) {
    console.log('[Pipeline · analyze] Detected Segment/Script/V0 Prompt structure', {
      segments: structuredBlocks.length,
      creativeInstructions: Boolean(normalized.creativeInstructions?.trim()),
      references: normalized.references?.length ?? 0,
      vos: structuredBlocks.map((b) => ({
        segment: b.segmentNumber,
        script: b.scriptText.slice(0, 80),
        prompt: b.imagePrompt.slice(0, 60)
      }))
    })
    const userMessage = buildSegmentBlockUserMessage(normalized, structuredBlocks)
    const narrationOnly = narrationScriptFromSegmentBlocks(structuredBlocks)

    const attempt = async (extraUserNote?: string): Promise<LlmAnalyzeResult> => {
      const userContent = extraUserNote
        ? `${userMessage}\n\n---\nFix the previous response. Error: ${extraUserNote}`
        : userMessage

      const raw = await provider.complete(
        [
          { role: 'system', content: SEGMENT_BLOCK_SYSTEM_PROMPT },
          { role: 'user', content: userContent }
        ],
        { jsonMode: true, temperature: 0.2 }
      )

      const parsed = parseLlmJsonResponse(raw)
      const validated = validateAnalysisResult(parsed, referenceIds, {
        fullScript: narrationOnly,
        enforceExactScript: false,
        expectedSegmentCount: structuredBlocks.length
      })
      return finalizeStructuredSegmentBlocks(validated, structuredBlocks, normalized)
    }

    try {
      return await attempt()
    } catch (firstErr) {
      try {
        return await attempt(formatValidationError(firstErr))
      } catch {
        return enrichAnalysisWithCreative(
          buildDeterministicSegmentBlockResult(structuredBlocks, normalized),
          normalized.creativeInstructions
        )
      }
    }
  }

  if (useStructuredScenes && structuredScenes) {
    console.log('[Pipeline · analyze] Detected Scene/VO/Clip structure', {
      scenes: structuredScenes.length,
      creativeInstructions: Boolean(normalized.creativeInstructions?.trim()),
      references: normalized.references?.length ?? 0,
      vos: structuredScenes.map((s) => ({
        scene: s.sceneNumber,
        script: s.voText.slice(0, 80),
        clips: s.clips.length
      }))
    })
    const userMessage = buildStructuredUserMessage(normalized, structuredScenes)
    const narrationOnly = narrationScriptFromScenes(structuredScenes)

    const attempt = async (extraUserNote?: string): Promise<LlmAnalyzeResult> => {
      const userContent = extraUserNote
        ? `${userMessage}\n\n---\nFix the previous response. Error: ${extraUserNote}`
        : userMessage

      const raw = await provider.complete(
        [
          { role: 'system', content: STRUCTURED_SYSTEM_PROMPT },
          { role: 'user', content: userContent }
        ],
        { jsonMode: true, temperature: 0.2 }
      )

      const parsed = parseLlmJsonResponse(raw)
      const validated = validateAnalysisResult(parsed, referenceIds, {
        fullScript: narrationOnly,
        enforceExactScript: false,
        expectedSegmentCount: structuredScenes.length
      })
      return finalizeStructuredSegments(validated, structuredScenes, normalized)
    }

    try {
      return await attempt()
    } catch (firstErr) {
      try {
        return await attempt(formatValidationError(firstErr))
      } catch {
        // Always keep Scene/VO structure; still bake creative + refs into prompts.
        return enrichAnalysisWithCreative(
          buildDeterministicStructuredResult(structuredScenes, normalized),
          normalized.creativeInstructions
        )
      }
    }
  }

  const userMessage = buildUserMessage(normalized)

  const attempt = async (extraUserNote?: string): Promise<LlmAnalyzeResult> => {
    const userContent = extraUserNote
      ? `${userMessage}\n\n---\nFix the previous response. Error: ${extraUserNote}`
      : userMessage

    const raw = await provider.complete(
      [
        { role: 'system', content: FREEFORM_SYSTEM_PROMPT },
        { role: 'user', content: userContent }
      ],
      { jsonMode: true, temperature: 0.35 }
    )

    const parsed = parseLlmJsonResponse(raw)
    const validated = validateAnalysisResult(parsed, referenceIds, {
      fullScript: trimmed,
      enforceExactScript: true
    })
    return enrichAnalysisWithCreative(validated, normalized.creativeInstructions)
  }

  try {
    let result = await attempt()
    if (isCoarseSegmentation(result, trimmed)) {
      console.log('[Pipeline · analyze] Coarse freeform split — requesting finer segments', {
        segments: result.segments.length,
        avgWords: Math.round(
          result.segments.reduce((sum, s) => sum + wordCount(s.scriptText), 0) /
            Math.max(1, result.segments.length)
        )
      })
      try {
        result = await attempt(buildFineSplitRetryNote(result))
      } catch {
        // Keep the first valid result if the fine-split retry fails validation.
      }
    }
    console.log('[Pipeline · analyze] Freeform analysis complete', {
      segments: result.segments.length,
      creativeInstructions: Boolean(normalized.creativeInstructions?.trim())
    })
    return result
  } catch (firstErr) {
    try {
      return await attempt(formatValidationError(firstErr))
    } catch {
      throw firstErr
    }
  }
}
