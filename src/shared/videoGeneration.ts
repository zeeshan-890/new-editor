/** When false, passes model-specific CLI flags to disable generated video audio. */
export const DEFAULT_VIDEO_SOUND_ENABLED = false

/**
 * Append Higgsfield video params to disable built-in audio generation.
 * - Kling: --sound off
 * - Seedance: --generate_audio false
 */
export function applyVideoSoundParams(
  model: string,
  params: Record<string, string | number | boolean>,
  soundEnabled: boolean = DEFAULT_VIDEO_SOUND_ENABLED
): Record<string, string | number | boolean> {
  if (soundEnabled) return params

  const next = { ...params }
  const id = model.toLowerCase()

  if (id.startsWith('kling')) {
    next.sound = 'off'
  } else if (id.startsWith('seedance')) {
    next.generate_audio = 'false'
  }

  return next
}
