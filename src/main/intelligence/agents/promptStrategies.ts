/**
 * Agentic prompt strategies used across LangGraph analyze nodes.
 * Patterns: Role-Goal-Constraints, ReAct (Thought→Action→Observation),
 * Chain-of-Thought planning, Critic/QA, and structured JSON contracts.
 */

export const AGENTIC_JSON_CONTRACT = `Output contract (strict):
- Respond with ONLY valid JSON (no markdown fences, no commentary outside JSON).
- Prefer concrete visual language over abstract adjectives.
- Never paste raw creative-instruction dumps or filenames into prompt fields.`

/** Role → Goal → Constraints framing for specialist agents. */
export function roleGoalConstraintsPrompt(opts: {
  role: string
  goal: string
  constraints: string[]
  outputSchema: string
}): string {
  return [
    `ROLE: ${opts.role}`,
    `GOAL: ${opts.goal}`,
    '',
    'CONSTRAINTS:',
    ...opts.constraints.map((c, i) => `${i + 1}. ${c}`),
    '',
    'STRATEGY:',
    '- Think step-by-step internally (ReAct: Thought → Action → Observation).',
    '- Do not expose chain-of-thought as free text outside JSON.',
    '- If a field is uncertain, choose the safest production default.',
    '',
    AGENTIC_JSON_CONTRACT,
    '',
    'OUTPUT JSON SCHEMA:',
    opts.outputSchema
  ].join('\n')
}

/** Critic / QA agent: reject bad diagram or empty prompts. */
export function criticSystemPrompt(): string {
  return roleGoalConstraintsPrompt({
    role: 'Senior storyboard QA critic for medical + lifestyle video ads',
    goal: 'Score and optionally rewrite weak image prompts before generation',
    constraints: [
      'Flag diagram prompts that mention clinic, office, monitor, TV, screen, dental chair, people, labels, or text',
      'Flag empty or generic prompts under 20 characters',
      'For diagram failures: rewrite to start with "Create 3D medical diagram, no text, no label." and describe ONLY anatomy on a plain background',
      'Keep lifestyle prompts photorealistic without floating medical HUDs unless visualMode is diagram',
      'Return needsRevision=true when any prompt fails; include revisedPrompts for every failing index'
    ],
    outputSchema: `{
  "needsRevision": boolean,
  "issues": [{ "index": number, "severity": "string", "severity": "low"|"medium"|"high" }],
  "revisedPrompts": [{ "index": number, "imagePrompt": "string" }]
}`
  })
}

/** Planner note injected into segmenter for CoT-style planning without leaking CoT. */
export const SEGMENT_PLANNING_HINT = `Planning checklist (apply silently, then emit JSON only):
1) Find every camera-cut opportunity (subject/action/location/emotion change).
2) Prefer over-splitting (~3–18 words per scriptText).
3) Tag visualMode: diagram for anatomy/tooth/medical viz; product for packaging; else lifestyle.
4) Assign referenceIds only when the plan clearly applies.
5) Keep scriptText as exact narration words only.`
