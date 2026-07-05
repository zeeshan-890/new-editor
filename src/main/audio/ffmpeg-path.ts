import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnablePath } from '../appPaths'

const require = createRequire(
  typeof __dirname !== 'undefined' ? join(__dirname, 'ffmpeg-path.js') : fileURLToPath(import.meta.url)
)

export const FFMPEG_PATH = spawnablePath(require('ffmpeg-static') as string)
