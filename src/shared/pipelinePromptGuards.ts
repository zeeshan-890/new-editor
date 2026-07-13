/**
 * Hardcoded prompt constraints so image/video models don't mix
 * lifestyle product scenes with floating medical HUDs (or vice versa).
 */

export type SceneVisualMode = 'lifestyle' | 'diagram'

/** Lifestyle / live-action: forbid floating medical overlays. */
export const LIFESTYLE_SCENE_CONSTRAINT =
  'Photorealistic/live scene only. NO floating medical diagrams, NO holographic anatomy overlays, NO UI HUD panels, NO educational charts in the background, NO translucent body organ graphics, NO X-ray/CT overlays, NO warning icons floating in air, NO educational infographic layers.'

/** Diagram / scientific: keep a clean single-subject visualization. */
export const DIAGRAM_SCENE_CONSTRAINT =
  'Clean scientific/medical visualization only. Single focused diagram subject. NO people, NO faces, NO bathroom/kitchen lifestyle set dressing, NO product packaging unless specified, NO extra unrelated diagrams or HUD clutter.'

const DIAGRAM_SCENE_RE =
  /\b(diagram|schematic|infographic|anatom(y|ical)|cross[-\s]?section|molecular|microscop(e|ic)|cellular|organ\s+diagram|scientific\s+(visualization|illustration|animation)|medical\s+(illustration|animation|diagram|graphic)|3d\s+(medical|anatom|organ|cell)|educational\s+(graphic|animation|diagram)|hud\s+(overlay|panel)|holographic\s+(diagram|anatomy|organ|chart)|x[-\s]?ray|mri\s+scan|ct\s+scan)\b/i

/**
 * Classify from imagePrompt + scriptText. Defaults to lifestyle unless
 * clear diagram/scientific keywords are present.
 */
export function classifySceneVisualMode(
  imagePrompt: string,
  scriptText = ''
): SceneVisualMode {
  const haystack = `${imagePrompt}\n${scriptText}`
  return DIAGRAM_SCENE_RE.test(haystack) ? 'diagram' : 'lifestyle'
}

export function sceneVisualConstraint(mode: SceneVisualMode): string {
  return mode === 'diagram' ? DIAGRAM_SCENE_CONSTRAINT : LIFESTYLE_SCENE_CONSTRAINT
}

/** Shorter variant for video motion prompts (avoid diluting motion instructions). */
export function sceneVisualConstraintForVideo(mode: SceneVisualMode): string {
  return mode === 'diagram'
    ? 'Keep a clean scientific visualization only — no people, faces, lifestyle sets, or extra unrelated diagrams.'
    : 'Keep a photorealistic live scene only — no floating medical diagrams, holographic anatomy, HUD panels, or educational chart overlays.'
}

export function appendSceneVisualGuards(
  prompt: string,
  imagePrompt: string,
  scriptText = '',
  opts?: { forVideo?: boolean }
): string {
  const mode = classifySceneVisualMode(imagePrompt, scriptText)
  const constraint = opts?.forVideo
    ? sceneVisualConstraintForVideo(mode)
    : sceneVisualConstraint(mode)
  const base = prompt.trim()
  if (!base) return constraint
  if (base.includes(constraint)) return base
  return `${base}\n\n${constraint}`
}
