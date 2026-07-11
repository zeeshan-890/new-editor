export interface ParsedClip {
  index: number
  description: string
}

export interface ParsedScene {
  sceneNumber: number
  voText: string
  clips: ParsedClip[]
}

/** Detects scripts laid out as Scene N / VO: / Clip N blocks. */
export function isStructuredSceneScript(script: string): boolean {
  const text = script.trim()
  if (!text) return false
  const sceneHits = text.match(/^\s*Scene\s+\d+/gim) ?? []
  const voHits = text.match(/^\s*VO\s*:/gim) ?? []
  return sceneHits.length >= 2 && voHits.length >= 2
}

function cleanVoText(raw: string): string {
  let text = raw.trim()
  text = text.replace(/^VO\s*:\s*/i, '').trim()
  // Strip wrapping quotes if the whole line is quoted.
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith('\u201C') && text.endsWith('\u201D')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim()
  }
  return text.replace(/\s+/g, ' ').trim()
}

function cleanClipDescription(raw: string): string {
  return raw
    .replace(/^\s*Clip\s+\d+\s*:?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parse Scene / VO / Clip structured scripts into one scene per segment.
 * VO → narration scriptText; Clips → visual descriptions for prompts.
 */
export function parseStructuredSceneScript(script: string): ParsedScene[] | null {
  if (!isStructuredSceneScript(script)) return null

  const lines = script.replace(/\r\n/g, '\n').split('\n')
  const scenes: ParsedScene[] = []

  let current: ParsedScene | null = null
  let mode: 'none' | 'vo' | 'clip' = 'none'
  let clipBuffer: string[] = []
  let clipIndex = 0

  const flushClip = (): void => {
    if (!current || mode !== 'clip') return
    const description = cleanClipDescription(clipBuffer.join(' '))
    if (description) {
      current.clips.push({ index: clipIndex, description })
    }
    clipBuffer = []
  }

  const flushScene = (): void => {
    flushClip()
    if (!current) return
    current.voText = cleanVoText(current.voText)
    if (current.voText) {
      scenes.push(current)
    }
    current = null
    mode = 'none'
    clipBuffer = []
    clipIndex = 0
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const sceneMatch = line.match(/^Scene\s+(\d+)\s*$/i)
    if (sceneMatch) {
      flushScene()
      current = {
        sceneNumber: Number(sceneMatch[1]),
        voText: '',
        clips: []
      }
      mode = 'none'
      continue
    }

    if (!current) continue

    const voMatch = line.match(/^VO\s*:\s*(.*)$/i)
    if (voMatch) {
      flushClip()
      mode = 'vo'
      current.voText = voMatch[1] ?? ''
      continue
    }

    const clipMatch = line.match(/^Clip\s+(\d+)\s*:?\s*(.*)$/i)
    if (clipMatch) {
      flushClip()
      mode = 'clip'
      clipIndex = Number(clipMatch[1])
      clipBuffer = clipMatch[2] ? [clipMatch[2]] : []
      continue
    }

    if (mode === 'vo') {
      current.voText = `${current.voText} ${line}`.trim()
    } else if (mode === 'clip') {
      clipBuffer.push(line)
    }
  }

  flushScene()
  return scenes.length > 0 ? scenes : null
}

export function narrationScriptFromScenes(scenes: ParsedScene[]): string {
  return scenes.map((scene) => scene.voText).join(' ')
}

export function formatScenesForLlm(scenes: ParsedScene[]): string {
  return scenes
    .map((scene, index) => {
      const clips =
        scene.clips.length > 0
          ? scene.clips.map((c) => `  Clip ${c.index}: ${c.description}`).join('\n')
          : '  Clip 1: (derive a single cinematic still from the VO)'
      return [
        `Scene ${scene.sceneNumber} (segment index ${index})`,
        `VO (scriptText — copy EXACTLY, do not change): ${scene.voText}`,
        'Visual clips (use these to write imagePrompt + videoMotionPrompt):',
        clips
      ].join('\n')
    })
    .join('\n\n')
}
