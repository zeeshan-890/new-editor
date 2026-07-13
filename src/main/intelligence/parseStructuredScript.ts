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

export interface ParsedSegmentBlock {
  segmentNumber: number
  scriptText: string
  imagePrompt: string
}

const SEGMENT_HEADER_RE = /^\s*Segment\s+\d+/gim
const SCRIPT_LABEL_RE = /^\s*Script\s*:?/gim
const V0_PROMPT_LABEL_RE = /^\s*(?:V0|VO)\s+Prompt\s*:?/gim

/** Detects scripts laid out as Segment N / Script / V0 Prompt (or VO Prompt) blocks. */
export function isStructuredSegmentScript(script: string): boolean {
  const text = script.trim()
  if (!text) return false
  const segmentHits = text.match(SEGMENT_HEADER_RE) ?? []
  const scriptHits = text.match(SCRIPT_LABEL_RE) ?? []
  const promptHits = text.match(V0_PROMPT_LABEL_RE) ?? []
  return segmentHits.length >= 2 && scriptHits.length >= 2 && promptHits.length >= 2
}

function cleanSegmentScriptText(raw: string): string {
  let text = raw.trim()
  text = text.replace(/^Script\s*:?\s*/i, '').trim()
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith('\u201C') && text.endsWith('\u201D')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim()
  }
  return text.replace(/\s+/g, ' ').trim()
}

function cleanV0PromptText(raw: string): string {
  return raw
    .replace(/^(?:V0|VO)\s+Prompt\s*:?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parse Segment / Script / V0 Prompt structured scripts into one block per segment.
 * Script → narration scriptText; V0/VO Prompt → imagePrompt.
 */
export function parseStructuredSegmentScript(script: string): ParsedSegmentBlock[] | null {
  if (!isStructuredSegmentScript(script)) return null

  const lines = script.replace(/\r\n/g, '\n').split('\n')
  const blocks: ParsedSegmentBlock[] = []

  let current: ParsedSegmentBlock | null = null
  let mode: 'none' | 'script' | 'prompt' = 'none'
  let scriptBuffer: string[] = []
  let promptBuffer: string[] = []

  const flushBlock = (): void => {
    if (!current) return
    current.scriptText = cleanSegmentScriptText(scriptBuffer.join(' '))
    current.imagePrompt = cleanV0PromptText(promptBuffer.join(' '))
    if (current.scriptText) {
      blocks.push(current)
    }
    current = null
    mode = 'none'
    scriptBuffer = []
    promptBuffer = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const segmentMatch = line.match(/^Segment\s+(\d+)\s*$/i)
    if (segmentMatch) {
      flushBlock()
      current = {
        segmentNumber: Number(segmentMatch[1]),
        scriptText: '',
        imagePrompt: ''
      }
      mode = 'none'
      scriptBuffer = []
      promptBuffer = []
      continue
    }

    if (!current) continue

    const scriptMatch = line.match(/^Script\s*:?\s*(.*)$/i)
    if (scriptMatch) {
      mode = 'script'
      const inline = (scriptMatch[1] ?? '').trim()
      scriptBuffer = inline ? [inline] : []
      continue
    }

    const promptMatch = line.match(/^(?:V0|VO)\s+Prompt\s*:?\s*(.*)$/i)
    if (promptMatch) {
      mode = 'prompt'
      const inline = (promptMatch[1] ?? '').trim()
      promptBuffer = inline ? [inline] : []
      continue
    }

    if (mode === 'script') {
      scriptBuffer.push(line)
    } else if (mode === 'prompt') {
      promptBuffer.push(line)
    }
  }

  flushBlock()
  return blocks.length > 0 ? blocks : null
}

export function narrationScriptFromSegmentBlocks(blocks: ParsedSegmentBlock[]): string {
  return blocks.map((block) => block.scriptText).join(' ')
}

export function formatSegmentBlocksForLlm(blocks: ParsedSegmentBlock[]): string {
  return blocks
    .map((block, index) =>
      [
        `Segment ${block.segmentNumber} (segment index ${index})`,
        `Script (scriptText — copy EXACTLY, do not change): ${block.scriptText}`,
        `V0 Prompt (imagePrompt — copy EXACTLY, do not change): ${block.imagePrompt}`,
        'Write videoMotionPrompt from the V0 Prompt (concrete subject + camera motion).'
      ].join('\n')
    )
    .join('\n\n')
}
