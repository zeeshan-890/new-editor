import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

type LogLevel = 'info' | 'warn' | 'error'

interface LogEntry {
  timestamp: string
  level: LogLevel
  scope: string
  message: string
  context?: Record<string, unknown>
}

let logsDir: string | null = null

function resolveLogsDir(): string {
  if (logsDir) return logsDir

  const candidates = [
    join(process.cwd(), 'logs'),
    join(app.getPath('userData'), 'logs')
  ]

  for (const dir of candidates) {
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      logsDir = dir
      return dir
    } catch {
      // try next location
    }
  }

  const fallback = join(app.getPath('userData'), 'logs')
  if (!existsSync(fallback)) mkdirSync(fallback, { recursive: true })
  logsDir = fallback
  return fallback
}

function dailyLogFilePath(): string {
  const date = new Date().toISOString().slice(0, 10)
  return join(resolveLogsDir(), `errors-${date}.json`)
}

function readEntries(filePath: string): LogEntry[] {
  if (!existsSync(filePath)) return []
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    return Array.isArray(parsed) ? (parsed as LogEntry[]) : []
  } catch {
    return []
  }
}

function appendEntry(entry: LogEntry): void {
  const filePath = dailyLogFilePath()
  const entries = readEntries(filePath)
  entries.push(entry)
  writeFileSync(filePath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8')
}

function write(level: LogLevel, scope: string, message: string, context?: Record<string, unknown>): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    ...(context ? { context } : {})
  }

  try {
    appendEntry(entry)
  } catch {
    // ignore file write failures
  }

  const prefix = `[${entry.timestamp}] [${scope}] ${message}`
  if (level === 'error') console.error(prefix, context ?? '')
  else if (level === 'warn') console.warn(prefix, context ?? '')
  else console.log(prefix, context ?? '')
}

export function getLogFilePath(): string {
  return dailyLogFilePath()
}

export function getLogsDirectory(): string {
  return resolveLogsDir()
}

export function logInfo(scope: string, message: string, context?: Record<string, unknown>): void {
  write('info', scope, message, context)
}

export function logWarn(scope: string, message: string, context?: Record<string, unknown>): void {
  write('warn', scope, message, context)
}

export function logError(scope: string, err: unknown, context?: Record<string, unknown>): void {
  const message = err instanceof Error ? err.message : String(err)
  write('error', scope, message, {
    ...context,
    ...(err instanceof Error && err.stack ? { stack: err.stack } : {})
  })
}
