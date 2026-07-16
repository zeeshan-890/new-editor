import type { AnalyzeScriptInput, StyleLock } from '../../../shared/segmentPipeline'
import type { LlmProvider } from '../../llm/llmProvider'

/** Visual mode for a beat — drives image/video prompt agents. */
export type AgentBeatVisualMode = 'lifestyle' | 'diagram' | 'product'

/** Agent 1 output: structured creative rulebook (not pasted verbatim into prompts). */
export interface CreativeBriefExtraction {
  visualLook: string
  lighting: string
  colorPalette: string
  diagramRules: string
  lifestyleRules: string
  forbiddenElements: string[]
  brandTone: string
  /** Pipeline/process notes that must NOT affect visuals. */
  ignoredProcessNotes: string[]
  /** Short synthesized summary for downstream agents. */
  summaryForPrompts: string
}

/** Agent 2 output: how each reference should be used. */
export interface ReferencePlanItem {
  id: string
  name: string
  usageSummary: string
  /** Beat types this ref typically applies to. */
  appliesToModes: AgentBeatVisualMode[]
  priority: 'required' | 'optional'
}

export interface ReferencePlan {
  items: ReferencePlanItem[]
  globalGuidance: string
}

/** Agent 3 output: segmentation + characters + style (prompts filled later). */
export interface ScriptSegmentDraft {
  index: number
  scriptText: string
  visualMode: AgentBeatVisualMode
  characters: string[]
  continuityFromPrevious: boolean
  /** Short beat note for prompt writers (not the final image prompt). */
  beatSummary: string
  /** Reference ids this beat should use. */
  referenceIds?: string[]
}

export interface ScriptAnalysisDraft {
  segments: ScriptSegmentDraft[]
  characters: Array<{
    id: string
    name: string
    role?: string
    description: string
  }>
  styleLock: StyleLock
}

/** Shared bag passed through the multi-agent pipeline. */
export interface MultiAgentAnalyzeContext {
  input: AnalyzeScriptInput
  provider: LlmProvider
  creativeBrief: CreativeBriefExtraction | null
  referencePlan: ReferencePlan | null
  scriptDraft: ScriptAnalysisDraft | null
}

export interface AgentRunMeta {
  agent: string
  ok: boolean
  ms: number
  error?: string
}

export interface MultiAgentAnalyzeTrace {
  agents: AgentRunMeta[]
  mode: 'multi-agent'
}
