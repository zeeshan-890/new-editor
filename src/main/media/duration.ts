/** Parse "Duration: H:MM:SS.xx" from ffmpeg stderr. */
export function parseFfmpegDurationMs(stderr: string): number | null {
  const match = stderr.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/)
  if (!match) return null
  const hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)
  const seconds = parseFloat(match[3])
  if (!Number.isFinite(hours + minutes + seconds)) return null
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000)
}

export function durationMsFromPcmSamples(sampleCount: number, sampleRate: number): number {
  if (sampleCount <= 0 || sampleRate <= 0) return 0
  return Math.round((sampleCount / sampleRate) * 1000)
}
