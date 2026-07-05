import { rmSync, existsSync } from 'fs'
import { join } from 'path'

const dirName = process.argv[2] ?? 'release'
const target = join(process.cwd(), dirName)

if (!existsSync(target)) {
  console.log(`[clean-release] ${dirName}/ does not exist — skipping`)
  process.exit(0)
}

console.log(`[clean-release] removing ${dirName}/ …`)
try {
  rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  console.log('[clean-release] done')
} catch (err) {
  console.error(
    `[clean-release] Could not delete ${dirName}/. Close Silence Editor, File Explorer windows on that folder, then retry.`
  )
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
