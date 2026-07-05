import { cn } from '@renderer/lib/utils'

export function Select<T extends string>({
  value,
  onChange,
  options,
  className
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: string }>
  className?: string
}): React.JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={cn(
        'w-full h-9 rounded-md border border-border bg-card px-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary',
        className
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
