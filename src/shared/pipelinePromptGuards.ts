/**
 * Hardcoded prompt constraints so image/video models don't mix
 * lifestyle product scenes with floating medical HUDs (or vice versa).
 */

export type SceneVisualMode = 'lifestyle' | 'diagram'

/** Lifestyle / live-action: forbid floating medical overlays. */
export const LIFESTYLE_SCENE_CONSTRAINT =
  'Photorealistic/live scene only. NO floating medical diagrams, NO holographic anatomy overlays, NO UI HUD panels, NO educational charts in the background, NO translucent body organ graphics, NO X-ray/CT overlays, NO warning icons floating in air, NO educational infographic layers.'

/**
 * Diagram / scientific / medical: isolated clean diagram only.
 * Critical for medical education stills — models otherwise add labels, HUDs, and set dressing.
 */
export const DIAGRAM_SCENE_CONSTRAINT =
  [
    'Clean medical/scientific diagram ONLY — the diagram subject is the sole visual in the entire frame.',
    'Show exactly one focused anatomical or scientific subject as a clear unlabeled diagram or 3D medical visualization.',
    'Plain solid empty neutral background (soft white or light gray) with ZERO other visuals: no secondary objects, props, icons, charts, insets, floating graphics, shadows of other items, or decorative elements.',
    'NO text of any kind: no labels, captions, titles, callouts, arrows with words, watermarks, logos, UI, HUD, charts, or annotations.',
    'NO people, faces, hands, clinicians, patients, silhouettes, or body parts unless that body part IS the single diagram subject.',
    'NO lifestyle or environment: no rooms, furniture, clinics, bathrooms, kitchens, tables, walls, windows, or set dressing.',
    'NO product packaging, bottles, phones, devices, or extra unrelated diagrams.',
    'NO collage, split panels, picture-in-picture, multi-view sheets, or comparison layouts.',
    'Nothing else except the single diagram on empty background — textbook-quality, centered, isolated, unlabeled.'
  ].join(' ')

/** Shorter video variant — keep motion instructions dominant. */
export const DIAGRAM_SCENE_CONSTRAINT_VIDEO =
  'Animate ONLY the single unlabeled medical/scientific diagram on an empty plain neutral background. NO other visuals: no text, labels, people, props, rooms, HUD, insets, or extra diagrams.'

const DIAGRAM_SCENE_RE =
  /\b(diagram|schematic|infographic|anatom(y|ical)|cross[-\s]?section|cutaway|molecular|microscop(e|ic)|cellular|histolog|organ\s+(diagram|model|structure)|scientific\s+(visualization|illustration|animation|render)|medical\s+(illustration|animation|diagram|graphic|render|visualization)|3d\s+(medical|anatom|organ|cell)|educational\s+(graphic|animation|diagram)|hud\s+(overlay|panel)|holographic\s+(diagram|anatomy|organ|chart)|x[-\s]?ray|mri\s*(scan|image)?|ct\s*(scan|image)?|ultrasound\s+(image|scan)|patholog(y|ical)|physiology|neuron|synapse|tissue\s+section)\b/i

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
    ? DIAGRAM_SCENE_CONSTRAINT_VIDEO
    : 'Keep a photorealistic live scene only — no floating medical diagrams, holographic anatomy, HUD panels, or educational chart overlays.'
}

/**
 * Build the final generation prompt for medical/scientific diagram segments.
 * Strips lifestyle framing so models don't invent rooms, people, or text.
 */
export function buildMedicalDiagramImagePrompt(subjectPrompt: string): string {
  const subject = subjectPrompt.trim() || 'Focused anatomical medical diagram subject'
  return [
    'Professional medical education diagram / anatomical visualization.',
    `Subject (ONLY visual allowed): ${subject}`,
    'Render as a single clean unlabeled diagram or photoreal 3D anatomical model of ONLY that subject.',
    'Frame contains nothing except that one diagram on an empty plain background — no other visuals of any kind.',
    DIAGRAM_SCENE_CONSTRAINT
  ].join('\n\n')
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
  // Avoid stacking an older shorter diagram constraint with the new one.
  if (
    mode === 'diagram' &&
    /Clean scientific\/medical visualization only/i.test(base) &&
    constraint === DIAGRAM_SCENE_CONSTRAINT
  ) {
    return `${base.replace(/Clean scientific\/medical visualization only[^\n]*/gi, '').trim()}\n\n${constraint}`
  }
  return `${base}\n\n${constraint}`
}
