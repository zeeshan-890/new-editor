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
      {galleryCounts.images + galleryCounts.clips + galleryCounts.characters > 0
        ? ` · ${galleryCounts.characters} chars · ${galleryCounts.images} images · ${galleryCounts.clips} videos`
        : ''}
      {inProgress > 0 ? ` · ${inProgress} in progress` : ''}
      )
    </span>
  )
})
