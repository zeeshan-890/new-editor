import type { AnalyzeScriptInput, LlmAnalyzeResult } from '../../../shared/segmentPipeline'
import type { LlmProvider } from '../../llm/llmProvider'
import { runLangGraphAnalyze } from './langGraphAnalyze'
import type { MultiAgentAnalyzeTrace } from './types'

export interface MultiAgentAnalyzeResult {
  analysis: LlmAnalyzeResult
  trace: MultiAgentAnalyzeTrace
}

/**
 * Primary freeform analyze entry: LangGraph StateGraph with specialist agents + critic loop.
 * Agentic concepts: multi-agent specialization, shared state, conditional edges, reflection/QA.
 */
export async function orchestrateMultiAgentAnalyze(
  provider: LlmProvider,
  input: AnalyzeScriptInput
): Promise<MultiAgentAnalyzeResult> {
  return runLangGraphAnalyze(provider, input)
}
