import type { LlmProvider } from '../../llm/llmProvider'
import { MEDICAL_DIAGRAM_PROMPT_PREFIX } from '../../../shared/pipelinePromptGuards'
import { runJsonAgent, asRecord, asString } from './runJsonAgent'
import type {
  CreativeBriefExtraction,
  ReferencePlan,
  ScriptAnalysisDraft,
  ScriptSegmentDraft
} from './types'
import { formatCreativeBriefForPrompt } from './creativeBriefAgent'
import { formatReferencePlanForPrompt } from './referenceAgent'
import { roleGoalConstraintsPrompt } from './promptStrategies'

const SYSTEM = roleGoalConstraintsPrompt({
  role: 'Structured image-prompt writer for video storyboard stills',
  goal: 'Produce one production-ready imagePrompt per segment using script + brief + refs + characters',
  constraints: [
    'One unified frame per segment (never collage / multi-panel / character sheet)',
    `For visualMode=diagram: ALWAYS start with exactly "${MEDICAL_DIAGRAM_PROMPT_PREFIX}" then ONLY unlabeled 3D anatomy filling the frame`,
    'Diagram never includes clinic, office, monitor, TV, screen, people, chairs, text, or labels',
    'Lifestyle: photorealistic live scene; no floating medical HUDs unless required',
    'Synthesize rules into natural prompt language — do not paste brief labels verbatim'
  ],
  outputSchema: '{ "prompts": [ { "index": 0, "imagePrompt": "..." } ] }'
})

function characterLines(
  draft: ScriptAnalysisDraft,
  segment: ScriptSegmentDraft
): string {
  return segment.characters
    .map((id) => draft.characters.find((c) => c.id === id))
    .filter(Boolean)
    .map((c) => `${c!.name} (${c!.role ?? 'role'}): ${c!.description}`)
    .join('\n')
}

function refLines(plan: ReferencePlan, segment: ScriptSegmentDraft): string {
  const ids = new Set(segment.referenceIds ?? [])
  const matched = plan.items.filter((i) => ids.has(i.id))
  // If segment lists no ids but plan has items, surface all (parts mode attaches all refs).
  const items = matched.length > 0 ? matched : ids.size === 0 ? plan.items : []
  return items.map((i) => `${i.id}: ${i.usageSummary}`).join('\n')
}

export async function runImagePromptAgent(
  provider: LlmProvider,
  draft: ScriptAnalysisDraft,
  creativeBrief: CreativeBriefExtraction,
  referencePlan: ReferencePlan
): Promise<Map<number, string>> {
  const briefBlock = formatCreativeBriefForPrompt(creativeBrief)
  const batchSize = 8
  const result = new Map<number, string>()

  for (let offset = 0; offset < draft.segments.length; offset += batchSize) {
    const batch = draft.segments.slice(offset, offset + batchSize)
    const planBlock = formatReferencePlanForPrompt(referencePlan)
    const batchMap = await runJsonAgent(provider, {
      agentName: `image-prompt[${offset}-${offset + batch.length - 1}]`,
      system: SYSTEM,
      temperature: 0.3,
      user: [
        'Write imagePrompt for each segment below.',
        briefBlock ? `\nCREATIVE BRIEF:\n${briefBlock}` : '',
        planBlock
          ? `\nATTACHED REFERENCE IMAGES (match these in prompts; images are also attached at generation):\n${planBlock}`
          : '',
        `\nSTYLE LOCK: ${draft.styleLock.visualStyle}` +
          (draft.styleLock.setting ? `; setting=${draft.styleLock.setting}` : ''),
        '',
        'SEGMENTS:',
        ...batch.map((s) => {
          const chars = characterLines(draft, s)
          const refs = refLines(referencePlan, s)
          return [
            `--- segment ${s.index} ---`,
            `visualMode: ${s.visualMode}`,
            `scriptText: ${s.scriptText}`,
            `beatSummary: ${s.beatSummary}`,
            chars ? `characters:\n${chars}` : 'characters: none',
            refs
              ? `references for this beat:\n${refs}`
              : planBlock
                ? 'references for this beat: use ATTACHED REFERENCE IMAGES above'
                : 'references: none'
          ].join('\n')
        }),
        '',
        'Return JSON: { "prompts": [ { "index": number, "imagePrompt": string } ] }',
        `Must include every index: ${batch.map((s) => s.index).join(', ')}`
      ]
        .filter(Boolean)
        .join('\n'),
      validate: (data) => {
        const obj = asRecord(data, 'image-prompt')
        const prompts = Array.isArray(obj.prompts) ? obj.prompts : []
        const map = new Map<number, string>()
        for (const row of prompts) {
          if (!row || typeof row !== 'object') continue
          const r = row as Record<string, unknown>
          const index = typeof r.index === 'number' ? r.index : -1
          let imagePrompt = asString(r.imagePrompt)
          if (index < 0 || !imagePrompt) continue
          const segment = batch.find((s) => s.index === index)
          if (segment?.visualMode === 'diagram') {
            if (!/^create\s+3d\s+medical\s+diagram/i.test(imagePrompt)) {
              imagePrompt = `${MEDICAL_DIAGRAM_PROMPT_PREFIX} ${imagePrompt}`
            }
          }
          map.set(index, imagePrompt)
        }
        for (const s of batch) {
          if (!map.has(s.index)) {
            map.set(s.index, fallbackImagePrompt(s))
          }
        }
        return map
      }
    })

    for (const [index, prompt] of batchMap) {
      result.set(index, prompt)
    }
  }

  return result
}

function fallbackImagePrompt(segment: ScriptSegmentDraft): string {
  if (segment.visualMode === 'diagram') {
    return `${MEDICAL_DIAGRAM_PROMPT_PREFIX} Unlabeled 3D anatomical subject for: ${segment.beatSummary}. Full-frame isolated diagram on plain background, no text, no clinic, no monitor.`
  }
  return `${segment.beatSummary}. Single unified cinematic frame suitable for image-to-video. Not a collage.`
}
