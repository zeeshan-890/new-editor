import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

const HF = join(process.cwd(), 'node_modules/@higgsfield/cli/vendor', process.platform === 'win32' ? 'hf.exe' : 'hf')
const TIMEOUT = 900_000

function normalizeModels(raw, category) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const id = String(item.job_set_type ?? item.job_type ?? item.id ?? '')
      const name = String(item.display_name ?? item.name ?? item.title ?? id)
      if (!id) return null
      return { id, name, category }
    })
    .filter(Boolean)
}

function runHf(args, timeoutMs = 60_000, { json = true } = {}) {
  return new Promise((resolve, reject) => {
    const fullArgs = json ? [...args, '--json', '--no-color'] : [...args, '--no-color']
    const child = spawn(HF, fullArgs, {
      windowsHide: true,
      env: process.env
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Timeout after ${timeoutMs}ms: hf ${args.join(' ')}`))
    }, timeoutMs)

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error((stderr || stdout || `Exit code ${code}`).trim()))
        return
      }
      if (!json) {
        resolve(stdout.trim())
        return
      }
      try {
        resolve(JSON.parse(stdout.trim()))
      } catch {
        reject(new Error(`Invalid JSON from hf ${args.join(' ')}\n${stdout.slice(0, 500)}`))
      }
    })
  })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function step(name, fn) {
  process.stdout.write(`  ${name}… `)
  try {
    const result = await fn()
    console.log('OK')
    return result
  } catch (err) {
    console.log('FAIL')
    throw new Error(`${name}: ${err.message}`)
  }
}

async function main() {
  console.log('Higgsfield E2E')
  console.log(`CLI: ${HF}`)
  assert(existsSync(HF), 'hf binary not found')

  await step('version', async () => {
    const out = await runHf(['version'], 15_000, { json: false })
    assert(out.includes('higgsfield'), `unexpected version output: ${out}`)
  })

  await step('account status', async () => {
    const account = await runHf(['account', 'status'], 20_000)
    assert(account.email, 'missing account email')
    assert(Number(account.credits) > 0, 'no credits available')
  })

  const workspaces = await step('workspace list', () => runHf(['workspace', 'list'], 30_000))
  assert(Array.isArray(workspaces) && workspaces.length > 0, 'no workspaces')

  const preferred =
    workspaces.find((ws) => String(ws.name ?? '').toLowerCase().includes('ledisa')) ??
    workspaces.reduce((best, current) =>
      Number(current.credits ?? 0) > Number(best.credits ?? 0) ? current : best
    )

  await step('workspace set', async () => {
    await runHf(['workspace', 'set', String(preferred.id)], 15_000, { json: false })
    const status = await runHf(['workspace', 'status'], 15_000)
    assert(String(status.id) === String(preferred.id), 'workspace not selected')
  })

  const rawModels = await step('model list (image)', () => runHf(['model', 'list', '--image'], 30_000))
  const models = normalizeModels(rawModels, 'image')
  assert(models.length > 0, 'no image models')

  const bad = models.filter((m) => m.id === 'image' || m.id === 'video' || m.id === 'audio')
  assert(bad.length === 0, `category used as model id: ${bad.map((m) => m.id).join(', ')}`)

  const model = models.find((m) => m.id === 'nano_banana_2') ?? models[0]
  console.log(`  using model: ${model.name} (${model.id})`)

  await step('image-references flag', async () => {
    const help = await runHf(['generate', 'create', model.id, '--help'], 15_000, { json: false })
    assert(help.includes('image-references'), 'CLI missing --image-references support')
  })

  const result = await step('generate image', () =>
    runHf(
      [
        'generate',
        'create',
        model.id,
        '--prompt',
        'simple red circle on white background, minimal',
        '--wait',
        '--wait-timeout',
        '5m'
      ],
      TIMEOUT
    )
  )

  const urls = []
  const walk = (value) => {
    if (!value) return
    if (typeof value === 'string' && /^https?:\/\//.test(value)) urls.push(value)
    else if (Array.isArray(value)) value.forEach(walk)
    else if (typeof value === 'object') Object.values(value).forEach(walk)
  }
  walk(result)

  assert(urls.length > 0, 'no result URLs in generate response')
  console.log(`  result URL: ${urls[0]}`)
  console.log('\nAll Higgsfield E2E checks passed.')
}

main().catch((err) => {
  console.error(`\nE2E failed: ${err.message}`)
  process.exit(1)
})
