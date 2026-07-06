import { createPortal } from 'react-dom'
import { cn } from '@renderer/lib/utils'

export function Dialog({
  open,
  onClose,
  title,
  children
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}): React.JSX.Element | null {
  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-xl mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground text-xl leading-none">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  )
}

export function DialogRow({ label, keys }: { label: string; keys: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50 text-sm">
      <span className="text-muted">{label}</span>
      <kbd className={cn('px-2 py-0.5 rounded bg-background border border-border text-xs font-mono')}>
        {keys}
      </kbd>
    </div>
  )
}
