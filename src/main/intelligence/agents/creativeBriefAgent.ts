import type { LlmProvider } from '../../llm/llmProvider'
import { runJsonAgent, asRecord, asString, asStringArray } from './runJsonAgent'
import type { CreativeBriefExtraction } from './types'
import { roleGoalConstraintsPrompt } from './promptStrategies'

const SYSTEM = roleGoalConstraintsPrompt({
  role: 'Creative brief extraction agent for script-to-video production',
  goal: 'Turn free-form creative instructions into a structured visual rulebook downstream agents can honor',
  constraints: [
    'Separate visual rules from pipeline/process notes (e.g. generate images then videos)',
    'Be concrete: look, lighting, color, diagram rules, lifestyle rules, forbidden elements, brand tone',
    'summaryForPrompts must be a short synthesis — never a verbatim dump',
    'Preserve medical-diagram rules when present (unlabeled 3D anatomy, no clinic/monitor/text)'
  ],
  outputSchema: `{
  "visualLook": "string",
  "lighting": "string",
  "colorPalette": "string",
  "diagramRules": "string",
  "lifestyleRules": "string",
  "forbiddenElements": ["string"],
  "brandTone": "string",
  "ignoredProcessNotes": ["string"],
  "summaryForPrompts": "string"
}`
})

export async function runCreativeBriefAgent(
  provider: LlmProvider,
  creativeInstructions: string | undefined
): Promise<CreativeBriefExtraction> {
  const raw = creativeInstructions?.trim() ?? ''
  if (!raw) {
    return {
      visualLook: '',
      lighting: '',
      colorPalette: '',
      diagramRules:
        'Medical/scientific diagrams: full-frame unlabeled 3D anatomy only; no clinic, monitor, text, or labels.',
      lifestyleRules:
        'Photorealistic live scenes; no floating medical HUD overlays unless the beat is a diagram.',
      forbiddenElements: [],
      brandTone: '',
      ignoredProcessNotes: [],
      summaryForPrompts: ''
    }
  }

  return runJsonAgent(provider, {
    agentName: 'creative-brief',
    system: SYSTEM,
    temperature: 0.2,
    user: ['Extract this creative-instructions block into structured fields.', '', raw].join('\n'),
    validate: (data) => {
      const obj = asRecord(data, 'creative-brief')
      return {
        visualLook: asString(obj.visualLook),
        lighting: asString(obj.lighting),
        colorPalette: asString(obj.colorPalette),
        diagramRules: asString(obj.diagramRules),
        lifestyleRules: asString(obj.lifestyleRules),
        forbiddenElements: asStringArray(obj.forbiddenElements),
        brandTone: asString(obj.brandTone),
        ignoredProcessNotes: asStringArray(obj.ignoredProcessNotes),
        summaryForPrompts: asString(obj.summaryForPrompts) || asString(obj.visualLook)
      }
    }
  })
}

export function formatCreativeBriefForPrompt(brief: CreativeBriefExtraction): string {
  const parts = [
    brief.summaryForPrompts && `Summary: ${brief.summaryForPrompts}`,
    brief.visualLook && `Look: ${brief.visualLook}`,
    brief.lighting && `Lighting: ${brief.lighting}`,
    brief.colorPalette && `Color: ${brief.colorPalette}`,
    brief.diagramRules && `Diagram rules: ${brief.diagramRules}`,
    brief.lifestyleRules && `Lifestyle rules: ${brief.lifestyleRules}`,
    brief.brandTone && `Tone: ${brief.brandTone}`,
    brief.forbiddenElements.length
      ? `Forbidden: ${brief.forbiddenElements.join('; ')}`
      : ''
  ].filter(Boolean)
  return parts.join('\n')
}
