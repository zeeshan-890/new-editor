import type {
  HiggsfieldEnqueueRequest,
  HiggsfieldGenerationJob,
  HiggsfieldReferenceImage
} from '../../shared/types'
import { generateId } from '../../shared/types'
import { existsSync } from 'fs'
import { downloadMedia } from './cli'
import {
  formatHiggsfieldError,
  generateHiggsfieldContent,
  getHiggsfieldModelSchema,
  validateGenerateRequest
} from './service'
import { ensureReferencesInProject } from '../projects/media'

const MAX_CONCURRENCY = Number.POSITIVE_INFINITY

type JobUpdateCallback = (job: HiggsfieldGenerationJob) => void

const jobs = new Map<string, HiggsfieldGenerationJob>()
const pendingRequests = new Map<string, HiggsfieldEnqueueRequest>()
const pendingQueue: string[] = []
let runningCount = 0
let isPumping = false
let notifyCallback: JobUpdateCallback | null = null

export function setJobUpdateCallback(callback: JobUpdateCallback | null): void {
  notifyCallback = callback
}

function emit(job: HiggsfieldGenerationJob): void {
  notifyCallback?.({ ...job })
}

function normalizeRefPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

function isHttpUrl(url: string | undefined): url is string {
  return Boolean(url && /^https?:\/\//i.test(url))
}

async function resolveReferences(
  refs: HiggsfieldReferenceImage[]
): Promise<HiggsfieldReferenceImage[]> {
  const resolved: HiggsfieldReferenceImage[] = []
  const seenPaths = new Set<string>()

  for (const ref of refs) {
    const normalizedPath = ref.localPath ? normalizeRefPath(ref.localPath) : ''
    const pathAlreadyUsed = normalizedPath !== '' && seenPaths.has(normalizedPath)
    const remoteUrl = isHttpUrl(ref.url) ? ref.url : undefined

    if (ref.localPath && existsSync(ref.localPath) && !pathAlreadyUsed) {
      resolved.push(ref)
      seenPaths.add(normalizedPath)
      continue
    }

    if (pathAlreadyUsed && remoteUrl) {
      const localPath = await downloadMedia(remoteUrl)
      resolved.push({ ...ref, localPath, url: remoteUrl })
      seenPaths.add(normalizeRefPath(localPath))
      continue
    }

    if (remoteUrl) {
      const localPath = await downloadMedia(remoteUrl)
      resolved.push({ ...ref, localPath, url: remoteUrl })
      seenPaths.add(normalizeRefPath(localPath))
      continue
    }

    if (ref.localPath) {
      throw new Error(
        `Reference image not found on disk: ${ref.localPath}. Remove and re-attach the image.`
      )
    }

    throw new Error(
      `Reference "${ref.label ?? ref.id}" is missing a file and download URL. Remove and re-attach it.`
    )
  }

  return resolved
}

export async function resolveReferenceUrl(
  url: string
): Promise<{ url: string; localPath: string }> {
  const localPath = await downloadMedia(url)
  return { url, localPath }
}

export function listJobs(): HiggsfieldGenerationJob[] {
  return Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt)
}

export function cancelJob(jobId: string): boolean {
  const job = jobs.get(jobId)
  if (!job || job.status !== 'queued') return false
  job.status = 'cancelled'
  job.completedAt = Date.now()
  pendingRequests.delete(jobId)
  const idx = pendingQueue.indexOf(jobId)
  if (idx >= 0) pendingQueue.splice(idx, 1)
  emit(job)
  return true
}

export async function enqueueJob(request: HiggsfieldEnqueueRequest): Promise<HiggsfieldGenerationJob> {
  let refs = request.references ?? []
  if (request.projectId && refs.length > 0) {
    refs = await ensureReferencesInProject(request.projectId, refs)
  }
  refs = await resolveReferences(refs)

  const requestedCount = request.references?.length ?? 0
  if (requestedCount > 0 && refs.length !== requestedCount) {
    throw new Error(
      `Only ${refs.length} of ${requestedCount} attached images could be resolved. Remove and re-attach them, then try again.`
    )
  }

  if (request.category === 'image') {
    const schema = await getHiggsfieldModelSchema(request.model)
    const validationError = validateGenerateRequest(
      {
        model: request.model,
        prompt: request.prompt,
        referencePaths: refs.map((r) => r.localPath).filter(Boolean) as string[]
      },
      schema
    )
    if (validationError) {
      throw new Error(validationError)
    }
  }

  const job: HiggsfieldGenerationJob = {
    id: generateId(),
    status: 'queued',
    model: request.model,
    prompt: request.prompt,
    category: request.category,
    workspaceId: request.workspaceId,
    references: refs,
    resultUrls: [],
    createdAt: Date.now(),
    parentJobId: request.parentJobId,
    progressMessage: 'Queued…'
  }

  jobs.set(job.id, job)
  pendingRequests.set(job.id, request)
  pendingQueue.push(job.id)
  emit(job)
  pump()
  return job
}

function pump(): void {
  if (isPumping) return
  isPumping = true
  void runPump().finally(() => {
    isPumping = false
  })
}

async function runPump(): Promise<void> {
  while (pendingQueue.length > 0) {
    if (runningCount >= MAX_CONCURRENCY) break

    const jobId = pendingQueue.shift()
    if (!jobId) break

    const job = jobs.get(jobId)
    const request = pendingRequests.get(jobId)
    if (!job || !request || job.status !== 'queued') continue

    runningCount++
    job.status = 'running'
    job.startedAt = Date.now()
    job.progressMessage = 'Starting generation…'
    emit(job)

    void executeJob(job, request).finally(() => {
      runningCount--
      pendingRequests.delete(jobId)
      void runPump()
    })
  }
}

async function executeJob(
  job: HiggsfieldGenerationJob,
  request: HiggsfieldEnqueueRequest
): Promise<void> {
  const referencePaths = job.references
    .map((ref) => ref.localPath)
    .filter((path): path is string => Boolean(path))

  if (job.references.length > 0 && referencePaths.length !== job.references.length) {
    job.status = 'failed'
    job.error =
      'Some attached reference images could not be loaded. Remove them and attach again, then retry.'
    job.completedAt = Date.now()
    job.progressMessage = undefined
    emit(job)
    return
  }

  if (job.references.length > 0 && referencePaths.length === 0) {
    job.status = 'failed'
    job.error =
      'Attached reference images could not be loaded. Remove them and attach again, then retry.'
    job.completedAt = Date.now()
    job.progressMessage = undefined
    emit(job)
    return
  }

  try {
    const result = await generateHiggsfieldContent(
      {
        model: job.model,
        prompt: job.prompt,
        category: job.category,
        workspaceId: job.workspaceId ?? request.workspaceId,
        params: request.params,
        referencePaths,
        mediaPath: request.mediaPath,
        mediaFlag: request.mediaFlag,
        wait: request.wait ?? true,
        waitTimeout: request.waitTimeout,
        importAudio: request.importAudio ?? job.category === 'audio'
      },
      (message) => {
        job.progressMessage = message
        emit(job)
      }
    )

    job.status = 'completed'
    job.resultUrls = result.resultUrls
    job.localPath = result.localPath
    job.completedAt = Date.now()
    job.progressMessage = 'Complete'
  } catch (err) {
    job.status = 'failed'
    job.error = formatHiggsfieldError(err)
    job.completedAt = Date.now()
    job.progressMessage = undefined
  }

  emit(job)
}
