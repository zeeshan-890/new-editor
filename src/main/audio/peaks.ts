import type { PeakLevel, WaveformPeaks } from '../../shared/types'

export function generatePeaksFromPcm(
  samples: Float32Array,
  bucketSizes: number[]
): WaveformPeaks {
  const levels: PeakLevel[] = bucketSizes.map((samplesPerPeak) => {
    const peakCount = Math.ceil(samples.length / samplesPerPeak)
    const min = new Float32Array(peakCount)
    const max = new Float32Array(peakCount)

    for (let i = 0; i < peakCount; i++) {
      const start = i * samplesPerPeak
      const end = Math.min(start + samplesPerPeak, samples.length)
      let minVal = Infinity
      let maxVal = -Infinity
      for (let j = start; j < end; j++) {
        const v = samples[j]
        if (v < minVal) minVal = v
        if (v > maxVal) maxVal = v
      }
      min[i] = minVal === Infinity ? 0 : minVal
      max[i] = maxVal === -Infinity ? 0 : maxVal
    }

    return { samplesPerPeak, min, max }
  })

  return { levels }
}

export function selectPeakLevel(
  peaks: WaveformPeaks,
  visibleSamples: number,
  widthPx: number
): PeakLevel {
  const samplesPerPixel = visibleSamples / Math.max(widthPx, 1)
  let best = peaks.levels[0]
  for (const level of peaks.levels) {
    if (level.samplesPerPeak <= samplesPerPixel) best = level
  }
  return best
}
