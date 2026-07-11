import type { HiggsfieldGenerationJob } from '@shared/types'
import type { PipelineLogEvent } from '@shared/pipelineDebug'
import { useHiggsfieldStore } from '@renderer/stores/higgsfieldStore'
import { useProjectTabStore } from '@renderer/stores/projectTabStore'
import { usePipelineStore } from '@renderer/stores/pipelineStore'
import { printPipelineLog, printPipelineStateUpdate } from '@renderer/lib/pipelineConsole'

function mergeJob(
  jobs: HiggsfieldGenerationJob[],
  updated: HiggsfieldGenerationJob
): HiggsfieldGenerationJob[] {
  const idx = jobs.findIndex((job) => job.id === updated.id)
  if (idx >= 0) {
    const next = [...jobs]
    next[idx] = updated
    return next
  }
  return [updated, ...jobs]
}

function computeQueueStats(jobs: HiggsfieldGenerationJob[]): { queued: number; running: number } {
  return {
    queued: jobs.filter((job) => job.status === 'queued').length,
    running: jobs.filter((job) => job.status === 'running').length
  }
}

let started = false
let cleanup: (() => void) | null = null

/** App-level listeners so generation and pipeline keep updating when tabs change. */
export function startBackgroundServices(): () => void {
  if (started && cleanup) return cleanup
  started = true

  const unsubHiggsfield = window.electronAPI?.onHiggsfieldJobUpdated?.((job) => {
    useHiggsfieldStore.setState((state) => {
      const jobs = mergeJob(state.jobs, job)
      return { jobs, queueStats: computeQueueStats(jobs) }
    })
    useProjectTabStore.getState().handleJobUpdate(job)
  })

  const unsubPipeline = window.electronAPI?.onPipelineUpdated?.((payload) => {
    usePipelineStore.getState().handlePipelineUpdated(payload.projectId, payload.pipeline)
  })

  const unsubPipelineLog = window.electronAPI?.onPipelineLog?.((event: PipelineLogEvent) => {
    printPipelineLog(event)
  })

  void useHiggsfieldStore.getState().syncJobs()

  for (const [projectId, project] of Object.entries(useProjectTabStore.getState().projects)) {
    if (project.pipeline?.pipelineStatus === 'running') {
      usePipelineStore.getState().handlePipelineUpdated(projectId, project.pipeline)
    }
  }

  cleanup = () => {
    unsubHiggsfield?.()
    unsubPipeline?.()
    unsubPipelineLog?.()
    started = false
    cleanup = null
  }
  return cleanup
}
