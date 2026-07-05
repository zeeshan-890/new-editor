import { cn } from '@renderer/lib/utils'

export function Switch({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 rounded-full border border-border transition-colors',
          checked ? 'bg-primary' : 'bg-card'
        )}
      >
        <span
          className={cn(
            'pointer-events-none block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5',
            checked ? 'translate-x-4' : 'translate-x-0.5'
          )}
        />
      </button>
      {label && <span className="text-muted text-xs">{label}</span>}
    </label>
  )
}
