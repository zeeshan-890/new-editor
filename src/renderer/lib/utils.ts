export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

export function formatTime(ms: number, showMs = true): string {
  const totalSeconds = Math.max(0, ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = Math.floor(totalSeconds % 60)
  const millis = Math.floor(ms % 1000)

  const pad = (n: number, len = 2): string => String(n).padStart(len, '0')

  if (hours > 0) {
    return showMs
      ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`
      : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
  }

  return showMs
    ? `${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`
    : `${pad(minutes)}:${pad(seconds)}`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
