/** Detect CLI / IPC errors that mean the user must sign in again. */
export function isHiggsfieldAuthFailureMessage(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('session expired') ||
    m.includes('not authenticated') ||
    m.includes('not connected to higgsfield') ||
    m.includes('hf auth login') ||
    m.includes('run: hf auth login')
  )
}

export const HIGGSFIELD_RECONNECT_MESSAGE =
  'Higgsfield session expired. Click Reconnect, finish login in your browser, then click Refresh account.'
