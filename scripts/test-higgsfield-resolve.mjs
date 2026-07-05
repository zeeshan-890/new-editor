import { existsSync } from 'fs'
import { join } from 'path'

const hf = process.platform === 'win32' ? 'hf.exe' : 'hf'
const relative = join('@higgsfield', 'cli', 'vendor', hf)
const roots = [process.cwd(), join(process.cwd(), '..', '..')]

for (const root of roots) {
  const local = join(root, 'node_modules', relative)
  console.log('check', local, existsSync(local))
}
