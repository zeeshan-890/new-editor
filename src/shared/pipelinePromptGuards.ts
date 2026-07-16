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
 * Critical — models otherwise put diagrams ON clinic monitors / in rooms.
 */
export const DIAGRAM_SCENE_CONSTRAINT =
  [
    'Full-bleed isolated medical/scientific diagram ONLY — the anatomical subject fills the frame as the image itself.',
    'NOT a photo of a clinic, office, or room. NOT a diagram displayed on a monitor, TV, screen, tablet, laptop, poster, wall mount, lightbox, or projector.',
    'Do NOT show bezels, screens, stands, desks, dental chairs, equipment, windows, walls, or any environment around the diagram.',
    'Show exactly one focused anatomical or scientific subject as a clear unlabeled 3D medical render or textbook illustration — as if rendered directly, not photographed in a location.',
    'Plain solid empty neutral background (soft white or light gray) behind the subject only — ZERO other visuals.',
    'NO text of any kind: no labels, captions, titles, callouts, arrows with words, watermarks, logos, UI, HUD, charts, or annotations.',
    'NO people, faces, hands, clinicians, patients, silhouettes, or body parts unless that body part IS the single diagram subject.',
    'NO product packaging, bottles, phones, devices, or extra unrelated diagrams.',
    'NO collage, split panels, picture-in-picture, multi-view sheets, or comparison layouts.',
    'Nothing else except the single diagram on empty background — textbook-quality, centered, isolated, unlabeled.'
  ].join(' ')

/** Shorter video variant — keep motion instructions dominant. */
export const DIAGRAM_SCENE_CONSTRAINT_VIDEO =
  'Animate ONLY the single unlabeled medical/scientific diagram filling the frame on an empty plain background. NOT a clinic photo. NOT a diagram on a monitor/TV/screen. NO text, labels, people, props, rooms, furniture, or extra visuals.'

/** Fixed lead-in so image models lock onto clean 3D medical diagram mode first. */
export const MEDICAL_DIAGRAM_PROMPT_PREFIX =
  'Create 3D medical diagram, no text, no label.'

const DIAGRAM_KEYWORD_RE =
  /\b(diagram|schematic|infographic|anatom(y|ical)|cross[-\s]?section|cutaway|molecular|microscop(e|ic)|cellular|histolog|organ\s+(diagram|model|structure)|scientific\s+(visualization|illustration|animation|render)|medical\s+(illustration|animation|diagram|graphic|render|visualization)|3d\s+(medical|anatom|organ|cell|tooth|dental)|educational\s+(graphic|animation|diagram)|hud\s+(overlay|panel)|holographic\s+(diagram|anatomy|organ|chart)|x[-\s]?ray|mri\s*(scan|image)?|ct\s*(scan|image)?|ultrasound\s+(image|scan)|patholog(y|ical)|physiology|neuron|synapse|tissue\s+section|tooth|teeth|molar|incisor|premolar|canine\s+tooth|enamel|dentin|dentine|pulp\s*(cavity|chamber|canal)?|root\s*canal|dental\s+(anatomy|diagram|illustration|cross|structure)|gum\s+tissue|gingiva|jawbone|alveolar|periodontal|hydroxyapatite|mineral\s+(loss|replacement)|bone\s+(density|mineral)|kidney|liver|heart|brain|lung|stomach|intestine|cell\s+membrane)\b/i

/** Lifestyle / environment words that must never remain in a diagram subject. */
const DIAGRAM_LIFESTYLE_NOISE_RE =
  /\b(clinic|office|operatory|practice|hospital|waiting\s+room|exam\s+room|treatment\s+room|dental\s+chair|patient\s+chair|dentist|doctor|physician|hygienist|nurse|patient|woman|man|person|people|face|faces|hands?|monitor|screen|tv|television|display|tablet|laptop|ipad|bezel|projector|lightbox|poster|wall|walls|window|windows|desk|furniture|room|rooms|interior|set\s+dressing|packaging|bottle|product|phone|hud|ui|label|labels|caption|captions|watermark|logo|photorealistic\s+scene|cinematic\s+frame|lifestyle|photograph\s+of|photo\s+of|picture\s+of)\b/gi

const DIAGRAM_ENVIRONMENT_PHRASE_RE =
  /\b(on\s+(a\s+)?(monitor|screen|tv|television|display|tablet|laptop|ipad|wall)|displayed\s+on|shown\s+on|hanging\s+on|mounted\s+on|in\s+(a\s+)?(dental\s+)?(clinic|office|operatory|treatment\s+room|exam\s+room|practice)|behind\s+the\s+chair|flat[-\s]?screen|lcd|led\s+screen|projector|poster\s+on\s+wall)\b/gi

const ANATOMY_SUBJECT_RE =
  /\b((?:human\s+|adult\s+|healthy\s+|damaged\s+|decayed\s+|cross[-\s]?section\s+(?:of\s+(?:a\s+)?)?)?(?:tooth|teeth|molar|incisor|premolar|enamel|dentin|dentine|pulp(?:\s+(?:cavity|chamber|canal))?|root\s*canal|gingiva|gum(?:s|\s+tissue)?|jawbone|alveolar\s+bone|periodontal\s+ligament|nano[-\s]?hydroxyapatite|hydroxyapatite|kidney|liver|heart|brain|lung|stomach|neuron|cell|organ)(?:\s+(?:cross[-\s]?section|cutaway|anatomy|structure|diagram|model|with\s+[^.,;]{0,80}))?)/i

/**
 * Classify from imagePrompt + scriptText. Defaults to lifestyle unless
 * clear diagram/scientific/anatomical keywords are present.
 */
export function classifySceneVisualMode(
  imagePrompt: string,
  scriptText = ''
): SceneVisualMode {
  const haystack = `${imagePrompt}\n${scriptText}`
  if (DIAGRAM_KEYWORD_RE.test(haystack)) return 'diagram'
  // "diagram on a clinic monitor" lifestyle prompts should still take the diagram path
  if (
    /\b(monitor|screen|tv|display)\b/i.test(haystack) &&
    /\b(tooth|teeth|anatom|organ|medical|dental|diagram)\b/i.test(haystack)
  ) {
    return 'diagram'
  }
  return 'lifestyle'
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

function collapseWhitespace(text: string): string {
  return text.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim()
}

/** Remove clinic/monitor/people framing from subject text. */
export function sanitizeDiagramSubjectPrompt(subjectPrompt: string): string {
  let cleaned = subjectPrompt.trim()
  if (!cleaned) return cleaned
  cleaned = cleaned.replace(DIAGRAM_ENVIRONMENT_PHRASE_RE, ' ')
  cleaned = cleaned.replace(DIAGRAM_LIFESTYLE_NOISE_RE, ' ')
  cleaned = cleaned.replace(
    /\b(photo\s+of|photograph\s+of|picture\s+of|shot\s+of)\s+(a\s+)?(monitor|screen|tv|display)\b[^.]*\.?/gi,
    ' '
  )
  cleaned = cleaned.replace(/\b(Create\s+3D\s+medical\s+diagram,?\s*no\s+text,?\s*no\s+label\.?\s*)+/gi, '')
  return collapseWhitespace(cleaned)
}

function stillLooksLikeLifestyleScene(text: string): boolean {
  return /\b(clinic|office|patient|dentist|doctor|monitor|screen|tv|chair|room|woman|man|photograph|photorealistic scene)\b/i.test(
    text
  )
}

/**
 * Rebuild a clean anatomy-only subject. Lifestyle "clinic monitor" prompts
 * are reduced to the anatomical content so the model cannot re-draw the room.
 */
export function extractDiagramSubject(imagePrompt: string, scriptText = ''): string {
  const combined = `${imagePrompt}\n${scriptText}`.trim()
  const sanitized = sanitizeDiagramSubjectPrompt(combined)

  const anatomyFromPrompt = imagePrompt.match(ANATOMY_SUBJECT_RE)?.[1]
  const anatomyFromScript = scriptText.match(ANATOMY_SUBJECT_RE)?.[1]
  const anatomy = collapseWhitespace(anatomyFromPrompt || anatomyFromScript || '')

  if (anatomy && (stillLooksLikeLifestyleScene(sanitized) || sanitized.length < 12)) {
    return `unlabeled 3D anatomical ${anatomy}, accurate medical education render, cross-section if relevant, isolated subject only`
  }

  if (sanitized && !stillLooksLikeLifestyleScene(sanitized) && sanitized.length >= 12) {
    return sanitized.slice(0, 320)
  }

  if (anatomy) {
    return `unlabeled 3D anatomical ${anatomy}, accurate medical education render, isolated subject only`
  }

  if (/\b(teeth|tooth|dental|enamel|dentin|gum|mineral)\b/i.test(combined)) {
    return 'unlabeled 3D anatomical cross-section of a human tooth showing enamel, dentin, and pulp chamber, accurate medical education render, isolated subject only'
  }

  return 'unlabeled 3D anatomical medical diagram subject, accurate education render, isolated on plain background'
}

/**
 * Build the final generation prompt for medical/scientific diagram segments.
 * Strips lifestyle framing so models don't invent rooms, people, screens, or text.
 */
export function buildMedicalDiagramImagePrompt(
  subjectPrompt: string,
  scriptText = ''
): string {
  const subject = extractDiagramSubject(subjectPrompt, scriptText)
  return [
    MEDICAL_DIAGRAM_PROMPT_PREFIX,
    'Direct full-frame 3D medical education render — the anatomical diagram IS the entire image.',
    'CRITICAL: Do NOT generate a dental clinic, office, room, chair, equipment, wall, or any environment.',
    'CRITICAL: Do NOT generate a monitor, TV, screen, tablet, or display showing the diagram.',
    'CRITICAL: Do NOT generate people, dentists, patients, hands, or faces.',
    `Subject (ONLY visual allowed — fill the frame with this anatomy): ${subject}`,
    'Render as a single clean unlabeled 3D anatomical model of ONLY that subject, centered on a plain solid light-gray or white background.',
    'Camera looks straight at the diagram subject itself — not at a display showing it.',
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
    /Clean scientific\/medical visualization only|Clean medical\/scientific diagram ONLY|Full-bleed isolated medical/i.test(
      base
    ) &&
    constraint === DIAGRAM_SCENE_CONSTRAINT
  ) {
    return `${base
      .replace(/Clean scientific\/medical visualization only[^\n]*/gi, '')
      .replace(/Clean medical\/scientific diagram ONLY[^\n]*/gi, '')
      .replace(/Full-bleed isolated medical[^\n]*/gi, '')
      .trim()}\n\n${constraint}`
  }
  return `${base}\n\n${constraint}`
}
