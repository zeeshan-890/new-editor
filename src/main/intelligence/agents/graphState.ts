import { Annotation } from '@langchain/langgraph'
import type { AnalyzeScriptInput, LlmAnalyzeResult } from '../../../shared/segmentPipeline'
import type { LlmProvider } from '../../llm/llmProvider'
import type {
  AgentRunMeta,
  CreativeBriefExtraction,
  ReferencePlan,
  ScriptAnalysisDraft
} from './types'

export type AnalyzeGraphPhase =
  | 'init'
  | 'creative'
  | 'references'
  | 'segment'
  | 'image'
  | 'critic'
  | 'video'
  | 'assemble'
  | 'done'
  | 'error'

export const AnalyzeGraphAnnotation = Annotation.Root({
  provider: Annotation<LlmProvider>(),
  input: Annotation<AnalyzeScriptInput>(),

  creativeBrief: Annotation<CreativeBriefExtraction | null>({
    reducer: (_prev, next) => next,
    default: () => null
  }),
  referencePlan: Annotation<ReferencePlan | null>({
    reducer: (_prev, next) => next,
    default: () => null
  }),
  scriptDraft: Annotation<ScriptAnalysisDraft | null>({
    reducer: (_prev, next) => next,
    default: () => null
  }),
  imagePrompts: Annotation<Record<number, string>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({})
  }),
  videoPrompts: Annotation<Record<number, string>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({})
  }),

  criticPass: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0
  }),
  needsImageRevision: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false
  }),
  criticIssues: Annotation<
    Array<{ index: number; severity: string; severityLevel: 'low' | 'medium' | 'high' }>
  >({
    reducer: (_prev, next) => next,
    default: () => []
  }),

  analysis: Annotation<LlmAnalyzeResult | null>({
    reducer: (_prev, next) => next,
    default: () => null
  }),
  phase: Annotation<AnalyzeGraphPhase>({
    reducer: (_prev, next) => next,
    default: () => 'init'
  }),
  agentTrace: Annotation<AgentRunMeta[]>({
    reducer: (prev, next) => prev.concat(next),
    default: () => []
  }),
  lastError: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null
  })
})

export type AnalyzeGraphState = typeof AnalyzeGraphAnnotation.State
export type AnalyzeGraphUpdate = typeof AnalyzeGraphAnnotation.Update

export const MAX_CRITIC_PASSES = 2
