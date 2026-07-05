import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import extract from 'extract-zip'
import { downloadArtifact } from '@electron/get'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const electronDir = join(root, 'node_modules', 'electron')
const distDir = join(electronDir, 'dist')
const electronExe = join(distDir, 'electron.exe')
const pathFile = join(electronDir, 'path.txt')

async function main() {
  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) return

  if (existsSync(electronExe) && existsSync(pathFile)) {
    return
  }

  if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true })

  const { version } = await import(join(electronDir, 'package.json'), { with: { type: 'json' } })

  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    platform: process.platform,
    arch: process.arch
  })

  await extract(zipPath, { dir: distDir })
  writeFileSync(pathFile, process.platform === 'win32' ? 'electron.exe' : 'electron', 'utf8')
  writeFileSync(join(distDir, 'version'), version.replace(/^v/, ''))
  console.log('Electron binary ready:', readdirSync(distDir).slice(0, 5).join(', '), '...')
}

main().catch((err) => {
  console.error('Electron install failed:', err)
  process.exit(1)
})
