import type { LlmProvider } from '../../llm/llmProvider'
import { MEDICAL_DIAGRAM_PROMPT_PREFIX } from '../../../shared/pipelinePromptGuards'
import { runJsonAgent, asRecord, asString } from './runJsonAgent'
import { criticSystemPrompt } from './promptStrategies'
import type { ScriptAnalysisDraft } from './types'

export interface CriticResult {
  needsRevision: boolean
  issues: Array<{ index: number; severity: string; severityLevel: 'low' | 'medium' | 'high' }>
  revisedPrompts: Record<number, string>
}

/**
 * Critic / QA agent (agentic reflection loop).
 * Inspects image prompts and rewrites diagram failures.
 */
export async function runImageCriticAgent(
  provider: LlmProvider,
  draft: ScriptAnalysisDraft,
  imagePrompts: Record<number, string>
): Promise<CriticResult> {
  const entries = draft.segments.map((s) => ({
    index: s.index,
    visualMode: s.visualMode,
    scriptText: s.scriptText,
    imagePrompt: imagePrompts[s.index] ?? ''
  }))

  // Deterministic pre-check (fast path) — still run LLM critic for rewrite quality
  const deterministicFails = entries.filter((e) => {
    const p = e.imagePrompt.toLowerCase()
    if (!e.imagePrompt.trim() || e.imagePrompt.trim().length < 20) return true
    if (e.visualMode !== 'diagram') return false
    return (
      /\b(clinic|office|monitor|screen|tv|dental chair|patient|dentist|label|caption)\b/i.test(p) ||
      !/create\s+3d\s+medical\s+diagram/i.test(e.imagePrompt)
    )
  })

  if (deterministicFails.length === 0 && entries.every((e) => e.imagePrompt.trim().length >= 20)) {
    return { needsRevision: false, issues: [], revisedPrompts: {} }
  }

  try {
    return await runJsonAgent(provider, {
      agentName: 'image-critic',
      system: criticSystemPrompt(),
      temperature: 0.15,
      user: [
        'Review these image prompts. Rewrite any that fail diagram/lifestyle rules.',
        '',
        'PROMPTS:',
        ...entries.map(
          (e) =>
            `--- index ${e.index} | mode=${e.visualMode} ---\nscript: ${e.scriptText}\nimagePrompt: ${e.imagePrompt}`
        ),
        '',
        'Return JSON with needsRevision, issues, revisedPrompts (only for failing indexes).'
      ].join('\n'),
      validate: (data) => {
        const obj = asRecord(data, 'image-critic')
        const issuesRaw = Array.isArray(obj.issues) ? obj.issues : []
        const issues = issuesRaw
          .map((row) => {
            if (!row || typeof row !== 'object') return null
            const r = row as Record<string, unknown>
            const index = typeof r.index === 'number' ? r.index : -1
            if (index < 0) return null
            const sev = asString(r.severity)
            const severityLevel =
              sev === 'high' || sev === 'medium' || sev === 'low' ? sev : 'medium'
            return {
              index,
              severity: asString(r.severity) || 'quality issue',
              severityLevel: severityLevel as 'low' | 'medium' | 'high'
            }
          })
          .filter((x): x is NonNullable<typeof x> => Boolean(x))

        const revisedRaw = Array.isArray(obj.revisedPrompts) ? obj.revisedPrompts : []
        const revisedPrompts: Record<number, string> = {}
        for (const row of revisedRaw) {
          if (!row || typeof row !== 'object') continue
          const r = row as Record<string, unknown>
          const index = typeof r.index === 'number' ? r.index : -1
          let imagePrompt = asString(r.imagePrompt)
          if (index < 0 || !imagePrompt) continue
          const segment = draft.segments.find((s) => s.index === index)
          if (segment?.visualMode === 'diagram') {
            if (!/^create\s+3d\s+medical\s+diagram/i.test(imagePrompt)) {
              imagePrompt = `${MEDICAL_DIAGRAM_PROMPT_PREFIX} ${imagePrompt}`
            }
          }
          revisedPrompts[index] = imagePrompt
        }

        // Fallback deterministic rewrites if critic omitted them
        for (const fail of deterministicFails) {
          if (revisedPrompts[fail.index]) continue
          if (fail.visualMode === 'diagram') {
            revisedPrompts[fail.index] =
              `${MEDICAL_DIAGRAM_PROMPT_PREFIX} Unlabeled 3D anatomical subject for: ${fail.scriptText}. Full-frame isolated diagram on plain background only — no clinic, monitor, people, or text.`
          }
        }

        const needsRevision =
          Boolean(obj.needsRevision) ||
          issues.length > 0 ||
          Object.keys(revisedPrompts).length > 0

        return { needsRevision, issues, revisedPrompts }
      }
    })
  } catch {
    // Deterministic repair if critic LLM fails
    const revisedPrompts: Record<number, string> = {}
    const issues = deterministicFails.map((f) => ({
      index: f.index,
      severity: 'Deterministic diagram/lifestyle repair',
      severityLevel: 'high' as const
    }))
    for (const fail of deterministicFails) {
      if (fail.visualMode === 'diagram') {
        revisedPrompts[fail.index] =
          `${MEDICAL_DIAGRAM_PROMPT_PREFIX} Unlabeled 3D anatomical subject for: ${fail.scriptText}. Full-frame isolated diagram on plain background only — no clinic, monitor, people, or text.`
      }
    }
    return {
      needsRevision: Object.keys(revisedPrompts).length > 0,
      issues,
      revisedPrompts
    }
  }
}
