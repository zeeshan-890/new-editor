import { app } from 'electron'
import { promises as fs } from 'fs'
import { join, basename, extname } from 'path'
import type { AppSession, GenerationProject, ProjectSummary } from '../../shared/types'
import { createEmptyGenerationProject } from '../../shared/types'

function projectsRoot(): string {
  return join(app.getPath('userData'), 'projects')
}

function projectDir(id: string): string {
  return join(projectsRoot(), id)
}

function projectFilePath(id: string): string {
  return join(projectDir(id), 'project.json')
}

function sessionPath(): string {
  return join(app.getPath('userData'), 'session.json')
}

export function mediaDir(projectId: string): string {
  return join(projectDir(projectId), 'media')
}

async function ensureDir(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true })
}

export async function listProjectSummaries(): Promise<ProjectSummary[]> {
  await ensureDir(projectsRoot())
  const entries = await fs.readdir(projectsRoot(), { withFileTypes: true })
  const summaries: ProjectSummary[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const raw = await fs.readFile(projectFilePath(entry.name), 'utf-8')
      const project = JSON.parse(raw) as GenerationProject
      summaries.push({
        id: project.id,
        name: project.name,
        updatedAt: project.updatedAt,
        generationCount: project.generations?.length ?? 0,
        mode: project.composer?.activeMode ?? project.mode ?? 'image'
      })
    } catch {
      // skip invalid project folders
    }
  }

  return summaries.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function loadProject(projectId: string): Promise<GenerationProject | null> {
  try {
    const raw = await fs.readFile(projectFilePath(projectId), 'utf-8')
    return JSON.parse(raw) as GenerationProject
  } catch {
    return null
  }
}

export async function saveProject(project: GenerationProject): Promise<GenerationProject> {
  await ensureDir(projectDir(project.id))
  await ensureDir(mediaDir(project.id))
  const next = { ...project, updatedAt: Date.now() }
  await fs.writeFile(projectFilePath(project.id), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

export async function createProject(name?: string): Promise<GenerationProject> {
  const project = createEmptyGenerationProject(name)
  return saveProject(project)
}

export async function deleteProject(projectId: string): Promise<boolean> {
  try {
    await fs.rm(projectDir(projectId), { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

export async function importMediaToProject(
  projectId: string,
  sourcePath: string
): Promise<{ localPath: string; name: string }> {
  await ensureDir(mediaDir(projectId))
  const ext = extname(sourcePath) || '.bin'
  const destName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
  const dest = join(mediaDir(projectId), destName)
  await fs.copyFile(sourcePath, dest)
  return { localPath: dest, name: basename(sourcePath) }
}

export async function importMediaBytesToProject(
  projectId: string,
  fileName: string,
  data: ArrayBuffer | Uint8Array
): Promise<{ localPath: string; name: string }> {
  await ensureDir(mediaDir(projectId))
  const ext = extname(fileName) || '.png'
  const destName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
  const dest = join(mediaDir(projectId), destName)
  await fs.writeFile(dest, Buffer.from(data))
  return { localPath: dest, name: basename(fileName) }
}

export async function loadSession(): Promise<AppSession | null> {
  try {
    const raw = await fs.readFile(sessionPath(), 'utf-8')
    return JSON.parse(raw) as AppSession
  } catch {
    return null
  }
}

export async function saveSession(session: AppSession): Promise<void> {
  await fs.writeFile(sessionPath(), JSON.stringify(session, null, 2), 'utf-8')
}
