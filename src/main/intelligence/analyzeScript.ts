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
  isStructuredSceneScript,
  narrationScriptFromScenes,
  parseStructuredSceneScript,
  type ParsedScene
} from './parseStructuredScript'
import {
  buildDeterministicStructuredResult,
  finalizeStructuredSegments
} from './enrichStructuredPrompts'

const FREEFORM_SYSTEM_PROMPT = `You are a professional script-to-storyboard analyst for video production.

Your task: analyze a narration script and split it into visual segments. Each segment must represent ONE clear visual concept that could be shown as a single animatable scene frame (one unified photograph — never a character sheet, reference board, or multi-panel collage).

The user may also provide creative instructions (separate from the script) and reference images with per-image usage notes. Treat creative instructions as a free-form runtime rulebook: interpret what each part means, apply only the parts that fit each segment's visual context, and synthesize them into natural prompt language. Never paste creative instructions or reference filenames/usage notes verbatim into prompts. Assign reference ids only to segments where that image should guide generation.

Segmentation rules:
- Split when action changes, location changes, time changes, emotion shifts, or camera focus changes
- A single sentence may contain multiple segments if it has multiple visual concepts
- Do not merge unrelated actions into one segment
- Keep segment scriptText as the EXACT verbatim narration words only (never include labels like Scene, VO, Clip, or stage directions)
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
- Never ask for character sheets, reference boards, turnaround views, contact sheets, split panels, or collages
- Prefer medium or wide shots with environmental context
- 40-120 words per imagePrompt

Reference image rules:
- When reference images are provided, read each id and its free-form usage note
- Decide per segment whether that reference applies; put ids in segment.referenceIds only then
- Synthesize matching guidance into imagePrompt prose — never paste filenames or raw usage notes
- Creative instructions are free-form: interpret and apply only where relevant; never paste them verbatim

Video motion (optional per segment):
- Short hint for image-to-video only — no creative-instruction dumps

continuityFromPrevious: true only when the scene is a direct visual continuation of the previous segment (same location, continuous action).

Respond with ONLY valid JSON matching this schema:
{
  "segments": [
    {
      "index": 0,
      "scriptText": "exact narration words only",
      "imagePrompt": "detailed scene prompt with roles and setting",
      "videoMotionPrompt": "optional motion hint",
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
4. imagePrompt: one unified cinematic still (40-140 words) from clips + only applicable synthesized guidance.
5. videoMotionPrompt: SHORT motion/camera hint from clips (1-2 sentences). No instruction dumps. No filenames.
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
      "videoMotionPrompt": "short motion hint only",
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

function buildUserMessage(input: AnalyzeScriptInput): string {
  const script = input.script.trim()
  const parts: string[] = [script]
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
  const structuredScenes = parseStructuredSceneScript(trimmed)
  const useStructured = Boolean(structuredScenes && isStructuredSceneScript(trimmed))

  const settings = await loadLlmSettings()
  const provider = createOpenAiCompatibleProvider(settings)

  if (useStructured && structuredScenes) {
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
        return buildDeterministicStructuredResult(structuredScenes, normalized)
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
    return validateAnalysisResult(parsed, referenceIds, {
      fullScript: trimmed,
      enforceExactScript: true
    })
  }

  try {
    return await attempt()
  } catch (firstErr) {
    try {
      return await attempt(formatValidationError(firstErr))
    } catch {
      throw firstErr
    }
  }
}
