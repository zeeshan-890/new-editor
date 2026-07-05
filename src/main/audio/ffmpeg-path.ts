import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(
  typeof __dirname !== 'undefined' ? join(__dirname, 'ffmpeg-path.js') : fileURLToPath(import.meta.url)
)

export const FFMPEG_PATH = require('ffmpeg-static') as string
