import type { HiggsfieldModel } from './types'
import { DEFAULT_IMAGE_MODEL } from './types'

/** General text-to-image models (not stylist / enhancer variants). */
export const PREFERRED_IMAGE_MODEL_ORDER = [
  'nano_banana_2',
  'nano_banana_flash',
  'flux_2',
  'text2image_soul_v2',
  'gpt_image_2',
  'seedream_v4_5',
  'grok_image'
]

const SPECIALIST_SUFFIXES = ['_ai_stylist', '_skin_enhancer', '_shots', '_lite']

function modelSortRank(id: string): number {
  if (id === DEFAULT_IMAGE_MODEL) return 0
  const preferredIndex = PREFERRED_IMAGE_MODEL_ORDER.indexOf(id)
  if (preferredIndex >= 0) return 10 + preferredIndex
  if (SPECIALIST_SUFFIXES.some((suffix) => id.includes(suffix))) return 1000
  return 500
}

export function sortImageModels<T extends { id: string }>(models: T[]): T[] {
  return [...models].sort((a, b) => {
    const rankDiff = modelSortRank(a.id) - modelSortRank(b.id)
    if (rankDiff !== 0) return rankDiff
    return a.id.localeCompare(b.id)
  })
}

/** True when no model is selected yet. */
export function shouldUseDefaultImageModel(model: string | undefined): boolean {
  return !model
}

/** Older sessions defaulted to these; migrate once to Nano Banana Pro. */
export function isLegacyDefaultImageModel(model: string): boolean {
  return model === 'nano_banana_flash' || model === 'nano_banana'
}

export function pickImageModel(
  current: string | undefined,
  models: Pick<HiggsfieldModel, 'id'>[]
): string {
  const ids = new Set(models.map((m) => m.id))
  // Flash / legacy nano_banana must not stick as the default — prefer Nano Banana Pro.
  if (
    current &&
    !shouldUseDefaultImageModel(current) &&
    !isLegacyDefaultImageModel(current) &&
    ids.has(current)
  ) {
    return current
  }
  if (ids.has(DEFAULT_IMAGE_MODEL)) return DEFAULT_IMAGE_MODEL
  const sorted = sortImageModels(models)
  return sorted[0]?.id ?? DEFAULT_IMAGE_MODEL
}

export function imageModelShortLabel(modelId: string): string {
  if (modelId === 'nano_banana_2') return 'Nano Banana Pro'
  if (modelId === 'nano_banana_flash') return 'Nano Banana 2 (Flash)'
  if (modelId.includes('nano_banana')) return 'Nano Banana'
  if (modelId.includes('kling')) return 'Kling'
  return modelId.length > 14 ? `${modelId.slice(0, 12)}…` : modelId
}
