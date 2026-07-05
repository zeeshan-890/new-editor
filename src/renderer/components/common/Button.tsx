import { cn } from '@renderer/lib/utils'
import type { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive'
  size?: 'sm' | 'md' | 'icon'
}

export function Button({
  className,
  variant = 'default',
  size = 'md',
  ...props
}: ButtonProps): React.JSX.Element {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none',
        variant === 'default' && 'bg-primary text-white hover:bg-accent',
        variant === 'outline' && 'border border-border bg-transparent hover:bg-card',
        variant === 'ghost' && 'hover:bg-card',
        variant === 'destructive' && 'bg-destructive text-white hover:bg-red-600',
        size === 'sm' && 'h-8 px-3 text-xs',
        size === 'md' && 'h-9 px-4 text-sm',
        size === 'icon' && 'h-9 w-9',
        className
      )}
      {...props}
    />
  )
}
