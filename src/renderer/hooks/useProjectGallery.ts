import { useMemo } from 'react'
import { useProjectTabStore } from '@renderer/stores/projectTabStore'
import { useHiggsfieldStore } from '@renderer/stores/higgsfieldStore'
import {
  flattenGalleryGenerations,
  gallerySectionCounts,
  organizeProjectGallery,
  type ProjectGallerySections
} from '@renderer/lib/projectGallerySections'
import {
  createEmptyPipelineState,
  normalizePipelineState
} from '@shared/segmentPipeline'

const EMPTY_COUNTS = {
  total: 0,
  characters: 0,
  images: 0,
  clips: 0,
  other: 0
}

export function useProjectGallery(projectId: string): {
  gallerySections: ProjectGallerySections
  galleryCounts: typeof EMPTY_COUNTS
  lightboxCatalog: ReturnType<typeof flattenGalleryGenerations>
} {
  const generations = useProjectTabStore((s) => s.projects[projectId]?.generations)
  const pipelineRaw = useProjectTabStore((s) => s.projects[projectId]?.pipeline)
  const pendingJobProjects = useProjectTabStore((s) => s.pendingJobProjects)
  const pendingJobConfigs = useProjectTabStore((s) => s.pendingJobConfigs)
  const jobs = useHiggsfieldStore((s) => s.jobs)

  const pipeline = useMemo(
    () => normalizePipelineState(pipelineRaw ?? createEmptyPipelineState()),
    [pipelineRaw]
  )

  const activeJobs = useMemo(
    () =>
      jobs.filter(
        (job) =>
          pendingJobProjects[job.id] === projectId &&
          (job.status === 'queued' || job.status === 'running')
      ),
    [jobs, pendingJobProjects, projectId]
  )

  const trackedJobIds = useMemo(
    () => new Set(activeJobs.map((job) => job.id)),
    [activeJobs]
  )

  const gallerySections = useMemo(
    () =>
      organizeProjectGallery({
        pipeline,
        generations: generations ?? [],
        activeJobs,
        pendingJobConfigs,
        trackedJobIds
      }),
    [pipeline, generations, activeJobs, pendingJobConfigs, trackedJobIds]
  )

  const galleryCounts = useMemo(
    () => gallerySectionCounts(gallerySections),
    [gallerySections]
  )

  const lightboxCatalog = useMemo(
    () => flattenGalleryGenerations(gallerySections),
    [gallerySections]
  )

  return { gallerySections, galleryCounts, lightboxCatalog }
}
