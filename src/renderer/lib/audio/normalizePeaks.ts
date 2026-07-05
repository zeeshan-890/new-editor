import type { WaveformPeaks } from '@shared/types'

function toFloat32Array(data: Float32Array | number[]): Float32Array {
  if (data instanceof Float32Array) return data
  return new Float32Array(data)
}

export function normalizePeaks(peaks: WaveformPeaks): WaveformPeaks {
  return {
    levels: peaks.levels.map((level) => ({
      samplesPerPeak: level.samplesPerPeak,
      min: toFloat32Array(level.min as Float32Array | number[]),
      max: toFloat32Array(level.max as Float32Array | number[])
    }))
  }
}
