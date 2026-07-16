import { useMemo } from 'react'
import type { HiggsfieldJobStatus } from '@shared/types'
import { useHiggsfieldStore } from '@renderer/stores/higgsfieldStore'
import type { HiggsfieldJobStatusLookup } from '@renderer/components/pipeline/pipelineSegmentUi'

export function useHiggsfieldJobById(): HiggsfieldJobStatusLookup {
  const jobs = useHiggsfieldStore((s) => s.jobs)
  return useMemo(
    () =>
      new Map<string, { status: HiggsfieldJobStatus }>(
        jobs.map((job) => [job.id, { status: job.status }])
      ),
    [jobs]
  )
}
