import type { LlmProvider } from '../../llm/llmProvider'
import { DEFAULT_ASPECT_RATIO } from '../../../shared/types'
import { cleanNarrationScriptText } from '../validateAnalysis'
import { runJsonAgent, asRecord, asString, asStringArray } from './runJsonAgent'
import type {
  AgentBeatVisualMode,
  CreativeBriefExtraction,
  ReferencePlan,
  ScriptAnalysisDraft,
  ScriptSegmentDraft
} from './types'
import { formatCreativeBriefForPrompt } from './creativeBriefAgent'
import { formatReferencePlanForPrompt } from './referenceAgent'
import { roleGoalConstraintsPrompt, SEGMENT_PLANNING_HINT } from './promptStrategies'

const SYSTEM = [
  roleGoalConstraintsPrompt({
    role: 'Script segmentation agent for video production',
    goal: 'Split narration into the maximum number of short visual beats; extract characters + styleLock only',
    constraints: [
      'Do NOT write final image or video prompts — only beatSummary notes',
      'Prefer MORE segments; ~3–18 words of scriptText when possible',
      'scriptText must be exact narration words only (no Scene/VO/Clip labels)',
      'visualMode: lifestyle | diagram | product (diagram = anatomy/tooth/medical viz)',
      'Assign referenceIds only when a reference clearly applies'
    ],
    outputSchema: `{
  "segments": [
    {
      "index": 0,
      "scriptText": "exact narration words",
      "visualMode": "lifestyle"|"diagram"|"product",
      "characters": ["id"],
      "continuityFromPrevious": false,
      "beatSummary": "one-line visual beat note",
      "referenceIds": ["optional_ref_id"]
    }
  ],
  "characters": [
    { "id": "snake_case", "name": "Name", "role": "role", "description": "appearance" }
  ],
  "styleLock": { "aspectRatio": "9:16", "visualStyle": "string", "setting": "string" }
}`
  }),
  '',
  SEGMENT_PLANNING_HINT
].join('\n')

function parseMode(value: unknown): AgentBeatVisualMode {
  const v = asString(value).toLowerCase()
  if (v === 'diagram' || v === 'product') return v
  return 'lifestyle'
}

export async function runScriptSegmentAgent(
  provider: LlmProvider,
  script: string,
  creativeBrief: CreativeBriefExtraction,
  referencePlan: ReferencePlan
): Promise<ScriptAnalysisDraft> {
  const briefBlock = formatCreativeBriefForPrompt(creativeBrief)
  const refBlock = formatReferencePlanForPrompt(referencePlan)

  return runJsonAgent(provider, {
    agentName: 'script-segment',
    system: SYSTEM,
    temperature: 0.35,
    user: [
      'Split this narration into the maximum number of short visual segments.',
      briefBlock ? `\nCREATIVE BRIEF (apply when relevant):\n${briefBlock}` : '',
      refBlock ? `\nREFERENCE PLAN:\n${refBlock}` : '',
      '',
      'SCRIPT:',
      script.trim(),
      '',
      'JSON schema:',
      '{',
      '  "segments": [',
      '    {',
      '      "index": 0,',
      '      "scriptText": "exact narration words",',
      '      "visualMode": "lifestyle"|"diagram"|"product",',
      '      "characters": ["id"],',
      '      "continuityFromPrevious": false,',
      '      "beatSummary": "one-line visual beat note",',
      '      "referenceIds": ["optional_ref_id"]',
      '    }',
      '  ],',
      '  "characters": [',
      '    { "id": "snake_case", "name": "Name", "role": "role", "description": "appearance" }',
      '  ],',
      '  "styleLock": { "aspectRatio": "9:16", "visualStyle": "string", "setting": "string" }',
      '}'
    ]
      .filter(Boolean)
      .join('\n'),
    validate: (data) => {
      const obj = asRecord(data, 'script-segment')
      const knownRefs = new Set(referencePlan.items.map((i) => i.id))
      const segmentsRaw = Array.isArray(obj.segments) ? obj.segments : []
      if (segmentsRaw.length < 1) {
        throw new Error('script-segment: expected at least 1 segment.')
      }

      const segments: ScriptSegmentDraft[] = segmentsRaw.map((seg, i) => {
        if (!seg || typeof seg !== 'object') {
          throw new Error(`script-segment: segment ${i} invalid.`)
        }
        const row = seg as Record<string, unknown>
        const scriptText = cleanNarrationScriptText(asString(row.scriptText))
        if (!scriptText) throw new Error(`script-segment: segment ${i} empty scriptText.`)
        const referenceIds = asStringArray(row.referenceIds).filter((id) => knownRefs.has(id))
        return {
          index: typeof row.index === 'number' ? row.index : i,
          scriptText,
          visualMode: parseMode(row.visualMode),
          characters: asStringArray(row.characters),
          continuityFromPrevious: Boolean(row.continuityFromPrevious),
          beatSummary: asString(row.beatSummary) || scriptText.slice(0, 80),
          referenceIds: referenceIds.length ? referenceIds : undefined
        }
      })

      segments.sort((a, b) => a.index - b.index)
      segments.forEach((s, i) => {
        s.index = i
      })

      const charactersRaw = Array.isArray(obj.characters) ? obj.characters : []
      const characters = charactersRaw.map((c, i) => {
        if (!c || typeof c !== 'object') {
          throw new Error(`script-segment: character ${i} invalid.`)
        }
        const row = c as Record<string, unknown>
        const id = asString(row.id)
        const name = asString(row.name)
        const description = asString(row.description)
        if (!id || !name || !description) {
          throw new Error(`script-segment: character ${i} missing id/name/description.`)
        }
        return {
          id,
          name,
          role: asString(row.role) || undefined,
          description
        }
      })

      const styleObj =
        obj.styleLock && typeof obj.styleLock === 'object'
          ? (obj.styleLock as Record<string, unknown>)
          : {}

      return {
        segments,
        characters,
        styleLock: {
          aspectRatio: asString(styleObj.aspectRatio) || DEFAULT_ASPECT_RATIO,
          visualStyle:
            asString(styleObj.visualStyle) ||
            creativeBrief.visualLook ||
            'cinematic realism, natural soft lighting',
          setting: asString(styleObj.setting) || undefined
        }
      }
    }
  })
}
