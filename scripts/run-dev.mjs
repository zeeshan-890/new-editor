import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))

delete process.env.ELECTRON_RUN_AS_NODE
delete process.env.ELECTRON_RENDERER_URL

try {
  const pkgPath = require.resolve('@higgsfield/cli/package.json')
  const hfPath = join(dirname(pkgPath), 'vendor', process.platform === 'win32' ? 'hf.exe' : 'hf')
  if (existsSync(hfPath)) {
    process.env.HIGGSFIELD_CLI_PATH = hfPath
  }
} catch {
  // @higgsfield/cli not installed — main process will report CLI missing
}

const child = spawn('electron-vite', ['dev'], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
  cwd: root
})

child.on('close', (code) => {
  process.exit(code ?? 0)
})
