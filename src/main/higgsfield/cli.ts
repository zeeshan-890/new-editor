import { spawn } from 'child_process'
import { createWriteStream, existsSync } from 'fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'os'
import { dirname, join, extname } from 'path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'stream/promises'
import https from 'https'
import http from 'http'
import { logError, logWarn } from '../logger'
import { spawnablePath, packagedNodeModulePath } from '../appPaths'
import { HiggsfieldCliError } from './errors'
import { parseHiggsfieldJson } from './json-output'
import { isHiggsfieldAuthFailureMessage } from '../../shared/higgsfieldAuth'

export { HiggsfieldCliError } from './errors'

let cachedBin: string | null = null

const HF_BIN = process.platform === 'win32' ? 'hf.exe' : 'hf'

function moduleRoot(): string {
  if (typeof __dirname !== 'undefined') return __dirname
  return dirname(fileURLToPath(import.meta.url))
}

function vendorRelativeToMain(): string {
  return join(moduleRoot(), '../../node_modules/@higgsfield/cli/vendor', HF_BIN)
}

function resolveViaEnvOrBundled(): string | null {
  const envPath = process.env.HIGGSFIELD_CLI_PATH
  if (envPath && existsSync(envPath)) return spawnablePath(envPath)

  const packaged = packagedNodeModulePath('@higgsfield', 'cli', 'vendor', HF_BIN)
  if (packaged) return packaged

  const bundled = spawnablePath(vendorRelativeToMain())
  if (existsSync(bundled)) return bundled

  return null
}

function resolveViaPackageJson(): string | null {
  const roots = [
    join(moduleRoot(), '../..'),
    process.env.INIT_CWD,
    process.cwd(),
    join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm')
  ].filter(Boolean) as string[]

  for (const root of roots) {
    const pkgJson = join(root, 'package.json')
    if (!existsSync(pkgJson)) continue

    try {
      const req = createRequire(pkgJson)
      const pkgPath = req.resolve('@higgsfield/cli/package.json')
      const bin = spawnablePath(join(dirname(pkgPath), 'vendor', HF_BIN))
      if (existsSync(bin)) return bin
    } catch {
      // try next root
    }
  }

  return null
}

function resolveViaDirectPaths(): string | null {
  const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
  const candidates = [
    vendorRelativeToMain(),
    join(process.cwd(), 'node_modules/@higgsfield/cli/vendor', HF_BIN),
    join(appData, 'npm/node_modules/@higgsfield/cli/vendor', HF_BIN)
  ]

  for (const candidate of candidates) {
    const bin = spawnablePath(candidate)
    if (existsSync(bin)) return bin
  }

  return null
}

function resolveHiggsfieldBinary(): string {
  if (cachedBin && existsSync(cachedBin)) return cachedBin

  const resolved =
    resolveViaEnvOrBundled() ?? resolveViaPackageJson() ?? resolveViaDirectPaths()

  if (resolved) {
    cachedBin = resolved
    return resolved
  }

  throw new HiggsfieldCliError(
    'Higgsfield CLI not found. Run: npm install @higgsfield/cli'
  )
}

function runCommand(args: string[], timeoutMs = 600_000): Promise<{ stdout: string; stderr: string }> {
  const bin = resolveHiggsfieldBinary()

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, env: process.env })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    const timer = setTimeout(() => {
      child.kill()
      reject(new HiggsfieldCliError(`Higgsfield CLI timed out after ${timeoutMs}ms`, stderr))
    }, timeoutMs)

    child.on('error', (err) => {
      clearTimeout(timer)
      logError('higgsfield:cli', err, { args, bin })
      reject(new HiggsfieldCliError(`Failed to run higgsfield CLI: ${err.message}`, stderr))
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      const out = stdout.trim()
      const errOut = stderr.trim()
      const output = out || errOut
      if (code !== 0) {
        logWarn('higgsfield:cli', output || `Exit code ${code}`, {
          args,
          code,
          stdout: stdout.slice(0, 2000),
          stderr: stderr.slice(0, 2000)
        })
        reject(new HiggsfieldCliError(output || `Higgsfield exited with code ${code}`, output))
        return
      }
      if (!output) {
        reject(new HiggsfieldCliError('Higgsfield CLI returned no output', ''))
        return
      }
      resolve({ stdout: out || errOut, stderr: errOut })
    })
  })
}

export async function runHiggsfieldJson<T>(args: string[], timeoutMs?: number): Promise<T> {
  const { stdout, stderr } = await runCommand([...args, '--json', '--no-color'], timeoutMs)
  try {
    return parseHiggsfieldJson<T>(stdout, stderr)
  } catch (err) {
    logError('higgsfield:json', err, {
      args,
      stdout: stdout.slice(0, 4000),
      stderr: stderr.slice(0, 4000)
    })
    throw err
  }
}

export async function runHiggsfield(args: string[], timeoutMs?: number): Promise<string> {
  const { stdout } = await runCommand(args, timeoutMs)
  return stdout.trim()
}

export function startHiggsfieldLogin(): void {
  const bin = resolveHiggsfieldBinary()
  const child = spawn(bin, ['auth', 'login'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    env: process.env
  })
  child.unref()
}

function isThumbnailUrl(url: string): boolean {
  return /_min\.(webp|png|jpe?g|gif)/i.test(url)
}

function isVideoMediaUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(\?|$)/i.test(url)
}

function isOutputMediaUrl(url: string): boolean {
  return /\.(wav|mp3|m4a|ogg|aac|flac|mp4|webm|mov|png|jpe?g|gif)(\?|$)/i.test(url)
}

function collectInputMediaUrls(raw: Record<string, unknown>): Set<string> {
  const inputs = new Set<string>()
  const params = raw.params
  if (!params || typeof params !== 'object') return inputs

  const medias = (params as Record<string, unknown>).medias
  if (!Array.isArray(medias)) return inputs

  for (const media of medias) {
    if (!media || typeof media !== 'object') continue
    const data = (media as Record<string, unknown>).data
    if (data && typeof data === 'object') {
      const url = (data as Record<string, unknown>).url
      if (typeof url === 'string' && url) inputs.add(url)
    }
  }
  return inputs
}

export interface ExtractResultUrlsOptions {
  preferVideo?: boolean
}

export function extractResultUrls(data: unknown, options?: ExtractResultUrlsOptions): string[] {
  if (!data || typeof data !== 'object') return []
  const raw = data as Record<string, unknown>
  const preferVideo = options?.preferVideo ?? false
  const inputUrls = collectInputMediaUrls(raw)
  const urls = new Set<string>()

  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (/^https?:\/\//i.test(value) && isOutputMediaUrl(value)) {
        urls.add(value)
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(visit)
    }
  }

  visit(data)

  const filtered = [...urls].filter(
    (url) => !isThumbnailUrl(url) && !inputUrls.has(url)
  )

  const directResult =
    typeof raw.result_url === 'string' && raw.result_url && !isThumbnailUrl(raw.result_url)
      ? raw.result_url
      : null

  if (directResult) {
    const rest = filtered.filter((url) => url !== directResult)
    return [directResult, ...rest]
  }

  if (preferVideo) {
    const videos = filtered.filter(isVideoMediaUrl)
    if (videos.length > 0) {
      const rest = filtered.filter((url) => !videos.includes(url))
      return [...videos, ...rest]
    }
  }

  return filtered
}

export function pickPrimaryResultUrl(
  data: unknown,
  urls: string[],
  options?: ExtractResultUrlsOptions
): string | undefined {
  if (!urls.length) return undefined
  if (!data || typeof data !== 'object') return urls[0]

  const raw = data as Record<string, unknown>
  const preferVideo = options?.preferVideo ?? false

  if (
    typeof raw.result_url === 'string' &&
    raw.result_url &&
    !isThumbnailUrl(raw.result_url)
  ) {
    return raw.result_url
  }

  if (preferVideo) {
    return urls.find(isVideoMediaUrl) ?? urls[0]
  }

  return urls.find((url) => !isVideoMediaUrl(url)) ?? urls[0]
}

export async function uploadLocalMedia(filePath: string): Promise<string> {
  const normalized = filePath.replace(/\\/g, '/')
  const result = await runHiggsfieldJson<{ id?: string }>(['upload', 'create', normalized], 120_000)
  const id = result?.id
  if (!id) {
    throw new HiggsfieldCliError('Higgsfield upload did not return a media ID')
  }
  return id
}

export async function downloadMedia(url: string): Promise<string> {
  const ext = extname(new URL(url).pathname) || '.bin'

  const fetchToDest = (targetUrl: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const dest = join(tmpdir(), `higgsfield-${Date.now()}${ext}`)
      const client = targetUrl.startsWith('https') ? https : http
      client
        .get(targetUrl, (response) => {
          if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400 && response.headers.location) {
            fetchToDest(new URL(response.headers.location, targetUrl).href).then(resolve).catch(reject)
            return
          }
          if ((response.statusCode ?? 0) >= 400) {
            reject(new HiggsfieldCliError(`Download failed with status ${response.statusCode}`))
            return
          }
          pipeline(response, createWriteStream(dest))
            .then(() => resolve(dest))
            .catch(reject)
        })
        .on('error', reject)
    })

  return fetchToDest(url)
}

export async function downloadFirstAudio(urls: string[]): Promise<string | null> {
  const audioUrl = urls.find((url) => /\.(wav|mp3|m4a|ogg|aac|flac)(\?|$)/i.test(url))
  if (!audioUrl) return null
  return downloadMedia(audioUrl)
}

export async function isCliAvailable(): Promise<boolean> {
  try {
    resolveHiggsfieldBinary()
    return true
  } catch {
    return false
  }
}

export async function isAuthenticated(): Promise<boolean> {
  try {
    await runCommand(['auth', 'token'], 15_000)
    return true
  } catch (err) {
    if (err instanceof HiggsfieldCliError) {
      if (isHiggsfieldAuthFailureMessage(err.message)) return false
    }
    // Stale token file can still throw non-auth errors; treat unknown auth failures as logged-out.
    const msg = err instanceof Error ? err.message : String(err)
    if (isHiggsfieldAuthFailureMessage(msg)) return false
    return false
  }
}

export function getResolvedCliPath(): string {
  return resolveHiggsfieldBinary()
}

export function resetCliCache(): void {
  cachedBin = null
}
