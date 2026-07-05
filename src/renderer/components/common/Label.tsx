import { cn } from '@renderer/lib/utils'

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>): React.JSX.Element {
  return (
    <label className={cn('text-xs font-medium text-muted block mb-1', className)} {...props} />
  )
}
