import { cn } from '@renderer/lib/utils'

export type InspectorTab = 'silence' | 'higgsfield' | 'export'

export function InspectorTabs({
  active,
  onChange,
  editorOnly = false
}: {
  active: InspectorTab
  onChange: (tab: InspectorTab) => void
  editorOnly?: boolean
}): React.JSX.Element {
  const tabs: Array<{ id: InspectorTab; label: string }> = editorOnly
    ? [
        { id: 'silence', label: 'Silence' },
        { id: 'export', label: 'Export' }
      ]
    : [
        { id: 'silence', label: 'Silence' },
        { id: 'higgsfield', label: 'Higgsfield' },
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
