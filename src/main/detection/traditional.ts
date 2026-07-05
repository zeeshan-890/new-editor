import { readFileSync } from 'fs'
import type { DetectionParams, SilenceRegion } from '../../shared/types'
import { generateId } from '../../shared/types'

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20)
}

function rmsToDb(rms: number): number {
  if (rms <= 0) return -120
  return 20 * Math.log10(rms)
}

function simpleHighPass(samples: Float32Array, sampleRate: number, cutoffHz: number): Float32Array {
  if (cutoffHz <= 0) return samples
  const rc = 1 / (2 * Math.PI * cutoffHz)
  const dt = 1 / sampleRate
  const alpha = rc / (rc + dt)
  const out = new Float32Array(samples.length)
  out[0] = samples[0]
  for (let i = 1; i < samples.length; i++) {
    out[i] = alpha * (out[i - 1] + samples[i] - samples[i - 1])
  }
  return out
}

function simpleLowPass(samples: Float32Array, sampleRate: number, cutoffHz: number): Float32Array {
  if (cutoffHz >= sampleRate / 2) return samples
  const rc = 1 / (2 * Math.PI * cutoffHz)
  const dt = 1 / sampleRate
  const alpha = dt / (rc + dt)
  const out = new Float32Array(samples.length)
  out[0] = samples[0]
  for (let i = 1; i < samples.length; i++) {
    out[i] = out[i - 1] + alpha * (samples[i] - out[i - 1])
  }
  return out
}

export function detectTraditionalSilence(
  pcmPath: string,
  sampleRate: number,
  durationMs: number,
  params: DetectionParams
): SilenceRegion[] {
  const buffer = readFileSync(pcmPath)
  let samples = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)

  samples = simpleHighPass(samples, sampleRate, params.highPassHz)
  samples = simpleLowPass(samples, sampleRate, params.lowPassHz)

  const windowSamples = Math.max(1, Math.floor((params.windowSizeMs / 1000) * sampleRate))
  const thresholdLinear = dbToLinear(params.thresholdDb)
  const attackSamples = Math.floor((params.attackMs / 1000) * sampleRate)
  const releaseSamples = Math.floor((params.releaseMs / 1000) * sampleRate)

  const silentFlags: boolean[] = []
  for (let i = 0; i < samples.length; i += windowSamples) {
    const end = Math.min(i + windowSamples, samples.length)
    let sum = 0
    for (let j = i; j < end; j++) {
      sum += samples[j] * samples[j]
    }
    const rms = Math.sqrt(sum / (end - i))
    silentFlags.push(rms < thresholdLinear)
  }

  let isSilent = false
  let silentRun = 0
  let speechRun = 0
  const hysteresisFlags: boolean[] = []

  for (const flag of silentFlags) {
    if (flag) {
      silentRun++
      speechRun = 0
      if (!isSilent && silentRun * windowSamples >= attackSamples) {
        isSilent = true
      }
    } else {
      speechRun++
      silentRun = 0
      if (isSilent && speechRun * windowSamples >= releaseSamples) {
        isSilent = false
      }
    }
    hysteresisFlags.push(isSilent)
  }

  const regions: SilenceRegion[] = []
  let regionStart: number | null = null

  for (let i = 0; i < hysteresisFlags.length; i++) {
    const startMs = ((i * windowSamples) / sampleRate) * 1000
    const endMs = Math.min(((i + 1) * windowSamples) / sampleRate * 1000, durationMs)

    if (hysteresisFlags[i]) {
      if (regionStart === null) regionStart = startMs
    } else if (regionStart !== null) {
      const regionEndMs = startMs
      const duration = regionEndMs - regionStart
      if (duration >= params.minSilenceDurationMs) {
        regions.push({
          id: generateId(),
          startMs: regionStart,
          endMs: regionEndMs,
          confidence: 0.8,
          source: 'traditional',
          removed: false
        })
      }
      regionStart = null
    }
  }

  if (regionStart !== null) {
    const endMs = durationMs
    if (endMs - regionStart >= params.minSilenceDurationMs) {
      regions.push({
        id: generateId(),
        startMs: regionStart,
        endMs,
        confidence: 0.8,
        source: 'traditional',
        removed: false
      })
    }
  }

  return regions
}

export function invertSpeechToSilence(
  speechRegions: Array<{ startMs: number; endMs: number }>,
  durationMs: number,
  minSilenceDurationMs: number,
  source: SilenceRegion['source']
): SilenceRegion[] {
  const sorted = [...speechRegions].sort((a, b) => a.startMs - b.startMs)
  const silence: SilenceRegion[] = []
  let cursor = 0

  for (const speech of sorted) {
    if (speech.startMs > cursor) {
      const dur = speech.startMs - cursor
      if (dur >= minSilenceDurationMs) {
        silence.push({
          id: generateId(),
          startMs: cursor,
          endMs: speech.startMs,
          confidence: 0.85,
          source,
          removed: false
        })
      }
    }
    cursor = Math.max(cursor, speech.endMs)
  }

  if (cursor < durationMs) {
    const dur = durationMs - cursor
    if (dur >= minSilenceDurationMs) {
      silence.push({
        id: generateId(),
        startMs: cursor,
        endMs: durationMs,
        confidence: 0.85,
        source,
        removed: false
      })
    }
  }

  return silence
}
