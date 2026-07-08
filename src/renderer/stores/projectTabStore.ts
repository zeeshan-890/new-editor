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
  generateId,
  generationToModeDraft,
  clampVideoDurationSeconds,
  normalizeGenerationProject,
  normalizeTabComposerState
} from '@shared/types'
import { isLegacyDefaultImageModel, shouldUseDefaultImageModel } from '@shared/imageModels'

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

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
  updateProject: (projectId: string, patch: Partial<GenerationProject>) => void
  updateTabDraft: (tabId: string, patch: Partial<TabComposerState>) => void
  updateModeDraft: (tabId: string, mode: GenerationMode, patch: Partial<GenerationModeDraft>) => void
  appendImageAttachment: (tabId: string, media: ProjectMedia) => void
  setTabMode: (tabId: string, mode: GenerationMode) => void
  loadGenerationIntoTab: (tabId: string, projectId: string, generation: ProjectGeneration) => Promise<void>
  addProjectGeneration: (projectId: string, generation: ProjectGeneration) => void
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
          if (loaded) projects[tab.projectId] = normalizeGenerationProject(loaded)
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
        projects[project.id] = normalizeGenerationProject(project)
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
    const project = normalizeGenerationProject(await window.electronAPI.createProject())
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

    let project = get().projects[projectId]
    if (!project) {
      const loaded = await window.electronAPI.loadProject(projectId)
      if (!loaded) return
      project = normalizeGenerationProject(loaded)
    }

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
        if (loaded) project = normalizeGenerationProject(loaded)
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
        ? { ...state.projects, [project.id]: normalizeGenerationProject(project) }
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
    if (!window.electronAPI?.deleteProject || !window.electronAPI.createProject) return false
    const ok = await window.electronAPI.deleteProject(projectId)
    if (!ok) return false
    let needsFallbackProject = false
    set((state) => {
      let tabs = state.tabs.filter((tab) => tab.projectId !== projectId)
      const tabDrafts = { ...state.tabDrafts }
      for (const tab of state.tabs) {
        if (tab.projectId === projectId) delete tabDrafts[tab.id]
      }
      const projects = { ...state.projects }
      delete projects[projectId]
      if (tabs.length === 0) {
        needsFallbackProject = true
      }
      const activeTabId = tabs.some((t) => t.id === state.activeTabId)
        ? state.activeTabId
        : tabs[0]?.id ?? ''
      return { tabs, tabDrafts, projects, activeTabId }
    })
    if (needsFallbackProject) {
      const fallback = normalizeGenerationProject(await window.electronAPI.createProject())
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
        tabDrafts: { ...state.tabDrafts, [fallbackTab.id]: normalizeTabComposerState(fallback.composer) },
        projectsPageOpen: false
      }))
    }
    scheduleSessionSave(get, get().tabs, get().activeTabId, get().tabDrafts)
    await get().refreshProjectList()
    return true
  },

  updateProject: (projectId, patch) => {
    set((state) => {
      const current = state.projects[projectId]
      if (!current) return state
      const updated = {
        ...current,
        ...patch,
        composer: patch.composer ? normalizeTabComposerState(patch.composer) : current.composer,
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
    set((state) => {
      const current = state.tabDrafts[tabId] ?? createEmptyTabComposerState()
      const nextDraft = normalizeTabComposerState({
        ...current,
        activeMode: generation.type,
        selectedGenerationId: generation.id,
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

  addProjectGeneration: (projectId, generation) => {
    set((state) => {
      const current = state.projects[projectId]
      if (!current) return state
      const updated = {
        ...current,
        generations: [generation, ...current.generations],
        updatedAt: Date.now()
      }
      scheduleProjectSave(projectId, get)
      return { projects: { ...state.projects, [projectId]: updated } }
    })
    void get().refreshProjectList()
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
      get().addProjectGeneration(projectId, generation)
      if (window.electronAPI?.ensureGenerationMedia) {
        void window.electronAPI
          .ensureGenerationMedia(projectId, generation)
          .then(({ localPath }) => {
            get().updateProjectGenerationLocalPath(projectId, generation.id, localPath)
          })
          .catch(() => {})
      }
    }

    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
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
