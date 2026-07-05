import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

/**
 * Native binaries cannot be executed from inside app.asar.
 * electron-builder copies them to app.asar.unpacked — redirect spawn paths there.
 */
export function spawnablePath(filePath: string): string {
  if (!filePath.includes('app.asar') || filePath.includes('app.asar.unpacked')) {
    return filePath
  }

  const unpacked = filePath.replace(/app\.asar([\\/])/g, 'app.asar.unpacked$1')
  if (existsSync(unpacked)) return unpacked
  return filePath
}

/** Resolve a file under node_modules in the packaged app's asar.unpacked tree. */
export function packagedNodeModulePath(...segments: string[]): string | null {
  if (!app.isPackaged) return null
  const path = join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', ...segments)
  return existsSync(path) ? path : null
}
