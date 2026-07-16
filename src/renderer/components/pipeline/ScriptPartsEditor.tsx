import { Plus, Trash2, Clapperboard, Layers } from 'lucide-react'
import { Button } from '../common/Button'
import { Label } from '../common/Label'
import { useHiggsfieldJobById } from '@renderer/hooks/useHiggsfieldJobById'
import {
  createEmptyScriptPart,
  createEmptyScriptPartClip,
  type ScriptPart,
  type ScriptPartClip,
  type ScriptSegment
} from '@shared/segmentPipeline'
import {
  segmentImagePhase,
  segmentVideoPhase,
  type HiggsfieldJobStatusLookup
} from './pipelineSegmentUi'

function clipStatusLabel(
  segment: ScriptSegment | undefined,
  jobById: HiggsfieldJobStatusLookup
): string | null {
  if (!segment) return null
  if (segment.videoLocalPath || segment.status === 'video_done' || segment.status === 'timeline_placed') {
    return 'Video ready'
  }
  if (segment.imageLocalPath || segment.status === 'image_done' || segment.status === 'audio_match_done') {
    return 'Image ready'
  }
  const imagePhase = segmentImagePhase(segment, jobById)
  const videoPhase = segmentVideoPhase(segment, jobById)
  if (imagePhase === 'generating' || videoPhase === 'generating') {
    return 'Generating…'
  }
  if (imagePhase === 'waiting' || videoPhase === 'waiting' || segment.status === 'pending') {
    return 'Waiting'
  }
  if (segment.status === 'image_pending_approval') return 'Approve image'
  if (segment.error) return 'Failed'
  return 'Queued'
}

export function ScriptPartsEditor({
  parts,
  segments = [],
  onChange,
  onPersist
}: {
  parts: ScriptPart[]
  segments?: ScriptSegment[]
  onChange: (parts: ScriptPart[]) => void
  /** Flush parts to disk (e.g. on blur). */
  onPersist?: () => void
}): React.JSX.Element {
  const jobById = useHiggsfieldJobById()
  const ordered = [...parts].sort((a, b) => a.index - b.index)
  const segmentByClipId = new Map(
    segments
      .filter((s) => s.sourceClipId)
      .map((s) => [s.sourceClipId as string, s])
  )
  const segmentById = new Map(segments.map((s) => [s.id, s]))

  const resolveSegment = (clip: ScriptPartClip): ScriptSegment | undefined => {
    if (clip.segmentId) return segmentById.get(clip.segmentId)
    return segmentByClipId.get(clip.id)
  }

  const updatePart = (partId: string, patch: Partial<ScriptPart>): void => {
    onChange(ordered.map((p) => (p.id === partId ? { ...p, ...patch } : p)))
  }

  const updateClip = (
    partId: string,
    clipId: string,
    patch: Partial<ScriptPartClip>
  ): void => {
    onChange(
      ordered.map((p) =>
        p.id !== partId
          ? p
          : {
              ...p,
              clips: p.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c))
            }
      )
    )
  }

  const addPart = (): void => {
    onChange([...ordered, createEmptyScriptPart(ordered.length)])
  }

  const removePart = (partId: string): void => {
    onChange(
      ordered
        .filter((p) => p.id !== partId)
        .map((p, i) => ({ ...p, index: i }))
    )
  }

  const addClip = (partId: string): void => {
    onChange(
      ordered.map((p) =>
        p.id === partId
          ? { ...p, clips: [...p.clips, createEmptyScriptPartClip()] }
          : p
      )
    )
  }

  const removeClip = (partId: string, clipId: string): void => {
    onChange(
      ordered.map((p) => {
        if (p.id !== partId) return p
        const next = p.clips.filter((c) => c.id !== clipId)
        return {
          ...p,
          clips: next.length > 0 ? next : [createEmptyScriptPartClip()]
        }
      })
    )
  }

  if (ordered.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-3 space-y-2">
        <p className="text-[10px] text-muted">
          Paste script parts, then Build. Clip visuals are optional — if you skip them, agents
          invent the clips. Full script = all parts combined.
        </p>
        <Button size="sm" onClick={addPart}>
          <Plus size={14} className="mr-1" /> Add script part
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-muted">
        Optional clip visuals per part. Leave empty and agents invent clips. On Build, agents
        write image + video prompts. Final script is all parts combined.
      </p>

      {ordered.map((part, partIndex) => (
        <div
          key={part.id}
          className="rounded-md border border-border bg-card/40 p-3 space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <Layers size={14} className="text-primary" />
              Part {partIndex + 1}
            </div>
            <Button
              size="sm"
              variant="ghost"
              title="Remove part"
              onClick={() => removePart(part.id)}
            >
              <Trash2 size={14} />
            </Button>
          </div>

          <div>
            <Label>Script part</Label>
            <textarea
              value={part.scriptText}
              onChange={(e) => updatePart(part.id, { scriptText: e.target.value })}
              onBlur={() => onPersist?.()}
              rows={3}
              placeholder="Paste this narration chunk…"
              className="w-full mt-1 rounded-md border border-border bg-card px-2 py-1.5 text-xs resize-y min-h-[64px] focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Clip visuals ({part.clips.length})</Label>
              <Button size="sm" variant="outline" onClick={() => addClip(part.id)}>
                <Plus size={12} className="mr-1" /> Add clip
              </Button>
            </div>

            {part.clips.map((clip, clipIndex) => {
              const linked = resolveSegment(clip)
              const status = clipStatusLabel(linked, jobById)
              const hasAgentPrompts = Boolean(
                clip.imagePrompt.trim() || clip.videoMotionPrompt?.trim()
              )
              return (
                <div
                  key={clip.id}
                  className="rounded border border-border/80 bg-background/40 p-2 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
                      <Clapperboard size={12} />
                      Clip {clipIndex + 1}
                      {status && (
                        <span
                          className={
                            status === 'Video ready'
                              ? 'text-green-500'
                              : status === 'Failed'
                                ? 'text-destructive'
                                : 'text-primary'
                          }
                        >
                          · {status}
                        </span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Remove clip"
                      onClick={() => removeClip(part.id, clip.id)}
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>

                  <div>
                    <Label>Clip visual</Label>
                    <textarea
                      value={clip.explanation}
                      onChange={(e) =>
                        updateClip(part.id, clip.id, { explanation: e.target.value })
                      }
                      onBlur={() => onPersist?.()}
                      rows={2}
                      placeholder="What the viewer should see in this clip…"
                      className="w-full mt-0.5 rounded-md border border-border bg-card px-2 py-1 text-xs resize-y focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  {hasAgentPrompts && (
                    <div className="rounded border border-border/60 bg-card/30 px-2 py-1.5 space-y-1">
                      <p className="text-[9px] uppercase tracking-wide text-muted">
                        Agent prompts (from Build)
                      </p>
                      {clip.imagePrompt.trim() && (
                        <p className="text-[10px] text-muted line-clamp-3" title={clip.imagePrompt}>
                          Image: {clip.imagePrompt}
                        </p>
                      )}
                      {clip.videoMotionPrompt?.trim() && (
                        <p
                          className="text-[10px] text-muted line-clamp-3"
                          title={clip.videoMotionPrompt}
                        >
                          Video: {clip.videoMotionPrompt}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <Button size="sm" variant="outline" className="w-full" onClick={addPart}>
        <Plus size={14} className="mr-1" /> Add script part
      </Button>
    </div>
  )
}
