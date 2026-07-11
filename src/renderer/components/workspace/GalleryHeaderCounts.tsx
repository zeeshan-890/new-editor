import { memo } from 'react'
import { useProjectGallery } from '@renderer/hooks/useProjectGallery'

export const GalleryHeaderCounts = memo(function GalleryHeaderCounts({
  projectId,
  inProgress
}: {
  projectId: string
  inProgress: number
}): React.JSX.Element {
  const { galleryCounts } = useProjectGallery(projectId)

  return (
    <span className="text-sm font-medium truncate">
      Project gallery ({galleryCounts.total}
      {galleryCounts.images + galleryCounts.clips > 0
        ? ` · ${galleryCounts.images} images · ${galleryCounts.clips} clips`
        : ''}
      {inProgress > 0 ? ` · ${inProgress} in progress` : ''}
      )
    </span>
  )
})
