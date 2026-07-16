import type { LlmProvider } from '../../llm/llmProvider'
import { runJsonAgent, asRecord, asString, asStringArray } from './runJsonAgent'
import type { AgentBeatVisualMode, ReferencePlan, ReferencePlanItem } from './types'
import { roleGoalConstraintsPrompt } from './promptStrategies'

const SYSTEM = roleGoalConstraintsPrompt({
  role: 'Reference planning agent for multimodal script-to-image generation',
  goal: 'Decide when each attached reference image should guide a beat',
  constraints: [
    'Never invent reference ids that were not provided',
    'appliesToModes subset of: lifestyle, diagram, product',
    'usageSummary must be actionable matching guidance for prompt writers',
    'Prefer required only when the usage note clearly demands it'
  ],
  outputSchema: `{
  "globalGuidance": "string",
  "items": [
    {
      "id": "existing_id",
      "name": "string",
      "usageSummary": "how to match this ref in prompts",
      "appliesToModes": ["lifestyle"|"diagram"|"product"],
      "priority": "required"|"optional"
    }
  ]
}`
})

function parseMode(value: unknown): AgentBeatVisualMode {
  const v = asString(value).toLowerCase()
  if (v === 'diagram' || v === 'product') return v
  return 'lifestyle'
}

export async function runReferenceAgent(
  provider: LlmProvider,
  references: Array<{ id: string; name: string; instruction: string }> | undefined
): Promise<ReferencePlan> {
  const refs = (references ?? []).filter((r) => r.id && r.name)
  if (refs.length === 0) {
    return { items: [], globalGuidance: '' }
  }

  return runJsonAgent(provider, {
    agentName: 'reference-plan',
    system: SYSTEM,
    temperature: 0.2,
    user: [
      'Build a reference usage plan for these images:',
      ...refs.map(
        (r) =>
          `- id: ${r.id} | file: ${r.name} | usage note: ${r.instruction.trim() || 'visual reference'}`
      ),
      '',
      'JSON schema:',
      '{',
      '  "globalGuidance": "string",',
      '  "items": [',
      '    {',
      '      "id": "existing_id",',
      '      "name": "string",',
      '      "usageSummary": "how to match this ref in prompts",',
      '      "appliesToModes": ["lifestyle"|"diagram"|"product"],',
      '      "priority": "required"|"optional"',
      '    }',
      '  ]',
      '}'
    ].join('\n'),
    validate: (data) => {
      const obj = asRecord(data, 'reference-plan')
      const known = new Set(refs.map((r) => r.id))
      const itemsRaw = Array.isArray(obj.items) ? obj.items : []
      const items: ReferencePlanItem[] = itemsRaw
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const row = item as Record<string, unknown>
          const id = asString(row.id)
          if (!id || !known.has(id)) return null
          const ref = refs.find((r) => r.id === id)!
          const modes = asStringArray(row.appliesToModes).map(parseMode)
          return {
            id,
            name: asString(row.name) || ref.name,
            usageSummary: asString(row.usageSummary) || ref.instruction || 'visual reference',
            appliesToModes: modes.length ? [...new Set(modes)] : (['lifestyle'] as AgentBeatVisualMode[]),
            priority: asString(row.priority) === 'required' ? 'required' : 'optional'
          } satisfies ReferencePlanItem
        })
        .filter((x): x is ReferencePlanItem => Boolean(x))

      // Ensure every provided ref appears at least once
      for (const ref of refs) {
        if (!items.some((i) => i.id === ref.id)) {
          items.push({
            id: ref.id,
            name: ref.name,
            usageSummary: ref.instruction.trim() || 'visual reference',
            appliesToModes: ['lifestyle'],
            priority: 'optional'
          })
        }
      }

      return {
        items,
        globalGuidance: asString(obj.globalGuidance)
      }
    }
  })
}

export function formatReferencePlanForPrompt(plan: ReferencePlan): string {
  if (plan.items.length === 0) return ''
  const lines = plan.items.map(
    (i) =>
      `- ${i.id} (${i.name}, ${i.priority}, modes=${i.appliesToModes.join('|')}): ${i.usageSummary}`
  )
  return [plan.globalGuidance && `Global: ${plan.globalGuidance}`, ...lines]
    .filter(Boolean)
    .join('\n')
}
