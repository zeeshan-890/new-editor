/** Decode paths from custom local-media / local-video / local-audio protocol URLs. */
export function decodeLocalProtocolPath(requestUrl: string, scheme: string): string {
  try {
    const url = new URL(requestUrl)
    if (url.protocol === `${scheme}:`) {
      let pathPart = decodeURIComponent(url.pathname)
      if (pathPart.startsWith('/file/')) {
        pathPart = pathPart.slice('/file/'.length)
      } else if (pathPart.startsWith('/')) {
        pathPart = pathPart.slice(1)
      }
      if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(pathPart)) {
        pathPart = pathPart.slice(1)
      }
      if (pathPart) return pathPart
    }
  } catch {
    // fall through to legacy parsing
  }

  const marker = `${scheme}://`
  if (!requestUrl.startsWith(marker)) {
    return decodeURIComponent(requestUrl)
  }

  let rest = requestUrl.slice(marker.length)

  if (rest.startsWith('file/')) {
    rest = rest.slice('file/'.length)
  }

  let decoded = decodeURIComponent(rest)

  if (process.platform === 'win32' && decoded.startsWith('/') && /^\/[a-zA-Z]:/.test(decoded)) {
    decoded = decoded.slice(1)
  }

  return decoded
}

export function localProtocolFileCallback(
  requestUrl: string,
  scheme: string,
  callback: (response: { path: string } | { error: number }) => void
): void {
  try {
    callback({ path: decodeLocalProtocolPath(requestUrl, scheme) })
  } catch {
    callback({ error: -2 })
  }
}
