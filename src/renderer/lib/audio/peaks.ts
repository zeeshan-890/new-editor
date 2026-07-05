export function selectPeakLevel(
  levels: Array<{ samplesPerPeak: number; min: Float32Array; max: Float32Array }>,
  visibleSamples: number,
  widthPx: number
): { samplesPerPeak: number; min: Float32Array; max: Float32Array } {
  const samplesPerPixel = visibleSamples / Math.max(widthPx, 1)
  let best = levels[0]
  for (const level of levels) {
    if (level.samplesPerPeak <= samplesPerPixel) best = level
  }
  return best
}
