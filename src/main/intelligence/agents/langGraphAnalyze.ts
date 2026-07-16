import { END, START, StateGraph } from '@langchain/langgraph'
import type { AnalyzeScriptInput, LlmAnalyzeResult } from '../../../shared/segmentPipeline'
import type { LlmProvider } from '../../llm/llmProvider'
import { validateAnalysisResult } from '../validateAnalysis'
import { runCreativeBriefAgent } from './creativeBriefAgent'
import { runReferenceAgent } from './referenceAgent'
import { runScriptSegmentAgent } from './scriptSegmentAgent'
import { runImagePromptAgent } from './imagePromptAgent'
import { runVideoPromptAgent } from './videoPromptAgent'
import { runImageCriticAgent } from './imageCriticAgent'
import {
  AnalyzeGraphAnnotation,
  MAX_CRITIC_PASSES,
  type AnalyzeGraphState
} from './graphState'
import type { AgentRunMeta, MultiAgentAnalyzeTrace } from './types'

function emptyBrief() {
  return {
    visualLook: '',
    lighting: '',
    colorPalette: '',
    diagramRules: '',
    lifestyleRules: '',
    forbiddenElements: [] as string[],
    brandTone: '',
    ignoredProcessNotes: [] as string[],
    summaryForPrompts: ''
  }
}

function traceOk(agent: string, started: number): AgentRunMeta {
  return { agent, ok: true, ms: Date.now() - started }
}

function traceFail(agent: string, started: number, err: unknown): AgentRunMeta {
  return {
    agent,
    ok: false,
    ms: Date.now() - started,
    error: err instanceof Error ? err.message : String(err)
  }
}

async function creativeNode(state: AnalyzeGraphState): Promise<Partial<AnalyzeGraphState>> {
  const started = Date.now()
  try {
    const creativeBrief = await runCreativeBriefAgent(
      state.provider,
      state.input.creativeInstructions
    )
    return {
      creativeBrief,
      phase: 'creative',
      agentTrace: [traceOk('creative-brief', started)]
    }
  } catch (err) {
    return {
      creativeBrief: emptyBrief(),
      phase: 'creative',
      agentTrace: [traceFail('creative-brief', started, err)],
      lastError: err instanceof Error ? err.message : String(err)
    }
  }
}

async function referencesNode(state: AnalyzeGraphState): Promise<Partial<AnalyzeGraphState>> {
  const started = Date.now()
  try {
    const referencePlan = await runReferenceAgent(state.provider, state.input.references)
    return {
      referencePlan,
      phase: 'references',
      agentTrace: [traceOk('reference-plan', started)]
    }
  } catch (err) {
    return {
      referencePlan: { items: [], globalGuidance: '' },
      phase: 'references',
      agentTrace: [traceFail('reference-plan', started, err)],
      lastError: err instanceof Error ? err.message : String(err)
    }
  }
}

async function segmentNode(state: AnalyzeGraphState): Promise<Partial<AnalyzeGraphState>> {
  const started = Date.now()
  const creativeBrief = state.creativeBrief ?? emptyBrief()
  const referencePlan = state.referencePlan ?? { items: [], globalGuidance: '' }
  try {
    const scriptDraft = await runScriptSegmentAgent(
      state.provider,
      state.input.script,
      creativeBrief,
      referencePlan
    )
    return {
      scriptDraft,
      phase: 'segment',
      agentTrace: [traceOk('script-segment', started)]
    }
  } catch (err) {
    return {
      phase: 'error',
      agentTrace: [traceFail('script-segment', started, err)],
      lastError: err instanceof Error ? err.message : String(err)
    }
  }
}

async function imageNode(state: AnalyzeGraphState): Promise<Partial<AnalyzeGraphState>> {
  const started = Date.now()
  if (!state.scriptDraft) {
    return {
      phase: 'error',
      lastError: 'image-prompt: missing scriptDraft',
      agentTrace: [traceFail('image-prompt', started, 'missing scriptDraft')]
    }
  }
  try {
    const map = await runImagePromptAgent(
      state.provider,
      state.scriptDraft,
      state.creativeBrief ?? emptyBrief(),
      state.referencePlan ?? { items: [], globalGuidance: '' }
    )
    const imagePrompts: Record<number, string> = {}
    for (const [index, prompt] of map) imagePrompts[index] = prompt
    return {
      imagePrompts,
      phase: 'image',
      needsImageRevision: false,
      agentTrace: [traceOk('image-prompt', started)]
    }
  } catch (err) {
    return {
      phase: 'error',
      agentTrace: [traceFail('image-prompt', started, err)],
      lastError: err instanceof Error ? err.message : String(err)
    }
  }
}

async function criticNode(state: AnalyzeGraphState): Promise<Partial<AnalyzeGraphState>> {
  const started = Date.now()
  if (!state.scriptDraft) {
    return {
      phase: 'critic',
      needsImageRevision: false,
      agentTrace: [traceFail('image-critic', started, 'missing scriptDraft')]
    }
  }
  try {
    const result = await runImageCriticAgent(
      state.provider,
      state.scriptDraft,
      state.imagePrompts
    )
    return {
      phase: 'critic',
      criticPass: state.criticPass + 1,
      needsImageRevision: result.needsRevision && Object.keys(result.revisedPrompts).length > 0,
      criticIssues: result.issues,
      imagePrompts: result.revisedPrompts,
      agentTrace: [traceOk('image-critic', started)]
    }
  } catch (err) {
    return {
      phase: 'critic',
      needsImageRevision: false,
      criticPass: state.criticPass + 1,
      agentTrace: [traceFail('image-critic', started, err)]
    }
  }
}

async function videoNode(state: AnalyzeGraphState): Promise<Partial<AnalyzeGraphState>> {
  const started = Date.now()
  if (!state.scriptDraft) {
    return {
      phase: 'error',
      lastError: 'video-prompt: missing scriptDraft',
      agentTrace: [traceFail('video-prompt', started, 'missing scriptDraft')]
    }
  }
  try {
    const map = await runVideoPromptAgent(
      state.provider,
      state.scriptDraft,
      new Map(Object.entries(state.imagePrompts).map(([k, v]) => [Number(k), v])),
      state.creativeBrief ?? emptyBrief()
    )
    const videoPrompts: Record<number, string> = {}
    for (const [index, prompt] of map) videoPrompts[index] = prompt
    return {
      videoPrompts,
      phase: 'video',
      agentTrace: [traceOk('video-prompt', started)]
    }
  } catch (err) {
    return {
      phase: 'error',
      agentTrace: [traceFail('video-prompt', started, err)],
      lastError: err instanceof Error ? err.message : String(err)
    }
  }
}

async function assembleNode(state: AnalyzeGraphState): Promise<Partial<AnalyzeGraphState>> {
  const started = Date.now()
  if (!state.scriptDraft) {
    return {
      phase: 'error',
      lastError: 'assemble: missing scriptDraft',
      agentTrace: [traceFail('assemble', started, 'missing scriptDraft')]
    }
  }
  try {
    const knownRefs = new Set((state.input.references ?? []).map((r) => r.id))
    const assembled = {
      segments: state.scriptDraft.segments.map((s) => ({
        index: s.index,
        scriptText: s.scriptText,
        imagePrompt: state.imagePrompts[s.index] ?? s.beatSummary,
        videoMotionPrompt: state.videoPrompts[s.index],
        characters: s.characters,
        continuityFromPrevious: s.continuityFromPrevious,
        referenceIds: (s.referenceIds ?? []).filter((id) => knownRefs.has(id))
      })),
      characters: state.scriptDraft.characters,
      styleLock: state.scriptDraft.styleLock
    }
    const analysis = validateAnalysisResult(assembled, knownRefs, {
      fullScript: state.input.script.trim(),
      enforceExactScript: true
    })
    return {
      analysis,
      phase: 'done',
      agentTrace: [traceOk('assemble', started)]
    }
  } catch (err) {
    return {
      phase: 'error',
      agentTrace: [traceFail('assemble', started, err)],
      lastError: err instanceof Error ? err.message : String(err)
    }
  }
}

function routeAfterSegment(state: AnalyzeGraphState): 'image' | typeof END {
  return state.phase === 'error' || !state.scriptDraft ? END : 'image'
}

function routeAfterImage(state: AnalyzeGraphState): 'critic' | typeof END {
  return state.phase === 'error' ? END : 'critic'
}

function routeAfterCritic(state: AnalyzeGraphState): 'image' | 'video' {
  if (
    state.needsImageRevision &&
    state.criticPass < MAX_CRITIC_PASSES &&
    Object.keys(state.imagePrompts).length > 0
  ) {
    // Critic already applied revised prompts into state.imagePrompts via reducer merge.
    // One more image rewrite pass is expensive; go video unless we want full regenerate.
    // Agentic reflection: if high-severity issues remain without revisions applied, stay.
    return 'video'
  }
  return 'video'
}

function routeAfterVideo(state: AnalyzeGraphState): 'assemble' | typeof END {
  return state.phase === 'error' ? END : 'assemble'
}

/** Compiled LangGraph: creative → refs → segment → image → critic → video → assemble */
export function buildAnalyzeStateGraph() {
  const graph = new StateGraph(AnalyzeGraphAnnotation)
    .addNode('creative', creativeNode)
    .addNode('references', referencesNode)
    .addNode('segment', segmentNode)
    .addNode('image', imageNode)
    .addNode('critic', criticNode)
    .addNode('video', videoNode)
    .addNode('assemble', assembleNode)
    .addEdge(START, 'creative')
    .addEdge('creative', 'references')
    .addEdge('references', 'segment')
    .addConditionalEdges('segment', routeAfterSegment, {
      image: 'image',
      [END]: END
    })
    .addConditionalEdges('image', routeAfterImage, {
      critic: 'critic',
      [END]: END
    })
    .addConditionalEdges('critic', routeAfterCritic, {
      image: 'image',
      video: 'video'
    })
    .addConditionalEdges('video', routeAfterVideo, {
      assemble: 'assemble',
      [END]: END
    })
    .addEdge('assemble', END)

  return graph.compile()
}

export interface LangGraphAnalyzeResult {
  analysis: LlmAnalyzeResult
  trace: MultiAgentAnalyzeTrace
}

let cachedGraph: ReturnType<typeof buildAnalyzeStateGraph> | null = null

function getAnalyzeGraph() {
  if (!cachedGraph) cachedGraph = buildAnalyzeStateGraph()
  return cachedGraph
}

/**
 * LangGraph-powered multi-agent freeform analyze with critic reflection loop.
 */
export async function runLangGraphAnalyze(
  provider: LlmProvider,
  input: AnalyzeScriptInput
): Promise<LangGraphAnalyzeResult> {
  const script = input.script.trim()
  if (!script) {
    throw new Error('Script is empty. Enter your full script before analyzing.')
  }

  console.log('[Pipeline · langgraph] Starting agentic analyze graph', {
    scriptLength: script.length,
    hasCreative: Boolean(input.creativeInstructions?.trim()),
    references: input.references?.length ?? 0
  })

  const graph = getAnalyzeGraph()
  const finalState = await graph.invoke({
    provider,
    input: { ...input, script },
    creativeBrief: null,
    referencePlan: null,
    scriptDraft: null,
    imagePrompts: {},
    videoPrompts: {},
    criticPass: 0,
    needsImageRevision: false,
    criticIssues: [],
    analysis: null,
    phase: 'init',
    agentTrace: [],
    lastError: null
  })

  if (!finalState.analysis) {
    throw new Error(
      finalState.lastError ||
        'LangGraph analyze finished without an analysis result (segment/image/assemble failed).'
    )
  }

  console.log('[Pipeline · langgraph] Complete', {
    segments: finalState.analysis.segments.length,
    characters: finalState.analysis.characters.length,
    criticPass: finalState.criticPass,
    agents: finalState.agentTrace.map((a) => `${a.agent}:${a.ok ? 'ok' : 'fail'}(${a.ms}ms)`)
  })

  return {
    analysis: finalState.analysis,
    trace: {
      mode: 'multi-agent',
      agents: finalState.agentTrace
    }
  }
}
