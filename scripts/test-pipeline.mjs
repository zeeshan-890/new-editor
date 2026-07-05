import { decodeAudio } from '../src/main/audio/decode.ts'
import { detectTraditionalSilence } from '../src/main/detection/traditional.ts'
import { DEFAULT_DETECTION_PARAMS } from '../src/shared/types.ts'

async function main() {
  const { metadata, peaks, pcmPath } = await decodeAudio('test-audio.wav')
  console.log('Decode OK:', metadata.fileName, `${metadata.durationMs.toFixed(0)}ms`)
  console.log('Peak levels:', peaks.levels.map((l) => `${l.samplesPerPeak}:${l.max.length}`).join(', '))

  const regions = detectTraditionalSilence(
    pcmPath,
    metadata.sampleRate,
    metadata.durationMs,
    DEFAULT_DETECTION_PARAMS
  )
  console.log('Silence regions:', regions.length)
  regions.forEach((r) =>
    console.log(`  ${(r.startMs / 1000).toFixed(2)}s - ${(r.endMs / 1000).toFixed(2)}s`)
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
