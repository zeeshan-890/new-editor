import type {
  HiggsfieldAccountStatus,
  HiggsfieldGenerateRequest,
  HiggsfieldGenerateResult,
  HiggsfieldModel,
  HiggsfieldModelCategory,
  HiggsfieldModelParam,
  HiggsfieldModelSchema,
  HiggsfieldVoice,
  HiggsfieldWorkspace
} from '../../shared/types'
import {
  downloadFirstAudio,
  downloadMedia,
  extractResultUrls,
  pickPrimaryResultUrl,
  HiggsfieldCliError,
  isAuthenticated,
  getResolvedCliPath,
  resetCliCache,
  runHiggsfield,
  runHiggsfieldJson,
  startHiggsfieldLogin,
  uploadLocalMedia
} from './cli'
import { logError, logInfo, logWarn } from '../logger'

const FALLBACK_AUDIO_MODELS: HiggsfieldModel[] = [
  { id: 'text2speech_v2', name: 'Text to Speech', category: 'audio' },
  { id: 'mirelo_text_to_audio', name: 'Mirelo Text to Audio', category: 'audio' },
  { id: 'sonilo_music', name: 'Sonilo Music', category: 'audio' }
]

const FALLBACK_IMAGE_MODELS: HiggsfieldModel[] = [
  { id: 'nano_banana_2', name: 'Nano Banana Pro — Text to Image', category: 'image' },
  { id: 'nano_banana_flash', name: 'Nano Banana 2 — Text to Image', category: 'image' },
  { id: 'flux_2', name: 'FLUX.2', category: 'image' },
  { id: 'text2image_soul_v2', name: 'Higgsfield Soul V2', category: 'image' },
  { id: 'gpt_image_2', name: 'GPT Image 2', category: 'image' }
]

const FALLBACK_VIDEO_MODELS: HiggsfieldModel[] = [
  { id: 'veo3_1', name: 'Google Veo 3.1', category: 'video' },
  { id: 'kling3_0', name: 'Kling v3.0', category: 'video' },
  { id: 'seedance_2_0', name: 'Seedance 2.0', category: 'video' }
]

function titleCaseWords(text: string): string {
  return text
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

const NANO_BANANA_LABELS: Record<string, string> = {
  nano_banana: 'Nano Banana',
  nano_banana_flash: 'Nano Banana 2 — Text to Image',
  nano_banana_2_lite: 'Nano Banana 2 Lite',
  nano_banana_2: 'Nano Banana Pro — Text to Image',
  nano_banana_2_ai_stylist: 'Nano Banana Pro — AI Stylist',
  nano_banana_2_skin_enhancer: 'Nano Banana Pro — Skin Enhancer',
  nano_banana_2_shots: 'Nano Banana Pro — Shots'
}

function formatModelLabel(id: string, displayName: string): string {
  const nanoLabel = NANO_BANANA_LABELS[id]
  if (nanoLabel) return `${nanoLabel} (${id})`

  if (id.startsWith('nano_banana_2_') && id !== 'nano_banana_2') {
    return `Nano Banana Pro — ${titleCaseWords(id.slice('nano_banana_2_'.length))} (${id})`
  }
  if (id.startsWith('nano_banana_flash_') && id !== 'nano_banana_flash') {
    return `Nano Banana 2 — ${titleCaseWords(id.slice('nano_banana_flash_'.length))} (${id})`
  }
  if (id.startsWith('nano_banana_')) {
    return `${displayName} (${id})`
  }
  return displayName
}

function normalizeModels(raw: unknown, category: HiggsfieldModel['category']): HiggsfieldModel[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const obj = item as Record<string, unknown>
      const id = String(obj.job_set_type ?? obj.job_type ?? obj.id ?? '')
      const displayName = String(obj.display_name ?? obj.name ?? obj.title ?? id)
      if (!id) return null
      return { id, name: formatModelLabel(id, displayName), category }
    })
    .filter((item): item is HiggsfieldModel => item !== null)
}

function normalizeWorkspace(raw: unknown): HiggsfieldWorkspace | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const id = String(obj.id ?? '')
  if (!id) return null
  const name = obj.name ? String(obj.name) : 'Personal workspace'
  return {
    id,
    name,
    planType: String(obj.plan_type ?? ''),
    credits: Number(obj.credits ?? 0),
    isSelected: Boolean(obj.is_selected),
    userRole: String(obj.user_role ?? '')
  }
}

function pickPreferredWorkspace(workspaces: HiggsfieldWorkspace[]): HiggsfieldWorkspace {
  const ledisa = workspaces.find((ws) => ws.name.toLowerCase().includes('ledisa'))
  if (ledisa) return ledisa
  return workspaces.reduce((best, current) => (current.credits > best.credits ? current : best))
}

export async function listHiggsfieldWorkspaces(): Promise<HiggsfieldWorkspace[]> {
  try {
    const raw = await runHiggsfieldJson<unknown>(['workspace', 'list'], 30_000)
    const items = Array.isArray(raw) ? raw : []
    return items
      .map(normalizeWorkspace)
      .filter((item): item is HiggsfieldWorkspace => item !== null)
  } catch (err) {
    logError('higgsfield:workspaces', err)
    throw err
  }
}

export async function getSelectedHiggsfieldWorkspace(): Promise<HiggsfieldWorkspace | null> {
  try {
    const raw = await runHiggsfieldJson<unknown>(['workspace', 'status'], 15_000)
    return normalizeWorkspace(raw)
  } catch (err) {
    if (err instanceof HiggsfieldCliError && err.message.toLowerCase().includes('no workspace selected')) {
      return null
    }
    return null
  }
}

export async function setHiggsfieldWorkspace(workspaceId: string): Promise<HiggsfieldWorkspace | null> {
  await runHiggsfield(['workspace', 'set', workspaceId], 15_000)
  return getSelectedHiggsfieldWorkspace()
}

export async function ensureHiggsfieldWorkspace(workspaceId?: string): Promise<HiggsfieldWorkspace> {
  if (workspaceId) {
    const selected = await setHiggsfieldWorkspace(workspaceId)
    if (selected) return selected
  }

  const current = await getSelectedHiggsfieldWorkspace()
  if (current) return current

  const workspaces = await listHiggsfieldWorkspaces()
  if (workspaces.length === 0) {
    throw new HiggsfieldCliError('No Higgsfield workspaces found on your account.')
  }

  const fallback = pickPreferredWorkspace(workspaces)
  const selected = await setHiggsfieldWorkspace(fallback.id)
  return selected ?? { ...fallback, isSelected: true }
}

export async function getHiggsfieldStatus(): Promise<{
  cliAvailable: boolean
  authenticated: boolean
  account: HiggsfieldAccountStatus | null
  cliPath?: string
  statusMessage?: string
  workspaces?: HiggsfieldWorkspace[]
  selectedWorkspace?: HiggsfieldWorkspace | null
}> {
  resetCliCache()

  let cliPath: string
  try {
    cliPath = getResolvedCliPath()
  } catch (err) {
    return {
      cliAvailable: false,
      authenticated: false,
      account: null,
      statusMessage: err instanceof HiggsfieldCliError ? err.message : String(err)
    }
  }

  const authenticated = await isAuthenticated()
  if (!authenticated) {
    return {
      cliAvailable: true,
      authenticated: false,
      account: null,
      cliPath,
      statusMessage: 'CLI ready — sign in to generate content.'
    }
  }

  let workspaces: HiggsfieldWorkspace[] = []
  try {
    workspaces = await listHiggsfieldWorkspaces()
  } catch (err) {
    logError('higgsfield:status', err, { step: 'listWorkspaces' })
    workspaces = []
  }

  let selectedWorkspace = await getSelectedHiggsfieldWorkspace()
  if (!selectedWorkspace && workspaces.length > 0) {
    const preferred = pickPreferredWorkspace(workspaces)
    selectedWorkspace = (await setHiggsfieldWorkspace(preferred.id)) ?? preferred
  } else if (selectedWorkspace && selectedWorkspace.credits <= 0 && workspaces.length > 0) {
    const preferred = pickPreferredWorkspace(workspaces)
    if (preferred.id !== selectedWorkspace.id && preferred.credits > 0) {
      selectedWorkspace = (await setHiggsfieldWorkspace(preferred.id)) ?? preferred
    }
  }

  try {
    const account = await runHiggsfieldJson<HiggsfieldAccountStatus>(['account', 'status'], 20_000)
    return {
      cliAvailable: true,
      authenticated: true,
      account,
      cliPath,
      workspaces,
      selectedWorkspace
    }
  } catch {
    return {
      cliAvailable: true,
      authenticated: true,
      account: null,
      cliPath,
      workspaces,
      selectedWorkspace,
      statusMessage: selectedWorkspace
        ? undefined
        : workspaces.length > 0
          ? 'Select a workspace before generating.'
          : 'Could not load workspaces. Click Refresh.'
    }
  }
}

export function loginHiggsfield(): void {
  startHiggsfieldLogin()
}

export async function listHiggsfieldModels(
  category: 'audio' | 'image' | 'video'
): Promise<HiggsfieldModel[]> {
  const flag = category === 'audio' ? '--audio' : category === 'video' ? '--video' : '--image'

  try {
    const raw = await runHiggsfieldJson<unknown>(['model', 'list', flag], 30_000)
    const models = normalizeModels(raw, category)
    if (models.length > 0) return models
  } catch {
    // fall through to defaults
  }

  if (category === 'audio') return FALLBACK_AUDIO_MODELS
  if (category === 'video') return FALLBACK_VIDEO_MODELS
  return FALLBACK_IMAGE_MODELS
}

export async function listHiggsfieldVoices(): Promise<HiggsfieldVoice[]> {
  try {
    const raw = await runHiggsfieldJson<{ items?: unknown[] } | unknown[]>(['voices', 'list', '--size', '50'], 30_000)
    const items = Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : []
    return items
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const obj = item as Record<string, unknown>
        const id = String(obj.id ?? '')
        const name = String(obj.name ?? obj.label ?? id)
        const type = String(obj.type ?? 'preset') as HiggsfieldVoice['type']
        if (!id) return null
        return { id, name, type: type === 'element' ? 'element' : 'preset' }
      })
      .filter((item): item is HiggsfieldVoice => item !== null)
  } catch {
    return []
  }
}

function normalizeGenerateRaw(raw: unknown): Record<string, unknown> {
  if (Array.isArray(raw) && raw[0] && typeof raw[0] === 'object') {
    return raw[0] as Record<string, unknown>
  }
  if (raw && typeof raw === 'object') {
    return raw as Record<string, unknown>
  }
  return {}
}

const IMAGE_REFERENCE_PARAM_MODELS = new Set([
  'nano_banana_2_lite',
  'gemini_omni',
  'seed_audio'
])

function normalizeModelParam(raw: unknown): HiggsfieldModelParam | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const name = String(obj.name ?? '')
  if (!name) return null
  return {
    name,
    type: String(obj.type ?? 'string'),
    required: Boolean(obj.required),
    default: obj.default,
    enum: Array.isArray(obj.enum) ? obj.enum.map(String) : undefined
  }
}

function inferImageInput(
  modelId: string,
  params: HiggsfieldModelParam[],
  rules: unknown[]
): Pick<HiggsfieldModelSchema, 'imageInput' | 'minImageReferences'> {
  const imageUrl = params.find((param) => param.name === 'image_url')
  if (imageUrl?.required) {
    return { imageInput: 'image_url', minImageReferences: 1 }
  }

  const imageRefs = params.find((param) => param.name === 'image_references')
  if (imageRefs) {
    const requiredCount = rules
      .map((rule) => {
        if (!rule || typeof rule !== 'object') return 0
        const message = String((rule as Record<string, unknown>).message ?? '')
        const match = message.match(/exactly (\d+) image_references/i)
        return match ? Number(match[1]) : 0
      })
      .find((count) => count > 0)

    return {
      imageInput: 'image_references',
      minImageReferences: requiredCount ?? (imageRefs.required ? 1 : modelId === 'image_background_remover' ? 1 : 0)
    }
  }

  if (IMAGE_REFERENCE_PARAM_MODELS.has(modelId)) {
    return { imageInput: 'image_references', minImageReferences: 0 }
  }

  return { imageInput: 'image', minImageReferences: 0 }
}

function normalizeModelSchema(raw: unknown): HiggsfieldModelSchema | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const id = String(obj.job_type ?? obj.job_set_type ?? obj.id ?? '')
  if (!id) return null

  const params = Array.isArray(obj.params)
    ? obj.params.map(normalizeModelParam).filter((param): param is HiggsfieldModelParam => param !== null)
    : []
  const rules = Array.isArray(obj.rules) ? obj.rules : []
  const promptParam = params.find((param) => param.name === 'prompt')
  const categoryRaw = String(obj.type ?? 'image')
  const category: HiggsfieldModelCategory =
    categoryRaw === 'video' ? 'video' : categoryRaw === 'audio' ? 'audio' : 'image'
  const imageMeta = inferImageInput(id, params, rules)

  return {
    id,
    displayName: String(obj.display_name ?? obj.name ?? id),
    category,
    params,
    acceptsPrompt: Boolean(promptParam),
    promptRequired: Boolean(promptParam?.required),
    ...imageMeta
  }
}

export async function getHiggsfieldModelSchema(modelId: string): Promise<HiggsfieldModelSchema | null> {
  try {
    const raw = await runHiggsfieldJson<unknown>(['model', 'get', modelId], 30_000)
    return normalizeModelSchema(raw)
  } catch {
    return null
  }
}

function usesImageReferencesCliFlag(modelId: string): boolean {
  return IMAGE_REFERENCE_PARAM_MODELS.has(modelId)
}

function imageInputFlag(modelId: string, schema: Pick<HiggsfieldModelSchema, 'imageInput'> | null): string {
  if (schema?.imageInput === 'image_url') return 'image_url'
  // nano_banana_2 and most image models use repeated --image (maps to input_images).
  if (usesImageReferencesCliFlag(modelId)) return 'image-references'
  return 'image'
}

async function resolveCliReferenceInputs(
  referencePaths: string[],
  schema: Pick<HiggsfieldModelSchema, 'imageInput'> | null,
  onProgress?: (message: string) => void
): Promise<string[]> {
  if (referencePaths.length === 0) return []
  if (schema?.imageInput === 'image_url') {
    return [normalizeReferencePath(referencePaths[0])]
  }

  onProgress?.(
    referencePaths.length > 1
      ? `Uploading ${referencePaths.length} reference images…`
      : 'Uploading reference image…'
  )

  const uploaded: string[] = []
  for (let i = 0; i < referencePaths.length; i++) {
    onProgress?.(`Uploading reference ${i + 1} of ${referencePaths.length}…`)
    uploaded.push(await uploadLocalMedia(referencePaths[i]))
  }
  return uploaded
}

function normalizeReferencePath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}

function appendReferencePaths(
  args: string[],
  modelId: string,
  referencePaths: string[],
  schema: Pick<HiggsfieldModelSchema, 'imageInput'> | null
): void {
  if (referencePaths.length === 0) return
  const flag = imageInputFlag(modelId, schema)
  for (const refPath of referencePaths) {
    if (refPath) args.push(`--${flag}`, normalizeReferencePath(refPath))
  }
}

function countInputImagesInJob(raw: Record<string, unknown>): number {
  const params = raw.params
  if (!params || typeof params !== 'object') return 0
  const obj = params as Record<string, unknown>
  const images = obj.input_images ?? obj.image_references
  return Array.isArray(images) ? images.length : 0
}

export function validateGenerateRequest(
  request: Pick<HiggsfieldGenerateRequest, 'model' | 'prompt' | 'referencePaths'>,
  schema: HiggsfieldModelSchema | null
): string | null {
  if (!schema) return null

  const referenceCount = request.referencePaths?.filter(Boolean).length ?? 0
  const prompt = request.prompt.trim()

  if (schema.imageInput === 'image_url' && referenceCount === 0) {
    return `${schema.displayName} requires a source image. Attach one in the reference zone below.`
  }

  if (schema.minImageReferences > 0 && referenceCount < schema.minImageReferences) {
    return `${schema.displayName} requires at least ${schema.minImageReferences} reference image${schema.minImageReferences === 1 ? '' : 's'}.`
  }

  if (!schema.acceptsPrompt) {
    if (referenceCount === 0) {
      return `${schema.displayName} requires a reference image and does not accept a text prompt.`
    }
    return null
  }

  if (schema.promptRequired && !prompt && referenceCount === 0) {
    return `${schema.displayName} requires a prompt.`
  }

  if (request.model === 'autosprite' && prompt && referenceCount === 0) {
    return 'AutoSprite animates a source image. Attach an image below — a text prompt alone is not enough.'
  }

  return null
}

export async function generateHiggsfieldContent(
  request: HiggsfieldGenerateRequest,
  onProgress?: (message: string) => void
): Promise<HiggsfieldGenerateResult> {
  const schema = await getHiggsfieldModelSchema(request.model)
  const validationError = validateGenerateRequest(request, schema)
  if (validationError) {
    throw new HiggsfieldCliError(validationError)
  }

  const args = ['generate', 'create', request.model]
  const prompt = request.prompt.trim()
  const autospriteKind = String(request.params?.kind ?? 'idle')
  const skipPrompt =
    request.model === 'autosprite'
      ? autospriteKind !== 'custom'
      : schema?.acceptsPrompt === false

  if (prompt && !skipPrompt) {
    args.push('--prompt', prompt)
  }

  if (request.wait !== false) {
    args.push('--wait', '--wait-timeout', request.waitTimeout ?? '10m')
  }

  for (const [key, value] of Object.entries(request.params ?? {})) {
    if (value === undefined || value === null || value === '') continue
    args.push(`--${key}`, String(value))
  }

  onProgress?.('Selecting Higgsfield workspace…')
  await ensureHiggsfieldWorkspace(request.workspaceId)

  if (request.mediaPath) {
    const flag = request.mediaFlag ?? 'audio'
    let mediaValue = normalizeReferencePath(request.mediaPath)
    if (flag === 'start-image' || flag === 'end-image' || flag === 'image') {
      onProgress?.('Uploading start frame…')
      mediaValue = await uploadLocalMedia(mediaValue)
    }
    args.push(`--${flag}`, mediaValue)
  }

  const referencePaths = (request.referencePaths ?? []).filter(Boolean)
  const cliReferences = await resolveCliReferenceInputs(referencePaths, schema, onProgress)
  appendReferencePaths(args, request.model, cliReferences, schema)

  if (referencePaths.length > 0) {
    const mediaFlag = imageInputFlag(request.model, schema)
    logInfo('higgsfield:generate', 'Submitting image references', {
      model: request.model,
      referenceCount: referencePaths.length,
      referencePaths,
      cliMediaFlag: mediaFlag,
      cliReferenceInputs: cliReferences.map((id, i) => ({ index: i + 1, id }))
    })
  }

  onProgress?.('Submitting generation job to Higgsfield…')

  let raw: Record<string, unknown>
  try {
    const parsed = await runHiggsfieldJson<unknown>(args, 900_000)
    raw = normalizeGenerateRaw(parsed)
  } catch (err) {
    logError('higgsfield:generate', err, {
      model: request.model,
      workspaceId: request.workspaceId,
      promptLength: request.prompt.length
    })
    throw err
  }

  const submittedInputImages = countInputImagesInJob(raw)
  if (referencePaths.length > 1) {
    logInfo('higgsfield:generate', 'Reference images acknowledged by API', {
      model: request.model,
      requested: referencePaths.length,
      acknowledged: submittedInputImages
    })
    if (submittedInputImages < referencePaths.length) {
      logWarn('higgsfield:generate', 'Not all reference images were accepted by Higgsfield', {
        model: request.model,
        requested: referencePaths.length,
        acknowledged: submittedInputImages
      })
    }
  }

  const resultUrls = extractResultUrls(raw, {
    preferVideo: request.category === 'video'
  })
  const primaryUrl = pickPrimaryResultUrl(raw, resultUrls, {
    preferVideo: request.category === 'video'
  })

  onProgress?.('Downloading generated media…')

  let localPath: string | undefined
  if (request.importAudio) {
    localPath = (await downloadFirstAudio(resultUrls)) ?? undefined
  } else if (primaryUrl) {
    localPath = await downloadMedia(primaryUrl)
  }

  const orderedUrls =
    primaryUrl && resultUrls[0] !== primaryUrl
      ? [primaryUrl, ...resultUrls.filter((url) => url !== primaryUrl)]
      : resultUrls

  return {
    jobId: typeof raw.id === 'string' ? raw.id : typeof raw.job_id === 'string' ? raw.job_id : undefined,
    resultUrls: orderedUrls,
    localPath,
    raw
  }
}

export function formatHiggsfieldError(err: unknown): string {
  if (err instanceof HiggsfieldCliError) {
    const msg = err.message
    if (msg.toLowerCase().includes('not authenticated')) {
      return 'Not connected to Higgsfield. Click Connect and complete login in your browser.'
    }
    if (msg.toLowerCase().includes('no workspace selected')) {
      return 'No workspace selected. Choose a workspace in the Higgsfield panel, then try again.'
    }
    if (msg.toLowerCase().includes('not_enough_credits')) {
      return 'Not enough credits in the selected workspace. Switch to Ledisa LLC or another workspace with credits.'
    }
    if (msg.toLowerCase().includes('invalid json') || msg.toLowerCase().includes('no valid json')) {
      return 'Higgsfield returned an unexpected response. Details were written to the app log file.'
    }
    if (msg.toLowerCase().includes('no model with job_type')) {
      return 'Invalid model selected. Click Refresh in the Higgsfield panel to reload models, then try again.'
    }
    if (msg.toLowerCase().includes('missing required params: image_url')) {
      return 'This model requires a source image. Attach one in the reference zone, then try again.'
    }
    if (msg.toLowerCase().includes('missing required params: image_references')) {
      return 'This model requires a reference image. Attach one in the reference zone, then try again.'
    }
    if (msg.toLowerCase().includes('unknown params: prompt')) {
      return 'This model does not accept a text prompt. Attach a reference image instead, or switch to a general image model like Nano Banana Pro.'
    }
    if (msg.toLowerCase().includes('missing required params')) {
      return msg.replace(/^Error:\s*/i, '')
    }
    return msg
  }
  const text = String(err)
  if (text.includes('SyntaxError') && text.includes('JSON')) {
    return 'Higgsfield returned an unexpected response. Details were written to the app log file.'
  }
  if (text.includes('not_enough_credits')) {
    return 'Not enough credits in the selected workspace. Switch to Ledisa LLC or another workspace with credits.'
  }
  if (text.includes('no workspace selected')) {
    return 'No workspace selected. Choose a workspace in the Higgsfield panel, then try again.'
  }
  return text.replace(/^Error:\s*/i, '').replace(/^Error invoking remote method '[^']+':\s*/i, '')
}
