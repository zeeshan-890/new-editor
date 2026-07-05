import { create } from 'zustand'
import type {
  HiggsfieldComposerState,
  HiggsfieldGenerateRequest,
  HiggsfieldGenerateResult,
  HiggsfieldGenerationJob,
  HiggsfieldModelCategory,
  HiggsfieldModelSchema,
  HiggsfieldReferenceImage,
  HiggsfieldWorkspace
} from '@shared/types'
import { generateId } from '@shared/types'

const MAX_REFERENCES = 14

function pickPreferredWorkspace(workspaces: HiggsfieldWorkspace[]): HiggsfieldWorkspace | null {
  if (workspaces.length === 0) return null
  const ledisa = workspaces.find((ws) => ws.name.toLowerCase().includes('ledisa'))
  if (ledisa) return ledisa
  return workspaces.reduce((best, ws) => (ws.credits > best.credits ? ws : best))
}

function computeQueueStats(jobs: HiggsfieldGenerationJob[]): { queued: number; running: number } {
  return {
    queued: jobs.filter((job) => job.status === 'queued').length,
    running: jobs.filter((job) => job.status === 'running').length
  }
}

function mergeJob(jobs: HiggsfieldGenerationJob[], updated: HiggsfieldGenerationJob): HiggsfieldGenerationJob[] {
  const idx = jobs.findIndex((job) => job.id === updated.id)
  if (idx >= 0) {
    const next = [...jobs]
    next[idx] = updated
    return next
  }
  return [updated, ...jobs]
}

function refKey(ref: Pick<HiggsfieldReferenceImage, 'url' | 'localPath'>): string {
  return ref.localPath ?? ref.url ?? ''
}

export function canSubmitVisualGeneration(
  schema: HiggsfieldModelSchema | null,
  prompt: string,
  referenceCount: number
): boolean {
  const trimmedPrompt = prompt.trim()
  if (!schema) return trimmedPrompt.length > 0 || referenceCount > 0

  if (schema.minImageReferences > 0) {
    return referenceCount >= schema.minImageReferences
  }
  if (schema.imageInput === 'image_url') return referenceCount > 0
  if (!schema.acceptsPrompt) return referenceCount > 0
  if (schema.promptRequired) return trimmedPrompt.length > 0 || referenceCount > 0
  return trimmedPrompt.length > 0 || referenceCount > 0
}

function validateVisualGeneration(
  schema: HiggsfieldModelSchema | null,
  model: string,
  prompt: string,
  referenceCount: number
): string | null {
  const trimmedPrompt = prompt.trim()
  if (schema?.imageInput === 'image_url' && referenceCount === 0) {
    return `${schema.displayName} requires a source image. Attach one in the reference zone below.`
  }
  if (schema?.minImageReferences && referenceCount < schema.minImageReferences) {
    return `${schema.displayName} requires at least ${schema.minImageReferences} reference image${schema.minImageReferences === 1 ? '' : 's'}.`
  }
  if (schema && !schema.acceptsPrompt) {
    if (referenceCount === 0) {
      return `${schema.displayName} requires a reference image and does not accept a text prompt.`
    }
    return null
  }
  if (schema?.promptRequired && !trimmedPrompt && referenceCount === 0) {
    return `${schema.displayName} requires a prompt.`
  }
  if (model === 'autosprite' && trimmedPrompt && referenceCount === 0) {
    return 'AutoSprite animates a source image. Attach an image below — a text prompt alone is not enough.'
  }
  if (!trimmedPrompt && referenceCount === 0) {
    return 'Enter a prompt or attach at least one reference image.'
  }
  return null
}

import { sortImageModels } from '@shared/imageModels'
const PREFERRED_IMAGE_MODELS = [
  'nano_banana_2',
  'nano_banana_flash',
  'flux_2',
  'text2image_soul_v2',
  'gpt_image_2'
]
const PREFERRED_VIDEO_MODELS = ['veo3_1', 'kling3_0', 'seedance_2_0']

function pickDefaultModel(
  models: { id: string }[],
  current: string,
  category: HiggsfieldModelCategory
): string {
  if (models.some((model) => model.id === current)) return current
  const preferred = category === 'video' ? PREFERRED_VIDEO_MODELS : PREFERRED_IMAGE_MODELS
  for (const id of preferred) {
    if (models.some((model) => model.id === id)) return id
  }
  return models[0]?.id ?? ''
}

const emptyComposer = (): HiggsfieldComposerState => ({
  prompt: '',
  references: [],
  sourceJobId: undefined
})

export const useHiggsfieldStore = create<{
  status: Awaited<ReturnType<NonNullable<typeof window.electronAPI>['getHiggsfieldStatus']>> | null
  models: Awaited<ReturnType<NonNullable<typeof window.electronAPI>['listHiggsfieldModels']>>
  imageModels: Awaited<ReturnType<NonNullable<typeof window.electronAPI>['listHiggsfieldModels']>>
  videoModels: Awaited<ReturnType<NonNullable<typeof window.electronAPI>['listHiggsfieldModels']>>
  voices: Awaited<ReturnType<NonNullable<typeof window.electronAPI>['listHiggsfieldVoices']>>
  workspaces: HiggsfieldWorkspace[]
  selectedWorkspaceId: string
  category: HiggsfieldModelCategory
  selectedModel: string
  selectedVoiceId: string
  selectedVoiceType: 'preset' | 'element'
  ttsEngine: string
  composer: HiggsfieldComposerState
  jobs: HiggsfieldGenerationJob[]
  selectedJobId?: string
  queueStats: { queued: number; running: number }
  generating: boolean
  progressMessage: string
  error: string | null
  statusLoading: boolean
  modelSchema: HiggsfieldModelSchema | null

  refreshStatus: () => Promise<void>
  login: () => Promise<void>
  loadModels: (category?: HiggsfieldModelCategory) => Promise<void>
  loadModelSchema: (modelId?: string) => Promise<void>
  loadVoices: () => Promise<void>
  setSelectedWorkspaceId: (workspaceId: string) => Promise<void>
  setCategory: (category: HiggsfieldModelCategory) => void
  setSelectedModel: (model: string) => void
  setSelectedVoiceId: (id: string) => void
  setSelectedVoiceType: (type: 'preset' | 'element') => void
  setTtsEngine: (engine: string) => void
  setComposerPrompt: (prompt: string) => void
  setError: (error: string | null) => void
  clearComposer: () => void
  attachReference: (ref: Omit<HiggsfieldReferenceImage, 'id'> & { id?: string }) => void
  removeReference: (id: string) => void
  resolveAndAttach: (url: string, localPath?: string, label?: string) => Promise<void>
  loadJobIntoComposer: (jobId: string) => void
  selectJob: (jobId: string | undefined) => void
  syncJobs: () => Promise<void>
  subscribeJobUpdates: () => () => void
  enqueueGeneration: (options?: Partial<HiggsfieldGenerateRequest>) => Promise<HiggsfieldGenerationJob | null>
  generate: (options?: Partial<HiggsfieldGenerateRequest>) => Promise<HiggsfieldGenerateResult | null>
}>((set, get) => ({
  status: null,
  models: [],
  imageModels: [],
  videoModels: [],
  voices: [],
  workspaces: [],
  selectedWorkspaceId: '',
  category: 'audio',
  selectedModel: 'text2speech_v2',
  selectedVoiceId: '',
  selectedVoiceType: 'preset',
  ttsEngine: 'elevenlabs',
  composer: emptyComposer(),
  jobs: [],
  selectedJobId: undefined,
  queueStats: { queued: 0, running: 0 },
  generating: false,
  progressMessage: '',
  error: null,
  statusLoading: false,
  modelSchema: null,

  refreshStatus: async () => {
    if (!window.electronAPI) {
      set({
        status: null,
        error: 'Desktop API unavailable. Use the Electron app window from npm run dev — not the browser tab.',
        statusLoading: false
      })
      return
    }

    set({ statusLoading: true, error: null })
    try {
      const status = await window.electronAPI.getHiggsfieldStatus()

      let workspaces = status.workspaces ?? []
      if (typeof window.electronAPI.listHiggsfieldWorkspaces === 'function') {
        try {
          workspaces = await window.electronAPI.listHiggsfieldWorkspaces()
        } catch {
          // keep workspaces from status
        }
      }

      const preferred = pickPreferredWorkspace(workspaces)
      const selectedWorkspaceId =
        status.selectedWorkspace?.id ?? preferred?.id ?? ''

      set({ status, workspaces, selectedWorkspaceId, error: null, statusLoading: false })

      if (status.authenticated && selectedWorkspaceId && selectedWorkspaceId !== status.selectedWorkspace?.id) {
        await get().setSelectedWorkspaceId(selectedWorkspaceId)
      } else if (status.authenticated && selectedWorkspaceId && !status.selectedWorkspace) {
        await get().setSelectedWorkspaceId(selectedWorkspaceId)
      }

      if (status.authenticated) {
        await get().loadModels('image')
        await get().loadVoices()
        await get().syncJobs()
      }
    } catch (err) {
      set({
        status: { cliAvailable: false, authenticated: false, account: null },
        error: String(err),
        statusLoading: false
      })
    }
  },

  login: async () => {
    if (!window.electronAPI) return
    set({ error: null })
    await window.electronAPI.loginHiggsfield()
    set({ progressMessage: 'Complete login in your browser, then click Refresh.' })
  },

  loadModels: async (category = get().category) => {
    if (!window.electronAPI) return
    const models = await window.electronAPI.listHiggsfieldModels(category)

    if (category === 'image') {
      set({ imageModels: sortImageModels(models) })
      return
    }
    if (category === 'video') {
      set({ videoModels: models })
      return
    }

    const selectedModel = pickDefaultModel(models, get().selectedModel, category)
    set({ models, selectedModel, category: 'audio' })
    await get().loadModelSchema(selectedModel)
  },

  loadModelSchema: async (modelId = get().selectedModel) => {
    if (!window.electronAPI?.getHiggsfieldModel || !modelId) {
      set({ modelSchema: null })
      return
    }
    try {
      const modelSchema = await window.electronAPI.getHiggsfieldModel(modelId)
      set({ modelSchema })
    } catch {
      set({ modelSchema: null })
    }
  },

  loadVoices: async () => {
    if (!window.electronAPI) return
    const voices = await window.electronAPI.listHiggsfieldVoices()
    set({
      voices,
      selectedVoiceId: get().selectedVoiceId || voices[0]?.id || '',
      selectedVoiceType: voices.find((v) => v.id === get().selectedVoiceId)?.type ?? voices[0]?.type ?? 'preset'
    })
  },

  setSelectedWorkspaceId: async (workspaceId) => {
    if (!window.electronAPI || !workspaceId) return
    set({ selectedWorkspaceId: workspaceId, error: null })
    try {
      const workspace = await window.electronAPI.setHiggsfieldWorkspace(workspaceId)
      if (workspace) {
        set((state) => ({
          workspaces: state.workspaces.map((ws) => ({
            ...ws,
            isSelected: ws.id === workspace.id
          })),
          status: state.status
            ? { ...state.status, selectedWorkspace: workspace }
            : state.status
        }))
      }
    } catch (err) {
      set({ error: String(err) })
    }
  },

  setCategory: (category) => {
    set({ category })
    void get().loadModels(category)
  },

  setSelectedModel: (selectedModel) => {
    set({ selectedModel })
    void get().loadModelSchema(selectedModel)
  },
  setSelectedVoiceId: (selectedVoiceId) => {
    const voice = get().voices.find((v) => v.id === selectedVoiceId)
    set({ selectedVoiceId, selectedVoiceType: voice?.type ?? 'preset' })
  },
  setSelectedVoiceType: (selectedVoiceType) => set({ selectedVoiceType }),
  setTtsEngine: (ttsEngine) => set({ ttsEngine }),
  setComposerPrompt: (prompt) =>
    set((state) => ({ composer: { ...state.composer, prompt } })),
  setError: (error) => set({ error }),

  clearComposer: () => set({ composer: emptyComposer(), selectedJobId: undefined }),

  attachReference: (ref) => {
    const key = refKey(ref)
    if (!key) return
    set((state) => {
      if (state.composer.references.some((item) => refKey(item) === key)) {
        return state
      }
      if (state.composer.references.length >= MAX_REFERENCES) {
        return { error: `At most ${MAX_REFERENCES} image references are allowed.` }
      }
      const nextRef: HiggsfieldReferenceImage = {
        id: ref.id ?? generateId(),
        url: ref.url,
        localPath: ref.localPath,
        label: ref.label ?? 'reference'
      }
      return {
        composer: {
          ...state.composer,
          references: [...state.composer.references, nextRef]
        },
        error: null
      }
    })
  },

  removeReference: (id) =>
    set((state) => ({
      composer: {
        ...state.composer,
        references: state.composer.references.filter((ref) => ref.id !== id)
      }
    })),

  resolveAndAttach: async (url, localPath, label) => {
    if (!window.electronAPI) return
    try {
      if (localPath) {
        get().attachReference({ url, localPath, label: label ?? 'reference' })
        return
      }
      const resolved = await window.electronAPI.resolveHiggsfieldReference(url)
      get().attachReference({
        url: resolved.url,
        localPath: resolved.localPath,
        label: label ?? 'reference'
      })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  loadJobIntoComposer: (jobId) => {
    const job = get().jobs.find((item) => item.id === jobId)
    if (!job) return
    set({
      selectedJobId: jobId,
      selectedModel: job.model,
      composer: {
        prompt: job.prompt,
        references: job.references.map((ref) => ({ ...ref })),
        sourceJobId: jobId
      },
      error: null
    })
  },

  selectJob: (jobId) => set({ selectedJobId: jobId }),

  syncJobs: async () => {
    if (!window.electronAPI?.listHiggsfieldJobs) return
    const jobs = await window.electronAPI.listHiggsfieldJobs()
    set({ jobs, queueStats: computeQueueStats(jobs) })
  },

  subscribeJobUpdates: () => {
    if (!window.electronAPI?.onHiggsfieldJobUpdated) {
      return () => undefined
    }

    return window.electronAPI.onHiggsfieldJobUpdated((job) => {
      set((state) => {
        const jobs = mergeJob(state.jobs, job)
        return { jobs, queueStats: computeQueueStats(jobs) }
      })
    })
  },

  enqueueGeneration: async (options) => {
    if (!window.electronAPI?.enqueueHiggsfieldJob) return null
    const state = get()
    const prompt = state.composer.prompt.trim()
    const referenceCount = state.composer.references.length
    const validationError = validateVisualGeneration(
      state.modelSchema,
      state.selectedModel,
      prompt,
      referenceCount
    )

    if (validationError) {
      set({ error: validationError })
      return null
    }

    set({ error: null })

    const params: Record<string, string> = { ...(options?.params as Record<string, string> | undefined) }
    if (state.selectedModel === 'text2speech_v2') {
      params.model = state.ttsEngine
      if (state.selectedVoiceId) {
        params.voice_id = state.selectedVoiceId
        params.voice_type = state.selectedVoiceType
      }
    }

    try {
      const job = await window.electronAPI.enqueueHiggsfieldJob({
        model: state.selectedModel,
        prompt,
        workspaceId: state.selectedWorkspaceId || undefined,
        category: state.category,
        references: state.composer.references.map((ref) => ({ ...ref })),
        parentJobId: state.composer.sourceJobId,
        params,
        wait: true,
        importAudio: false,
        mediaPath: options?.mediaPath,
        mediaFlag: options?.mediaFlag,
        ...options
      })

      set((s) => {
        const jobs = mergeJob(s.jobs, job)
        return { jobs, queueStats: computeQueueStats(jobs) }
      })
      return job
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message })
      return null
    }
  },

  generate: async (options) => {
    if (!window.electronAPI) return null
    const state = get()

    if (state.category === 'image' || state.category === 'video') {
      return null
    }

    const prompt = state.composer.prompt.trim()
    if (!prompt) {
      set({ error: 'Enter a prompt first.' })
      return null
    }

    set({ generating: true, progressMessage: 'Starting generation…', error: null })

    const unsub = window.electronAPI.onHiggsfieldProgress((message) => {
      set({ progressMessage: message })
    })

    const params: Record<string, string> = { ...(options?.params as Record<string, string> | undefined) }
    if (state.selectedModel === 'text2speech_v2') {
      params.model = state.ttsEngine
      if (state.selectedVoiceId) {
        params.voice_id = state.selectedVoiceId
        params.voice_type = state.selectedVoiceType
      }
    }

    const request: HiggsfieldGenerateRequest = {
      model: state.selectedModel,
      prompt,
      workspaceId: state.selectedWorkspaceId || undefined,
      params,
      wait: true,
      importAudio: state.category === 'audio',
      ...options
    }

    try {
      const result = await window.electronAPI.generateHiggsfieldContent(request)
      set({
        progressMessage: result.localPath ? 'Downloaded — ready to import' : 'Generation complete',
        generating: false
      })
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message, generating: false, progressMessage: '' })
      return null
    } finally {
      unsub()
    }
  }
}))
