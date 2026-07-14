import { create } from 'zustand'
import type {
  AppTab,
  GenerationComposerSnapshot,
  GenerationMode,
  GenerationModeDraft,
  GenerationProject,
  ProjectGeneration,
  ProjectMedia,
  ProjectSummary,
  ScriptAudioMatch,
  TabComposerState
} from '@shared/types'
import {
  createEmptyTabComposerState,
  APP_SESSION_VERSION,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  generateId,
  generationToModeDraft,
  clampVideoDurationSeconds,
  normalizeTabComposerState
} from '@shared/types'
import { normalizeLoadedGenerationProject, normalizePipelineState } from '@shared/segmentPipeline'
import {
  findPipelineSegmentForGeneration,
  parseSegmentNumberFromPrompt
} from '@shared/pipelineImageRefs'
import type { SegmentPipelineState } from '@shared/segmentPipeline'
import { isLegacyDefaultImageModel, shouldUseDefaultImageModel } from '@shared/imageModels'
import { localMediaPathUrl } from '@renderer/lib/localFileProtocol'

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

function generationIsVideo(item: ProjectGeneration): boolean {
  return item.type === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(item.url)
}

function isCharacterAnchorPrompt(prompt: string): boolean {
  return prompt.trim().startsWith('Character anchor:')
}

/** Drop stale Segment N gallery items that no longer match pipeline media. */
function pruneGenerationsForPipeline(
  generations: ProjectGeneration[],
  pipeline: SegmentPipelineState
): ProjectGeneration[] {
  const keepIds = new Set<string>()
  for (const character of pipeline.characters) {
    if (character.anchorImagePath && character.anchorImageJobId) {
      keepIds.add(character.anchorImageJobId)
    }
  }
  for (const segment of pipeline.segments) {
    if (segment.imageLocalPath && segment.imageJobId) keepIds.add(segment.imageJobId)
    if (segment.videoLocalPath && segment.videoJobId) keepIds.add(segment.videoJobId)
    if (segment.pendingImageApproval?.jobId) keepIds.add(segment.pendingImageApproval.jobId)
  }

  return generations.filter((item) => {
    if (keepIds.has(item.id)) return true

    if (isCharacterAnchorPrompt(item.prompt)) {
      const name = item.prompt.replace(/^Character anchor:\s*/i, '').trim()
      const character = pipeline.characters.find(
        (c) => c.name === name || c.anchorImageJobId === item.id
      )
      if (!character) return true
      if (!character.anchorImagePath) return false
      return character.anchorImagePath === item.localPath
    }

    const segmentNum = parseSegmentNumberFromPrompt(item.prompt)
    if (segmentNum == null) return true
    const segment = pipeline.segments.find((s) => s.index === segmentNum - 1)
    if (!segment) return true

    const isVideo = generationIsVideo(item)
    if (isVideo) {
      if (!segment.videoLocalPath) return false
      if (segment.videoJobId && item.id === segment.videoJobId) return true
      return segment.videoLocalPath === item.localPath
    }

    if (segment.pendingImageApproval?.jobId === item.id) return true
    if (!segment.imageLocalPath) return false
    if (segment.imageJobId && item.id === segment.imageJobId) return true
    return segment.imageLocalPath === item.localPath
  })
}

function upsertPipelineMediaGeneration(
  generations: ProjectGeneration[],
  pipeline: SegmentPipelineState
): ProjectGeneration[] {
  let next = [...generations]

  for (const segment of pipeline.segments) {
    if (!segment.imageLocalPath || !segment.imageJobId) continue
    if (next.some((item) => item.id === segment.imageJobId)) continue
    next = [
      {
        id: segment.imageJobId,
        type: 'image',
        prompt: `Segment ${segment.index + 1}: ${segment.scriptText}`,
        model: pipeline.imageModel ?? DEFAULT_IMAGE_MODEL,
        url: localMediaPathUrl(segment.imageLocalPath),
        localPath: segment.imageLocalPath,
        createdAt: Date.now()
      },
      ...next
    ]
  }

  for (const segment of pipeline.segments) {
    if (!segment.videoLocalPath || !segment.videoJobId) continue
    if (next.some((item) => item.id === segment.videoJobId)) continue
    next = [
      {
        id: segment.videoJobId,
        type: 'video',
        prompt: `Segment ${segment.index + 1}: ${segment.scriptText}`,
        model: pipeline.videoModel ?? DEFAULT_VIDEO_MODEL,
        url: localMediaPathUrl(segment.videoLocalPath),
        localPath: segment.videoLocalPath,
        createdAt: Date.now()
      },
      ...next
    ]
  }

  return next
}

function scheduleProjectSave(projectId: string, get: () => { projects: Record<string, GenerationProject> }): void {
  const existing = saveTimers.get(projectId)
  if (existing) clearTimeout(existing)
  saveTimers.set(
    projectId,
    setTimeout(() => {
      saveTimers.delete(projectId)
      const project = get().projects[projectId]
      if (project && window.electronAPI?.saveProject) {
        void window.electronAPI.saveProject(project)
      }
    }, 800)
  )
}

function scheduleSessionSave(
  get: () => { sessionVersion: number },
  tabs: AppTab[],
  activeTabId: string,
  tabDrafts: Record<string, TabComposerState>,
  sessionVersion?: number
): void {
  if (!window.electronAPI?.saveSession) return
  void window.electronAPI.saveSession({
    tabs,
    activeTabId,
    tabDrafts,
    sessionVersion: sessionVersion ?? get().sessionVersion
  })
}

function draftsForTabs(
  tabs: AppTab[],
  existing: Record<string, TabComposerState> = {}
): Record<string, TabComposerState> {
  const next = { ...existing }
  for (const tab of tabs) {
    if (tab.kind === 'generation') {
      next[tab.id] = normalizeTabComposerState(next[tab.id])
    }
  }
  return next
}

function projectIdForGenerationTab(tabs: AppTab[], tabId: string): string | null {
  const tab = tabs.find((t) => t.id === tabId && t.kind === 'generation')
  return tab?.projectId ?? null
}

export const useProjectTabStore = create<{
  tabs: AppTab[]
  activeTabId: string
  projects: Record<string, GenerationProject>
  tabDrafts: Record<string, TabComposerState>
  projectList: ProjectSummary[]
  projectsPageOpen: boolean
  newTabMenuOpen: boolean
  pendingJobProjects: Record<string, string>
  pendingJobConfigs: Record<string, GenerationComposerSnapshot>
  initialized: boolean
  sessionVersion: number

  init: () => Promise<void>
  setNewTabMenuOpen: (open: boolean) => void
  openProjectsPage: () => void
  setActiveTab: (tabId: string) => void
  closeTab: (tabId: string) => void
  openNewProjectTab: () => Promise<void>
  openExistingProjectTab: (projectId: string) => Promise<void>
  openEditorTab: (projectId?: string) => Promise<void>
  openProjectEditorTab: (projectId: string) => Promise<void>
  updateProjectGenerationLocalPath: (
    projectId: string,
    generationId: string,
    localPath: string
  ) => void
  saveVideoEditorForProject: (projectId: string) => void
  refreshProjectList: () => Promise<void>
  flushProjectSaves: () => Promise<void>
  deleteProjectAndCloseTabs: (projectId: string) => Promise<boolean>
  deleteProjectsAndCloseTabs: (projectIds: string[]) => Promise<number>
  updateProject: (projectId: string, patch: Partial<GenerationProject>) => void
  mergeProject: (project: GenerationProject) => void
  updateProjectPipelineState: (projectId: string, pipeline: SegmentPipelineState) => void
  saveProjectNow: (projectId: string) => Promise<void>
  updateTabDraft: (tabId: string, patch: Partial<TabComposerState>) => void
  updateModeDraft: (tabId: string, mode: GenerationMode, patch: Partial<GenerationModeDraft>) => void
  appendImageAttachment: (tabId: string, media: ProjectMedia) => void
  setTabMode: (tabId: string, mode: GenerationMode) => void
  loadGenerationIntoTab: (tabId: string, projectId: string, generation: ProjectGeneration) => Promise<void>
  applyRegeneratedSegmentImage: (
    projectId: string,
    payload: {
      segmentId: string
      replacesGenerationId?: string
      generation: ProjectGeneration
      imagePrompt: string
      imageAttachments?: ProjectGeneration['imageAttachments']
      context?: string
      useContextInPrompt?: boolean
      aspectRatio?: string
    }
  ) => void
  stagePendingSegmentImage: (
    projectId: string,
    payload: {
      segmentId: string
      generation: ProjectGeneration
      imagePrompt: string
      config?: GenerationComposerSnapshot
      replacesGenerationId?: string
    }
  ) => void
  approveSegmentImage: (projectId: string, segmentId: string) => void
  discardPendingSegmentImage: (projectId: string, segmentId: string) => void
  addProjectGeneration: (projectId: string, generation: ProjectGeneration) => void
  deleteProjectGeneration: (projectId: string, generationId: string) => void
  linkEditorAudioToProject: (
    projectId: string,
    payload: {
      media: ProjectMedia
      clipId: string
      sourceInMs: number
      sourceOutMs: number
    }
  ) => void
  setScriptMatch: (projectId: string, match: ScriptAudioMatch | null) => void
  trackJob: (jobId: string, projectId: string, config: GenerationComposerSnapshot) => void
  handleJobUpdate: (job: {
    id: string
    status: string
    model: string
    prompt: string
    category: string
    resultUrls: string[]
    localPath?: string
  }) => void
}>((set, get) => ({
  tabs: [],
  activeTabId: '',
  projects: {},
  tabDrafts: {},
  projectList: [],
  projectsPageOpen: false,
  newTabMenuOpen: false,
  pendingJobProjects: {},
  pendingJobConfigs: {},
  initialized: false,
  sessionVersion: APP_SESSION_VERSION,

  init: async () => {
    if (!window.electronAPI) {
      set({ initialized: true })
      return
    }

    try {
      await get().refreshProjectList()

      const session = await window.electronAPI.loadSession()
      let tabs = session?.tabs ?? []
      let activeTabId = session?.activeTabId ?? ''
      let tabDrafts = session?.tabDrafts ?? {}

      const projects: Record<string, GenerationProject> = {}
      for (const tab of tabs) {
        if (tab.projectId) {
          const loaded = await window.electronAPI.loadProject(tab.projectId)
          if (loaded) projects[tab.projectId] = normalizeLoadedGenerationProject(loaded)
          else tabs = tabs.filter((t) => t.id !== tab.id)
        }
      }

      tabDrafts = draftsForTabs(tabs, tabDrafts)

      const sessionVersion = session?.sessionVersion ?? 0
      const needsModelMigration = sessionVersion < APP_SESSION_VERSION
      const needsComposerMigration = sessionVersion < 4

      for (const [draftTabId, draft] of Object.entries(tabDrafts)) {
        const imageDraft = draft?.image
        if (!imageDraft) continue
        const model = imageDraft.model
        const migrateModel =
          shouldUseDefaultImageModel(model) ||
          (needsModelMigration && isLegacyDefaultImageModel(model))
        if (migrateModel) {
          tabDrafts[draftTabId] = {
            ...draft,
            image: { ...imageDraft, model: DEFAULT_IMAGE_MODEL }
          }
        }
      }

      for (const tab of tabs) {
        if (tab.kind !== 'generation' || !tab.projectId) continue
        const project = projects[tab.projectId]
        if (!project) continue
        const draftFromSession = tabDrafts[tab.id]
        const composer = needsComposerMigration && draftFromSession
          ? normalizeTabComposerState(draftFromSession)
          : normalizeTabComposerState(project.composer ?? draftFromSession ?? createEmptyTabComposerState())
        tabDrafts[tab.id] = composer
        if (needsComposerMigration) {
          projects[tab.projectId] = { ...project, composer }
        }
      }

      if (tabs.length === 0) {
        const project = await window.electronAPI.createProject()
        const tab: AppTab = {
          id: generateId(),
          kind: 'generation',
          title: project.name,
          projectId: project.id
        }
        tabs = [tab]
        activeTabId = tab.id
        projects[project.id] = normalizeLoadedGenerationProject(project)
        tabDrafts[tab.id] = normalizeTabComposerState(projects[project.id].composer)
      }

      const nextSessionVersion = needsModelMigration ? APP_SESSION_VERSION : sessionVersion

      if (!tabs.some((t) => t.id === activeTabId)) {
        activeTabId = tabs[0]?.id ?? ''
      }

      set({
        tabs,
        activeTabId,
        projects,
        tabDrafts,
        initialized: true,
        sessionVersion: nextSessionVersion
      })
      if (needsComposerMigration && window.electronAPI?.saveProject) {
        for (const project of Object.values(projects)) {
          void window.electronAPI.saveProject(project)
        }
      }
      scheduleSessionSave(get, tabs, activeTabId, tabDrafts, nextSessionVersion)
    } catch (err) {
      console.error('[projectTabStore:init]', err)
      set({ initialized: true })
    }
  },

  setNewTabMenuOpen: (newTabMenuOpen) => set({ newTabMenuOpen }),

  openProjectsPage: () => set({ projectsPageOpen: true, newTabMenuOpen: false }),

  setActiveTab: (tabId) => {
    set({ activeTabId: tabId, projectsPageOpen: false })
    scheduleSessionSave(get, get().tabs, tabId, get().tabDrafts)
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId, tabDrafts } = get()
    if (tabs.length <= 1) return
    const nextTabs = tabs.filter((t) => t.id !== tabId)
    const nextDrafts = { ...tabDrafts }
    delete nextDrafts[tabId]
    const nextActive =
      activeTabId === tabId
        ? nextTabs[Math.max(0, tabs.findIndex((t) => t.id === tabId) - 1)]?.id ?? nextTabs[0]?.id
        : activeTabId
    set({ tabs: nextTabs, activeTabId: nextActive, tabDrafts: nextDrafts })
    scheduleSessionSave(get, nextTabs, nextActive, nextDrafts)
  },

  openNewProjectTab: async () => {
    if (!window.electronAPI) return
    const project = normalizeLoadedGenerationProject(await window.electronAPI.createProject())
    const tab: AppTab = {
      id: generateId(),
      kind: 'generation',
      title: project.name,
      projectId: project.id
    }
    const tabDrafts = { ...get().tabDrafts, [tab.id]: normalizeTabComposerState(project.composer) }
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
      projects: { ...state.projects, [project.id]: project },
      tabDrafts,
      newTabMenuOpen: false,
      projectsPageOpen: false
    }))
    scheduleSessionSave(get, get().tabs, tab.id, tabDrafts)
    await get().refreshProjectList()
  },

  openExistingProjectTab: async (projectId) => {
    if (!window.electronAPI) return

    const loaded = await window.electronAPI.loadProject(projectId)
    if (!loaded) return
    const project = normalizeLoadedGenerationProject(loaded)

    const tab: AppTab = {
      id: generateId(),
      kind: 'generation',
      title: project.name,
      projectId: project.id
    }
    const tabDrafts = { ...get().tabDrafts, [tab.id]: normalizeTabComposerState(project.composer) }
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
      projects: { ...state.projects, [project.id]: project },
      tabDrafts,
      newTabMenuOpen: false,
      projectsPageOpen: false
    }))
    scheduleSessionSave(get, get().tabs, tab.id, tabDrafts)
  },

  openEditorTab: async (projectId) => {
    let title = 'Video Editor'
    let project: GenerationProject | undefined

    if (projectId) {
      project = get().projects[projectId]
      if (!project && window.electronAPI) {
        const loaded = await window.electronAPI.loadProject(projectId)
        if (loaded) project = normalizeLoadedGenerationProject(loaded)
      }
      if (project) title = `${project.name} · Editor`
    }

    const tab: AppTab = {
      id: generateId(),
      kind: 'editor',
      title,
      projectId
    }
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
      newTabMenuOpen: false,
      projectsPageOpen: false,
      projects: project
        ? { ...state.projects, [project.id]: normalizeLoadedGenerationProject(project) }
        : state.projects
    }))
    scheduleSessionSave(get, get().tabs, tab.id, get().tabDrafts)
  },

  openProjectEditorTab: async (projectId) => {
    const existing = get().tabs.find((t) => t.kind === 'editor' && t.projectId === projectId)
    if (existing) {
      set({ activeTabId: existing.id, newTabMenuOpen: false, projectsPageOpen: false })
      scheduleSessionSave(get, get().tabs, existing.id, get().tabDrafts)
      return
    }
    await get().openEditorTab(projectId)
  },

  updateProjectGenerationLocalPath: (projectId, generationId, localPath) => {
    set((state) => {
      const current = state.projects[projectId]
      if (!current) return state
      const updated = {
        ...current,
        generations: current.generations.map((g) =>
          g.id === generationId ? { ...g, localPath } : g
        ),
        updatedAt: Date.now()
      }
      scheduleProjectSave(projectId, get)
      return { projects: { ...state.projects, [projectId]: updated } }
    })
  },

  saveVideoEditorForProject: (projectId) => {
    void import('@renderer/stores/videoEditorStore').then(({ useVideoEditorStore }) => {
      const snapshot = useVideoEditorStore.getState().getProjectSnapshot()
      get().updateProject(projectId, { videoEditor: snapshot })
    })
  },

  refreshProjectList: async () => {
    if (!window.electronAPI?.listProjects) return
    const projectList = await window.electronAPI.listProjects()
    set({ projectList })
  },

  flushProjectSaves: async () => {
    if (!window.electronAPI?.saveProject) return
    const pending = [...saveTimers.keys()]
    for (const projectId of pending) {
      const timer = saveTimers.get(projectId)
      if (timer) clearTimeout(timer)
      saveTimers.delete(projectId)
      const project = get().projects[projectId]
      if (project) {
        await window.electronAPI.saveProject(project)
      }
    }
  },

  deleteProjectAndCloseTabs: async (projectId) => {
    const deleted = await get().deleteProjectsAndCloseTabs([projectId])
    return deleted > 0
  },

  deleteProjectsAndCloseTabs: async (projectIds) => {
    if (!window.electronAPI?.deleteProject || !window.electronAPI.createProject) return 0
    const uniqueIds = [...new Set(projectIds.filter(Boolean))]
    if (uniqueIds.length === 0) return 0

    const deletedIds: string[] = []
    for (const projectId of uniqueIds) {
      const ok = await window.electronAPI.deleteProject(projectId)
      if (ok) deletedIds.push(projectId)
    }
    if (deletedIds.length === 0) return 0

    const deletedSet = new Set(deletedIds)
    let needsFallbackProject = false
    set((state) => {
      let tabs = state.tabs.filter((tab) => !deletedSet.has(tab.projectId))
      const tabDrafts = { ...state.tabDrafts }
      for (const tab of state.tabs) {
        if (deletedSet.has(tab.projectId)) delete tabDrafts[tab.id]
      }
      const projects = { ...state.projects }
      for (const projectId of deletedIds) delete projects[projectId]
      if (tabs.length === 0) {
        needsFallbackProject = true
      }
      const activeTabId = tabs.some((t) => t.id === state.activeTabId)
        ? state.activeTabId
        : tabs[0]?.id ?? ''
      return { tabs, tabDrafts, projects, activeTabId }
    })
    if (needsFallbackProject) {
      const fallback = normalizeLoadedGenerationProject(await window.electronAPI.createProject())
      const fallbackTab: AppTab = {
        id: generateId(),
        kind: 'generation',
        title: fallback.name,
        projectId: fallback.id
      }
      set((state) => ({
        tabs: [fallbackTab],
        activeTabId: fallbackTab.id,
        projects: { ...state.projects, [fallback.id]: fallback },
        tabDrafts: {
          ...state.tabDrafts,
          [fallbackTab.id]: normalizeTabComposerState(fallback.composer)
        },
        projectsPageOpen: false
      }))
    }
    scheduleSessionSave(get, get().tabs, get().activeTabId, get().tabDrafts)
    await get().refreshProjectList()
    return deletedIds.length
  },

  updateProject: (projectId, patch) => {
    set((state) => {
      const current = state.projects[projectId]
      if (!current) return state
      const updated = {
        ...current,
        ...patch,
        composer: patch.composer ? normalizeTabComposerState(patch.composer) : current.composer,
        pipeline: patch.pipeline ? normalizePipelineState(patch.pipeline) : current.pipeline,
        updatedAt: Date.now()
      }
      const tabs = state.tabs.map((tab) =>
        tab.projectId === projectId ? { ...tab, title: updated.name } : tab
      )
      scheduleProjectSave(projectId, get)
      return {
        projects: { ...state.projects, [projectId]: updated },
        tabs
      }
    })
  },

  updateProjectPipelineState: (projectId, pipeline) => {
    const normalized = normalizePipelineState(pipeline)
    set((state) => {
      const current = state.projects[projectId]
      if (!current) return state
      const generations = pruneGenerationsForPipeline(
        upsertPipelineMediaGeneration(current.generations, normalized),
        normalized
      )
      scheduleProjectSave(projectId, get)
      return {
        projects: {
          ...state.projects,
          [projectId]: {
            ...current,
            pipeline: normalized,
            generations,
            updatedAt: Date.now()
          }
        }
      }
    })
  },

  saveProjectNow: async (projectId) => {
    const timer = saveTimers.get(projectId)
    if (timer) {
      clearTimeout(timer)
      saveTimers.delete(projectId)
    }
    const project = get().projects[projectId]
    if (!project || !window.electronAPI?.saveProject) return
    const saved = await window.electronAPI.saveProject(project)
    const normalized = normalizeLoadedGenerationProject(saved)
    set((state) => ({
      projects: { ...state.projects, [projectId]: normalized }
    }))
  },

  mergeProject: (project) => {
    const normalized = normalizeLoadedGenerationProject(project)
    set((state) => {
      const tabs = state.tabs.map((tab) =>
        tab.projectId === normalized.id ? { ...tab, title: normalized.name } : tab
      )
      scheduleProjectSave(normalized.id, get)
      return {
        projects: { ...state.projects, [normalized.id]: normalized },
        tabs
      }
    })
  },

  updateTabDraft: (tabId, patch) => {
    set((state) => {
      const current = state.tabDrafts[tabId] ?? createEmptyTabComposerState()
      const nextDraft = normalizeTabComposerState({ ...current, ...patch })
      const tabDrafts = { ...state.tabDrafts, [tabId]: nextDraft }
      const projectId = projectIdForGenerationTab(state.tabs, tabId)
      let projects = state.projects
      if (projectId && state.projects[projectId]) {
        projects = {
          ...state.projects,
          [projectId]: { ...state.projects[projectId], composer: nextDraft, updatedAt: Date.now() }
        }
        scheduleProjectSave(projectId, get)
      }
      scheduleSessionSave(get, state.tabs, state.activeTabId, tabDrafts)
      return { tabDrafts, projects }
    })
  },

  updateModeDraft: (tabId, mode, patch) => {
    set((state) => {
      const current = state.tabDrafts[tabId] ?? createEmptyTabComposerState()
      const nextDraft = normalizeTabComposerState({
        ...current,
        [mode]: { ...current[mode], ...patch }
      })
      const tabDrafts = {
        ...state.tabDrafts,
        [tabId]: nextDraft
      }
      const projectId = projectIdForGenerationTab(state.tabs, tabId)
      let projects = state.projects
      if (projectId && state.projects[projectId]) {
        projects = {
          ...state.projects,
          [projectId]: { ...state.projects[projectId], composer: nextDraft, updatedAt: Date.now() }
        }
        scheduleProjectSave(projectId, get)
      }
      scheduleSessionSave(get, state.tabs, state.activeTabId, tabDrafts)
      return { tabDrafts, projects }
    })
  },

  appendImageAttachment: (tabId, media) => {
    set((state) => {
      const current = state.tabDrafts[tabId] ?? createEmptyTabComposerState()
      const nextDraft = normalizeTabComposerState({
        ...current,
        image: {
          ...current.image,
          imageAttachments: [...current.image.imageAttachments, media]
        }
      })
      const tabDrafts = {
        ...state.tabDrafts,
        [tabId]: nextDraft
      }
      const projectId = projectIdForGenerationTab(state.tabs, tabId)
      let projects = state.projects
      if (projectId && state.projects[projectId]) {
        projects = {
          ...state.projects,
          [projectId]: { ...state.projects[projectId], composer: nextDraft, updatedAt: Date.now() }
        }
        scheduleProjectSave(projectId, get)
      }
      scheduleSessionSave(get, state.tabs, state.activeTabId, tabDrafts)
      return { tabDrafts, projects }
    })
  },

  setTabMode: (tabId, mode) => {
    get().updateTabDraft(tabId, { activeMode: mode })
  },

  loadGenerationIntoTab: async (tabId, projectId, generation) => {
    let modeDraft = generationToModeDraft(generation)
    if (window.electronAPI?.hydrateGenerationDraft) {
      try {
        modeDraft = await window.electronAPI.hydrateGenerationDraft(projectId, generation)
      } catch {
        // fall back to stored draft fields
      }
    }

    const project = get().projects[projectId]
    const pipeline = project?.pipeline ? normalizePipelineState(project.pipeline) : undefined
    const segment = pipeline ? findPipelineSegmentForGeneration(pipeline, generation) : undefined

    let regenerateSegmentId: string | null = null
    if (segment && generation.type === 'image') {
      regenerateSegmentId = segment.id
      if (segment.imagePrompt.trim()) {
        modeDraft = { ...modeDraft, prompt: segment.imagePrompt }
      }
      if (pipeline?.styleLock?.visualStyle && !modeDraft.context.trim()) {
        modeDraft = { ...modeDraft, context: pipeline.styleLock.visualStyle }
      }
      modeDraft = {
        ...modeDraft,
        aspectRatio: pipeline?.styleLock?.aspectRatio ?? modeDraft.aspectRatio
      }
    } else if (segment && generation.type === 'video') {
      if (segment.videoMotionPrompt?.trim()) {
        modeDraft = { ...modeDraft, prompt: segment.videoMotionPrompt }
      }
      if (!modeDraft.videoStartFrame && segment.imageLocalPath) {
        modeDraft = {
          ...modeDraft,
          videoStartFrame: {
            id: `seg-${segment.id}-start`,
            localPath: segment.imageLocalPath,
            name: `Segment ${segment.index + 1} start`,
            previewUrl: localMediaPathUrl(segment.imageLocalPath)
          }
        }
      }
      if (segment.scriptMatch) {
        modeDraft = {
          ...modeDraft,
          scriptMatch: { ...segment.scriptMatch },
          durationSource: 'script-audio-match',
          videoDuration: Math.max(
            1,
            Math.ceil((segment.scriptMatch.durationMs || 1000) / 1000)
          )
        }
      }
      if (pipeline?.styleLock?.visualStyle && !modeDraft.context.trim()) {
        modeDraft = { ...modeDraft, context: pipeline.styleLock.visualStyle }
      }
      modeDraft = {
        ...modeDraft,
        aspectRatio: pipeline?.styleLock?.aspectRatio ?? modeDraft.aspectRatio
      }
    }

    set((state) => {
      const current = state.tabDrafts[tabId] ?? createEmptyTabComposerState()
      const nextDraft = normalizeTabComposerState({
        ...current,
        activeMode: generation.type,
        selectedGenerationId: generation.id,
        regenerateSegmentId,
        [generation.type]: modeDraft
      })
      const tabDrafts = {
        ...state.tabDrafts,
        [tabId]: nextDraft
      }
      const project = state.projects[projectId]
      const projects = project
        ? {
            ...state.projects,
            [projectId]: { ...project, composer: nextDraft, updatedAt: Date.now() }
          }
        : state.projects
      if (project) scheduleProjectSave(projectId, get)
      scheduleSessionSave(get, state.tabs, state.activeTabId, tabDrafts)
      return { tabDrafts, projects }
    })
  },


  applyRegeneratedSegmentImage: (projectId, payload) => {
    set((state) => {
      const project = state.projects[projectId]
      if (!project?.pipeline) return state

      const pipeline = normalizePipelineState(project.pipeline)
      const segmentIdx = pipeline.segments.findIndex((s) => s.id === payload.segmentId)
      if (segmentIdx < 0) return state

      const segment = pipeline.segments[segmentIdx]
      const removeIds = new Set(
        [payload.replacesGenerationId, segment.imageJobId, payload.generation.id].filter(Boolean)
      )

      const galleryPrompt = `Segment ${segment.index + 1}: ${segment.scriptText}`
      const generation: ProjectGeneration = {
        ...payload.generation,
        prompt: galleryPrompt,
        context: payload.context ?? payload.generation.context,
        useContextInPrompt:
          payload.useContextInPrompt ?? payload.generation.useContextInPrompt ?? true,
        imageAttachments: payload.imageAttachments
          ? payload.imageAttachments.map((m) => ({ ...m }))
          : payload.generation.imageAttachments,
        aspectRatio: payload.aspectRatio ?? payload.generation.aspectRatio
      }

      const segments = pipeline.segments.map((s, idx) =>
        idx === segmentIdx
          ? {
              ...s,
              imagePrompt: payload.imagePrompt,
              imageJobId: payload.generation.id,
              imageLocalPath: payload.generation.localPath,
              status: 'image_done' as const,
              pendingImageApproval: undefined,
              videoJobId: undefined,
              videoLocalPath: undefined,
              timelineClipId: undefined,
              error: undefined
            }
          : s
      )

      const generations = [
        generation,
        ...project.generations.filter((item) => !removeIds.has(item.id))
      ]

      const tabDrafts = { ...state.tabDrafts }
      for (const tab of state.tabs) {
        if (tab.kind !== 'generation' || tab.projectId !== projectId) continue
        const draft = tabDrafts[tab.id]
        if (!draft) continue
        tabDrafts[tab.id] = normalizeTabComposerState({
          ...draft,
          selectedGenerationId: generation.id,
          regenerateSegmentId: payload.segmentId,
          image: {
            ...draft.image,
            prompt: payload.imagePrompt,
            context: payload.context ?? draft.image.context,
            useContextInPrompt:
              payload.useContextInPrompt ?? draft.image.useContextInPrompt,
            imageAttachments: generation.imageAttachments
              ? generation.imageAttachments.map((m) => ({ ...m }))
              : draft.image.imageAttachments,
            aspectRatio: payload.aspectRatio ?? draft.image.aspectRatio
          }
        })
      }

      const nextProject = {
        ...project,
        generations,
        pipeline: { ...pipeline, segments },
        composer: tabDrafts[state.tabs.find((t) => t.id === state.activeTabId)?.id ?? ''] ?? project.composer,
        updatedAt: Date.now()
      }

      scheduleProjectSave(projectId, get)
      scheduleSessionSave(get, state.tabs, state.activeTabId, tabDrafts)

      return {
        projects: { ...state.projects, [projectId]: nextProject },
        tabDrafts
      }
    })
    void get().refreshProjectList()
  },


  stagePendingSegmentImage: (projectId, payload) => {
    set((state) => {
      const project = state.projects[projectId]
      if (!project?.pipeline) return state

      const pipeline = normalizePipelineState(project.pipeline)
      const segmentIdx = pipeline.segments.findIndex((s) => s.id === payload.segmentId)
      if (segmentIdx < 0) return state

      const config = payload.config
      const pending = {
        jobId: payload.generation.id,
        url: payload.generation.url,
        localPath: payload.generation.localPath,
        imagePrompt: payload.imagePrompt,
        model: payload.generation.model,
        context: config?.context ?? payload.generation.context ?? '',
        useContextInPrompt: config?.useContextInPrompt ?? true,
        imageAttachments: config?.imageAttachments
          ? config.imageAttachments.map((m) => ({ ...m }))
          : payload.generation.imageAttachments?.map((m) => ({ ...m })) ?? [],
        aspectRatio: config?.aspectRatio ?? payload.generation.aspectRatio,
        replacesGenerationId: payload.replacesGenerationId,
        createdAt: payload.generation.createdAt
      }

      const segment = pipeline.segments[segmentIdx]
      const approvedImageJobId =
        segment.imageJobId === payload.generation.id
          ? payload.replacesGenerationId ?? segment.imageJobId
          : segment.imageJobId

      const segments = pipeline.segments.map((s, idx) =>
        idx === segmentIdx
          ? {
              ...s,
              imageJobId: approvedImageJobId,
              status: 'image_pending_approval' as const,
              pendingImageApproval: pending
            }
          : s
      )

      const nextProject = {
        ...project,
        pipeline: { ...pipeline, segments },
        updatedAt: Date.now()
      }

      scheduleProjectSave(projectId, get)
      return { projects: { ...state.projects, [projectId]: nextProject } }
    })
  },

  approveSegmentImage: (projectId, segmentId) => {
    const project = get().projects[projectId]
    if (!project?.pipeline) return

    const pipeline = normalizePipelineState(project.pipeline)
    const segment = pipeline.segments.find((s) => s.id === segmentId)
    const pending = segment?.pendingImageApproval
    if (!segment || !pending) return

    const generation: ProjectGeneration = {
      id: pending.jobId,
      type: 'image',
      prompt: `Segment ${segment.index + 1}: ${segment.scriptText}`,
      model: pending.model,
      url: pending.url,
      localPath: pending.localPath,
      createdAt: pending.createdAt,
      context: pending.context,
      useContextInPrompt: pending.useContextInPrompt,
      imageAttachments: pending.imageAttachments.map((m) => ({ ...m })),
      aspectRatio: pending.aspectRatio
    }

    get().applyRegeneratedSegmentImage(projectId, {
      segmentId,
      replacesGenerationId: pending.replacesGenerationId,
      generation,
      imagePrompt: pending.imagePrompt,
      imageAttachments: pending.imageAttachments,
      context: pending.context,
      useContextInPrompt: pending.useContextInPrompt,
      aspectRatio: pending.aspectRatio
    })
  },

  discardPendingSegmentImage: (projectId, segmentId) => {
    set((state) => {
      const project = state.projects[projectId]
      if (!project?.pipeline) return state

      const pipeline = normalizePipelineState(project.pipeline)
      const segments = pipeline.segments.map((s) => {
        if (s.id !== segmentId) return s
        const restoredJobId =
          s.pendingImageApproval?.replacesGenerationId ?? s.imageJobId
        return {
          ...s,
          status: s.imageLocalPath ? ('image_done' as const) : ('pending' as const),
          pendingImageApproval: undefined,
          imageJobId: s.imageLocalPath ? restoredJobId : s.imageJobId
        }
      })

      const nextProject = {
        ...project,
        pipeline: { ...pipeline, segments },
        updatedAt: Date.now()
      }

      scheduleProjectSave(projectId, get)
      return { projects: { ...state.projects, [projectId]: nextProject } }
    })
  },

  addProjectGeneration: (projectId, generation) => {
    set((state) => {
      const current = state.projects[projectId]
      if (!current) return state
      const segmentNum = parseSegmentNumberFromPrompt(generation.prompt)
      const isVideo = generationIsVideo(generation)
      const generations = [
        generation,
        ...current.generations.filter((item) => {
          if (item.id === generation.id) return false
          if (segmentNum == null) return true
          if (parseSegmentNumberFromPrompt(item.prompt) !== segmentNum) return true
          return generationIsVideo(item) !== isVideo
        })
      ]
      const updated = {
        ...current,
        generations,
        updatedAt: Date.now()
      }
      scheduleProjectSave(projectId, get)
      return { projects: { ...state.projects, [projectId]: updated } }
    })
    void get().refreshProjectList()
  },

  deleteProjectGeneration: (projectId, generationId) => {
    set((state) => {
      const project = state.projects[projectId]
      if (!project) return state

      const pipeline = project.pipeline ? normalizePipelineState(project.pipeline) : null
      let generation = project.generations.find((item) => item.id === generationId)

      if (!generation && pipeline) {
        for (const segment of pipeline.segments) {
          if (
            generationId === `${segment.id}-image` ||
            (segment.imageJobId === generationId && segment.imageLocalPath)
          ) {
            generation = {
              id: generationId,
              type: 'image',
              prompt: `Segment ${segment.index + 1}: ${segment.scriptText}`,
              model: pipeline.imageModel ?? DEFAULT_IMAGE_MODEL,
              url: segment.imageLocalPath
                ? localMediaPathUrl(segment.imageLocalPath)
                : '',
              localPath: segment.imageLocalPath,
              createdAt: Date.now()
            }
            break
          }
          if (
            generationId === `${segment.id}-video` ||
            (segment.videoJobId === generationId && segment.videoLocalPath)
          ) {
            generation = {
              id: generationId,
              type: 'video',
              prompt: `Segment ${segment.index + 1}: ${segment.scriptText}`,
              model: pipeline.videoModel ?? DEFAULT_VIDEO_MODEL,
              url: segment.videoLocalPath
                ? localMediaPathUrl(segment.videoLocalPath)
                : '',
              localPath: segment.videoLocalPath,
              createdAt: Date.now()
            }
            break
          }
        }
        if (!generation) {
          for (const character of pipeline.characters) {
            if (
              character.anchorImageJobId === generationId ||
              generationId === `character-${character.id}`
            ) {
              if (!character.anchorImagePath) break
              generation = {
                id: generationId,
                type: 'image',
                prompt: `Character anchor: ${character.name}`,
                model: pipeline.imageModel ?? DEFAULT_IMAGE_MODEL,
                url: localMediaPathUrl(character.anchorImagePath),
                localPath: character.anchorImagePath,
                createdAt: Date.now()
              }
              break
            }
          }
        }
      }

      if (!generation) {
        const generations = project.generations.filter((item) => item.id !== generationId)
        if (generations.length === project.generations.length) return state
        scheduleProjectSave(projectId, get)
        return {
          projects: {
            ...state.projects,
            [projectId]: { ...project, generations, updatedAt: Date.now() }
          }
        }
      }

      let nextPipeline = pipeline
      const segmentNum = parseSegmentNumberFromPrompt(generation.prompt)
      const isVideo = generationIsVideo(generation)

      if (nextPipeline) {
        const segment = findPipelineSegmentForGeneration(nextPipeline, generation)
        if (segment) {
          nextPipeline = {
            ...nextPipeline,
            segments: nextPipeline.segments.map((s) => {
              if (s.id !== segment.id) return s
              if (isVideo) {
                return {
                  ...s,
                  videoLocalPath: undefined,
                  videoJobId: undefined,
                  timelineClipId: undefined,
                  status: s.imageLocalPath ? ('image_done' as const) : ('pending' as const),
                  error: undefined
                }
              }
              return {
                ...s,
                imageLocalPath: undefined,
                imageJobId: undefined,
                pendingImageApproval: undefined,
                videoLocalPath: undefined,
                videoJobId: undefined,
                timelineClipId: undefined,
                status: 'pending' as const,
                error: undefined
              }
            })
          }
        } else if (isCharacterAnchorPrompt(generation.prompt)) {
          const name = generation.prompt.replace(/^Character anchor:\s*/i, '').trim()
          nextPipeline = {
            ...nextPipeline,
            characters: nextPipeline.characters.map((character) => {
              if (
                character.anchorImageJobId !== generation.id &&
                character.name !== name &&
                `character-${character.id}` !== generation.id
              ) {
                return character
              }
              return {
                ...character,
                anchorImagePath: undefined,
                anchorImageJobId: undefined,
                anchorStatus: 'pending' as const
              }
            })
          }
        }
      }

      const generations = project.generations.filter((item) => {
        if (item.id === generation.id) return false
        if (segmentNum == null) return true
        if (parseSegmentNumberFromPrompt(item.prompt) !== segmentNum) return true
        return generationIsVideo(item) !== isVideo
      })

      const tabDrafts = { ...state.tabDrafts }
      for (const tab of state.tabs) {
        if (tab.kind !== 'generation' || tab.projectId !== projectId) continue
        const draft = tabDrafts[tab.id]
        if (!draft) continue
        const clearRegen =
          Boolean(draft.regenerateSegmentId) &&
          Boolean(
            nextPipeline?.segments.some(
              (s) => s.id === draft.regenerateSegmentId && !s.imageLocalPath && !isVideo
            )
          )
        tabDrafts[tab.id] = normalizeTabComposerState({
          ...draft,
          selectedGenerationId:
            draft.selectedGenerationId === generation.id ? null : draft.selectedGenerationId,
          regenerateSegmentId: clearRegen ? null : draft.regenerateSegmentId
        })
      }

      const nextProject = {
        ...project,
        generations,
        pipeline: nextPipeline ?? project.pipeline,
        updatedAt: Date.now()
      }
      scheduleProjectSave(projectId, get)
      scheduleSessionSave(get, state.tabs, state.activeTabId, tabDrafts)
      return {
        projects: { ...state.projects, [projectId]: nextProject },
        tabDrafts
      }
    })
    void get().refreshProjectList()

    const project = get().projects[projectId]
    if (project?.pipeline && window.electronAPI?.updateProjectPipeline) {
      void window.electronAPI.updateProjectPipeline(projectId, project.pipeline)
    }
  },

  linkEditorAudioToProject: (projectId, payload) => {
    set((state) => {
      const project = state.projects[projectId]
      if (!project) return state
      const nextComposer = normalizeTabComposerState({
        ...project.composer,
        activeMode: 'video',
        video: {
          ...project.composer.video,
          audioReference: { ...payload.media },
          linkedClipId: payload.clipId,
          linkedClipSourceInMs: payload.sourceInMs,
          linkedClipSourceOutMs: payload.sourceOutMs,
          scriptMatch: null,
          durationSource: 'manual',
          videoDuration: clampVideoDurationSeconds(
            Math.ceil((payload.sourceOutMs - payload.sourceInMs) / 1000)
          )
        }
      })
      const nextProject = { ...project, composer: nextComposer, updatedAt: Date.now() }
      const projects = { ...state.projects, [projectId]: nextProject }
      const tabDrafts = { ...state.tabDrafts }
      for (const tab of state.tabs) {
        if (tab.kind === 'generation' && tab.projectId === projectId) {
          tabDrafts[tab.id] = nextComposer
        }
      }
      scheduleProjectSave(projectId, get)
      scheduleSessionSave(get, state.tabs, state.activeTabId, tabDrafts)
      return { projects, tabDrafts }
    })
  },

  setScriptMatch: (projectId, match) => {
    set((state) => {
      const project = state.projects[projectId]
      if (!project) return state
      const nextComposer = normalizeTabComposerState({
        ...project.composer,
        video: {
          ...project.composer.video,
          scriptMatch: match,
          durationSource: match ? 'script-audio-match' : project.composer.video.durationSource
        }
      })
      const nextProject = { ...project, composer: nextComposer, updatedAt: Date.now() }
      const projects = { ...state.projects, [projectId]: nextProject }
      const tabDrafts = { ...state.tabDrafts }
      for (const tab of state.tabs) {
        if (tab.kind === 'generation' && tab.projectId === projectId) {
          tabDrafts[tab.id] = nextComposer
        }
      }
      scheduleProjectSave(projectId, get)
      scheduleSessionSave(get, state.tabs, state.activeTabId, tabDrafts)
      return { projects, tabDrafts }
    })
  },

  trackJob: (jobId, projectId, config) => {
    set((state) => ({
      pendingJobProjects: { ...state.pendingJobProjects, [jobId]: projectId },
      pendingJobConfigs: { ...state.pendingJobConfigs, [jobId]: config }
    }))
  },

  handleJobUpdate: (job) => {
    const projectId = get().pendingJobProjects[job.id]
    if (!projectId) return

    if (job.status === 'completed' && job.resultUrls[0]) {
      const type = job.category === 'video' ? 'video' : 'image'
      const config = get().pendingJobConfigs[job.id]
      const generation: ProjectGeneration = {
        id: job.id,
        type,
        prompt: config?.prompt ?? '',
        model: config?.model ?? job.model,
        url: job.resultUrls[0],
        localPath: job.localPath,
        createdAt: Date.now(),
        context: config?.context ?? '',
        useContextInPrompt: config?.useContextInPrompt ?? true,
        imageAttachments: config?.imageAttachments
          ? config.imageAttachments.map((m) => ({ ...m }))
          : undefined,
        videoStartFrame: config?.videoStartFrame ? { ...config.videoStartFrame } : undefined,
        videoDuration: config?.videoDuration,
        aspectRatio: config?.aspectRatio,
        script: config?.script,
        audioReference: config?.audioReference ? { ...config.audioReference } : undefined,
        durationSource: config?.durationSource,
        scriptMatch: config?.scriptMatch ? { ...config.scriptMatch } : undefined,
        linkedClipId: config?.linkedClipId,
        linkedClipSourceInMs: config?.linkedClipSourceInMs ?? undefined,
        linkedClipSourceOutMs: config?.linkedClipSourceOutMs ?? undefined,
        autoExtraDurationSeconds: config?.autoExtraDurationSeconds
      }

      const finishGeneration = (localPath?: string): void => {
        const resolved = localPath ? { ...generation, localPath } : generation
        if (config?.regenerateSegmentId && type === 'image') {
          get().stagePendingSegmentImage(projectId, {
            segmentId: config.regenerateSegmentId,
            generation: resolved,
            imagePrompt: config.prompt,
            config,
            replacesGenerationId: config.replacesGenerationId ?? undefined
          })
          return
        }
        get().addProjectGeneration(projectId, resolved)
      }

      if (window.electronAPI?.ensureGenerationMedia) {
        void window.electronAPI
          .ensureGenerationMedia(projectId, generation)
          .then(({ localPath }) => {
            if (!config?.regenerateSegmentId) {
              get().updateProjectGenerationLocalPath(projectId, generation.id, localPath)
            }
            finishGeneration(localPath)
          })
          .catch(() => finishGeneration())
      } else {
        finishGeneration()
      }
    }

    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      const config = get().pendingJobConfigs[job.id]
      if (
        (job.status === 'failed' || job.status === 'cancelled') &&
        config?.regenerateSegmentId
      ) {
        const project = get().projects[projectId]
        if (project?.pipeline) {
          const pipeline = normalizePipelineState(project.pipeline)
          const segmentId = config.regenerateSegmentId
          get().updateProjectPipelineState(projectId, {
            ...pipeline,
            segments: pipeline.segments.map((segment) => {
              if (segment.id !== segmentId) return segment
              if (segment.status !== 'image_running' && segment.status !== 'video_running') {
                return segment
              }
              if (segment.status === 'video_running') {
                return {
                  ...segment,
                  status: segment.videoLocalPath
                    ? ('video_done' as const)
                    : segment.imageLocalPath
                      ? ('image_done' as const)
                      : ('failed' as const),
                  error:
                    segment.videoLocalPath || segment.imageLocalPath
                      ? undefined
                      : job.status === 'cancelled'
                        ? 'Generation was cancelled'
                        : 'Generation failed'
                }
              }
              return {
                ...segment,
                status: segment.imageLocalPath ? ('image_done' as const) : ('failed' as const),
                error: segment.imageLocalPath
                  ? undefined
                  : job.status === 'cancelled'
                    ? 'Generation was cancelled'
                    : 'Generation failed'
              }
            })
          })
        }
      }

      set((state) => {
        const nextProjects = { ...state.pendingJobProjects }
        const nextConfigs = { ...state.pendingJobConfigs }
        delete nextProjects[job.id]
        delete nextConfigs[job.id]
        return { pendingJobProjects: nextProjects, pendingJobConfigs: nextConfigs }
      })
    }
  }
}))
