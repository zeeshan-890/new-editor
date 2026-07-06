import { cn } from '@renderer/lib/utils'

export type VideoInspectorTab = 'inspector' | 'export'

export function VideoInspectorTabs({
  active,
  onChange
}: {
  active: VideoInspectorTab
  onChange: (tab: VideoInspectorTab) => void
}): React.JSX.Element {
  const tabs: Array<{ id: VideoInspectorTab; label: string }> = [
    { id: 'inspector', label: 'Inspector' },
    { id: 'export', label: 'Export' }
  ]

  return (
    <div className="flex border-b border-border shrink-0">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cn(
            'flex-1 px-2 py-2 text-xs font-medium transition-colors',
            active === tab.id
              ? 'text-primary border-b-2 border-primary bg-background/40'
              : 'text-muted hover:text-foreground'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
