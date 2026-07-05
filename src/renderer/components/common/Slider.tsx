import { cn } from '@renderer/lib/utils'

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  className
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  className?: string
}): React.JSX.Element {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className={cn('w-full accent-primary h-1.5 cursor-pointer', className)}
    />
  )
}
