import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { pipeline } from 'stream/promises'
import extract from 'extract-zip'

async function extractZip(zipPath, extractDir) {
  if (process.platform === 'win32') {
    const { rmSync } = await import('fs')
    const { execFileSync } = await import('child_process')
    rmSync(extractDir, { recursive: true, force: true })
    mkdirSync(extractDir, { recursive: true })
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`
      ],
      { stdio: 'inherit' }
    )
    return
  }
  await extract(zipPath, { dir: extractDir })
}

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const whisperDir = join(root, 'resources', 'whisper')
const MODEL_NAME = 'ggml-large-v3.bin'
const modelPath = join(whisperDir, MODEL_NAME)
/** ~2.9 GB — treat anything under 2 GB as incomplete. */
const MIN_MODEL_BYTES = 2_000_000_000

const WHISPER_RELEASE = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1'
const BIN_URL =
  process.platform === 'win32'
    ? `${WHISPER_RELEASE}/whisper-bin-x64.zip`
    : `${WHISPER_RELEASE}/whisper-bin-ubuntu-x64.tar.gz`
const MODEL_URL =
  `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}`

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) {
    throw new Error(`Download failed (${res.status}): ${url}`)
  }
  await pipeline(res.body, createWriteStream(dest))
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findFile(full, name)
      if (found) return found
    } else if (entry.name === name) {
      return full
    }
  }
  return null
}

async function installBinary() {
  const releaseDir = join(whisperDir, 'Release')
  const releaseBinary = join(releaseDir, process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli')
  if (existsSync(releaseBinary)) {
    console.log('Whisper CLI already present:', releaseBinary)
    return
  }

  if (process.platform !== 'win32') {
    throw new Error(
      'Automatic Whisper install is only supported on Windows. Build whisper.cpp and copy whisper-cli into resources/whisper/.'
    )
  }

  const zipPath = join(whisperDir, 'whisper-bin-x64.zip')
  const extractDir = join(whisperDir, '_extract')
  if (!existsSync(zipPath)) {
    console.log('Downloading whisper.cpp binary...')
    await download(BIN_URL, zipPath)
  } else {
    console.log('Using cached whisper.cpp archive:', zipPath)
  }

  const { rmSync, cpSync } = await import('fs')
  rmSync(extractDir, { recursive: true, force: true })
  mkdirSync(extractDir, { recursive: true })
  await extractZip(zipPath, extractDir)

  const found = findFile(extractDir, 'whisper-cli.exe')
  if (!found) {
    throw new Error('whisper-cli.exe was not found in the downloaded archive.')
  }

  const sourceReleaseDir = join(found, '..')
  rmSync(releaseDir, { recursive: true, force: true })
  cpSync(sourceReleaseDir, releaseDir, { recursive: true })
  rmSync(extractDir, { recursive: true, force: true })
  console.log('Installed Whisper CLI bundle:', releaseDir)
}

async function installModel() {
  if (existsSync(modelPath) && statSync(modelPath).size >= MIN_MODEL_BYTES) {
    console.log('Whisper large model already present:', modelPath)
    return
  }

  if (existsSync(modelPath)) {
    const { unlinkSync } = await import('fs')
    console.log('Removing incomplete model download...')
    unlinkSync(modelPath)
  }

  console.log(`Downloading ${MODEL_NAME} (~3.1 GB) — this can take a while...`)
  await download(MODEL_URL, modelPath)
  const size = statSync(modelPath).size
  if (size < MIN_MODEL_BYTES) {
    throw new Error(
      `Downloaded model looks too small (${size} bytes). Delete it and re-run npm run install:whisper.`
    )
  }
  console.log('Installed Whisper model:', modelPath)
}

async function main() {
  mkdirSync(whisperDir, { recursive: true })
  await installBinary()
  await installModel()
  console.log('Whisper large-v3 is ready for script-audio alignment.')
}

main().catch((err) => {
  console.error('Whisper install failed:', err.message ?? err)
  process.exit(1)
})
