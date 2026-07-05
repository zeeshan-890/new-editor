/** Load local disk files in the renderer (file:// is blocked from http dev origins). */
export function localMediaPathUrl(path: string): string {
  if (!path) return ''
  if (/^https?:\/\//i.test(path)) return path
  const normalized = path.replace(/\\/g, '/')
  return `local-media://file/${encodeURIComponent(normalized)}`
}

/** @deprecated Use localMediaPathUrl — kept for local-audio:// callers */
export function localAudioPathUrl(path: string): string {
  if (!path) return ''
  const normalized = path.replace(/\\/g, '/')
  return `local-audio://file/${encodeURIComponent(normalized)}`
}
