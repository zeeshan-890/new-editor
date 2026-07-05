process.env.PATH = 'C:\\Windows\\System32'
import { getResolvedCliPath, isCliAvailable, runHiggsfield } from '../src/main/higgsfield/cli.ts'

async function main() {
  console.log('available', await isCliAvailable())
  console.log('path', getResolvedCliPath())
  console.log('version', await runHiggsfield(['version'], 15000))
}

main().catch(console.error)
