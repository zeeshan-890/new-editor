import type { LlmProvider } from '../../llm/llmProvider'
import { MEDICAL_DIAGRAM_PROMPT_PREFIX } from '../../../shared/pipelinePromptGuards'
import { runJsonAgent, asRecord, asString } from './runJsonAgent'
import type {
  CreativeBriefExtraction,
  ScriptAnalysisDraft,
  ScriptSegmentDraft
} from './types'
import { formatCreativeBriefForPrompt } from './creativeBriefAgent'
import { roleGoalConstraintsPrompt } from './promptStrategies'

const SYSTEM = roleGoalConstraintsPrompt({
  role: 'Structured video-motion prompt writer for image-to-video',
  goal: 'Write concrete subject + camera motion for each still',
  constraints: [
    '1–2 sentences of CONCRETE motion — never only subtle/gentle/minimal',
    'Diagram beats: slow orbit/push-in; no people or on-screen text appearing',
    'Keep identity/look consistent with the still image prompt'
  ],
  outputSchema: '{ "prompts": [ { "index": 0, "videoMotionPrompt": "..." } ] }'
})

export async function runVideoPromptAgent(
  provider: LlmProvider,
  draft: ScriptAnalysisDraft,
  imagePrompts: Map<number, string>,
  creativeBrief: CreativeBriefExtraction
): Promise<Map<number, string>> {
  const briefBlock = formatCreativeBriefForPrompt(creativeBrief)
  const batchSize = 8
  const result = new Map<number, string>()

  for (let offset = 0; offset < draft.segments.length; offset += batchSize) {
    const batch = draft.segments.slice(offset, offset + batchSize)
    const batchMap = await runJsonAgent(provider, {
      agentName: `video-prompt[${offset}-${offset + batch.length - 1}]`,
      system: SYSTEM,
      temperature: 0.35,
      user: [
        'Write videoMotionPrompt for each segment.',
        briefBlock ? `\nCREATIVE BRIEF (motion/look only):\n${briefBlock}` : '',
        '',
        'SEGMENTS:',
        ...batch.map((s) =>
          [
            `--- segment ${s.index} ---`,
            `visualMode: ${s.visualMode}`,
            `scriptText: ${s.scriptText}`,
            `imagePrompt: ${imagePrompts.get(s.index) ?? s.beatSummary}`
          ].join('\n')
        ),
        '',
        'Return JSON: { "prompts": [ { "index": number, "videoMotionPrompt": string } ] }',
        `Must include every index: ${batch.map((s) => s.index).join(', ')}`
      ]
        .filter(Boolean)
        .join('\n'),
      validate: (data) => {
        const obj = asRecord(data, 'video-prompt')
        const prompts = Array.isArray(obj.prompts) ? obj.prompts : []
        const map = new Map<number, string>()
        for (const row of prompts) {
          if (!row || typeof row !== 'object') continue
          const r = row as Record<string, unknown>
          const index = typeof r.index === 'number' ? r.index : -1
          let motion = asString(r.videoMotionPrompt)
          if (index < 0 || !motion) continue
          if (motion.length > 360) {
            motion = motion.slice(0, 360).replace(/\s+\S*$/, '')
          }
          map.set(index, motion)
        }
        for (const s of batch) {
          if (!map.has(s.index)) {
            map.set(s.index, fallbackVideoPrompt(s, imagePrompts.get(s.index)))
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

function fallbackVideoPrompt(segment: ScriptSegmentDraft, imagePrompt?: string): string {
  if (segment.visualMode === 'diagram') {
    return `${MEDICAL_DIAGRAM_PROMPT_PREFIX} Slow orbit and gentle push-in around the medical diagram; plain background; no text or clinic.`
  }
  const hint = (imagePrompt ?? segment.beatSummary).slice(0, 160)
  return `Animate with visible action matching: ${hint}. Camera slowly pushes in; natural body language and secondary motion.`
}
