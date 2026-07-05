import { readFileSync } from 'fs'
import { join } from 'path'
import { existsSync } from 'fs'
import { app } from 'electron'
import type { DetectionParams, SilenceRegion } from '../../shared/types'
import { generateId } from '../../shared/types'
import { invertSpeechToSilence } from './traditional'

const VAD_SAMPLE_RATE = 16000
const FRAME_SAMPLES = 512
const FRAME_MS = (FRAME_SAMPLES / VAD_SAMPLE_RATE) * 1000

let session: import('onnxruntime-node').InferenceSession | null = null

async function getSession(): Promise<import('onnxruntime-node').InferenceSession | null> {
  if (session) return session
  try {
    const ort = await import('onnxruntime-node')
    const candidates = [
      join(app.getAppPath(), 'resources', 'models', 'silero_vad.onnx'),
      join(process.resourcesPath, 'models', 'silero_vad.onnx')
    ]
    const modelPath = candidates.find((p) => existsSync(p))
    if (!modelPath) return null
    session = await ort.InferenceSession.create(modelPath)
    return session
  } catch {
    return null
  }
}

function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const outLength = Math.floor(input.length / ratio)
  const output = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const srcIdx = i * ratio
    const idx = Math.floor(srcIdx)
    const frac = srcIdx - idx
    const a = input[idx] ?? 0
    const b = input[idx + 1] ?? a
    output[i] = a + (b - a) * frac
  }
  return output
}

function energyBasedVad(
  samples: Float32Array,
  sampleRate: number,
  sensitivity: number
): Array<{ startMs: number; endMs: number }> {
  const frameSize = Math.floor((FRAME_MS / 1000) * sampleRate)
  const threshold = 0.01 + (1 - sensitivity) * 0.09
  const speech: Array<{ startMs: number; endMs: number }> = []
  let inSpeech = false
  let startMs = 0

  for (let i = 0; i < samples.length; i += frameSize) {
    const end = Math.min(i + frameSize, samples.length)
    let sum = 0
    for (let j = i; j < end; j++) sum += samples[j] * samples[j]
    const rms = Math.sqrt(sum / (end - i))
    const timeMs = (i / sampleRate) * 1000

    if (rms > threshold) {
      if (!inSpeech) {
        inSpeech = true
        startMs = timeMs
      }
    } else if (inSpeech) {
      inSpeech = false
      speech.push({ startMs, endMs: timeMs })
    }
  }

  if (inSpeech) {
    speech.push({ startMs, endMs: (samples.length / sampleRate) * 1000 })
  }

  return speech
}

export async function detectVadSilence(
  pcmPath: string,
  sampleRate: number,
  durationMs: number,
  params: DetectionParams
): Promise<SilenceRegion[]> {
  const buffer = readFileSync(pcmPath)
  const samples = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
  const resampled = resampleLinear(samples, sampleRate, VAD_SAMPLE_RATE)

  let speechRegions: Array<{ startMs: number; endMs: number }> = []

  const ortSession = await getSession()
  if (ortSession) {
    try {
      const ort = await import('onnxruntime-node')
      const probs: number[] = []

      for (let i = 0; i < resampled.length; i += FRAME_SAMPLES) {
        const frame = resampled.slice(i, i + FRAME_SAMPLES)
        if (frame.length < FRAME_SAMPLES) break
        const input = new ort.Tensor('float32', frame, [1, FRAME_SAMPLES])
        const results = await ortSession.run({ input })
        const output = results.output ?? results[Object.keys(results)[0]]
        const data = output.data as Float32Array
        probs.push(data[0] ?? 0)
      }

      let inSpeech = false
      let startFrame = 0
      for (let f = 0; f < probs.length; f++) {
        const isSpeech = probs[f] >= params.vadSensitivity
        const timeMs = f * FRAME_MS
        if (isSpeech && !inSpeech) {
          inSpeech = true
          startFrame = f
        } else if (!isSpeech && inSpeech) {
          inSpeech = false
          speechRegions.push({ startMs: startFrame * FRAME_MS, endMs: timeMs })
        }
      }
      if (inSpeech) {
        speechRegions.push({ startMs: startFrame * FRAME_MS, endMs: durationMs })
      }
    } catch {
      speechRegions = energyBasedVad(resampled, VAD_SAMPLE_RATE, params.vadSensitivity)
    }
  } else {
    speechRegions = energyBasedVad(resampled, VAD_SAMPLE_RATE, params.vadSensitivity)
  }

  speechRegions = speechRegions.filter(
    (s) => s.endMs - s.startMs >= params.minSpeechDurationMs
  )

  return invertSpeechToSilence(
    speechRegions,
    durationMs,
    params.minSilenceDurationMs,
    'vad'
  ).map((r) => ({ ...r, id: generateId() }))
}
