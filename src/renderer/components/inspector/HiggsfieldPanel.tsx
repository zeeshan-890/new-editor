import { useEffect } from 'react'
import { Sparkles, RefreshCw, LogIn } from 'lucide-react'
import { Button } from '../common/Button'
import { Label } from '../common/Label'
import { Select } from '../common/Select'
import { PromptAttachmentZone } from '../preview/PromptAttachmentZone'
import { useHiggsfieldStore, canSubmitVisualGeneration } from '@renderer/stores/higgsfieldStore'
import { isHiggsfieldAuthFailureMessage } from '@shared/higgsfieldAuth'
import type { HiggsfieldModelCategory } from '@shared/types'

interface HiggsfieldPanelProps {
  onImportAudio: (filePath: string) => void
  currentAudioPath?: string
}

const TTS_ENGINES = [
  { value: 'elevenlabs', label: 'ElevenLabs' },
  { value: 'minimax', label: 'Minimax' },
  { value: 'seed_speech', label: 'Seed Speech' },
  { value: 'vibe_voice', label: 'Vibe Voice' },
  { value: 'cozy_voice', label: 'Cozy Voice' }
]

export function HiggsfieldPanel({
  onImportAudio,
  currentAudioPath
}: HiggsfieldPanelProps): React.JSX.Element {
  const status = useHiggsfieldStore((s) => s.status)
  const models = useHiggsfieldStore((s) => s.models)
  const voices = useHiggsfieldStore((s) => s.voices)
  const category = useHiggsfieldStore((s) => s.category)
  const selectedModel = useHiggsfieldStore((s) => s.selectedModel)
  const selectedVoiceId = useHiggsfieldStore((s) => s.selectedVoiceId)
  const ttsEngine = useHiggsfieldStore((s) => s.ttsEngine)
  const composer = useHiggsfieldStore((s) => s.composer)
  const modelSchema = useHiggsfieldStore((s) => s.modelSchema)
  const generating = useHiggsfieldStore((s) => s.generating)
  const progressMessage = useHiggsfieldStore((s) => s.progressMessage)
  const queueStats = useHiggsfieldStore((s) => s.queueStats)
  const error = useHiggsfieldStore((s) => s.error)
  const statusLoading = useHiggsfieldStore((s) => s.statusLoading)
  const workspaces = useHiggsfieldStore((s) => s.workspaces)
  const selectedWorkspaceId = useHiggsfieldStore((s) => s.selectedWorkspaceId)

  const refreshStatus = useHiggsfieldStore((s) => s.refreshStatus)
  const login = useHiggsfieldStore((s) => s.login)
  const setCategory = useHiggsfieldStore((s) => s.setCategory)
  const setSelectedModel = useHiggsfieldStore((s) => s.setSelectedModel)
  const setSelectedVoiceId = useHiggsfieldStore((s) => s.setSelectedVoiceId)
  const setTtsEngine = useHiggsfieldStore((s) => s.setTtsEngine)
  const setComposerPrompt = useHiggsfieldStore((s) => s.setComposerPrompt)
  const setError = useHiggsfieldStore((s) => s.setError)
  const generate = useHiggsfieldStore((s) => s.generate)
  const enqueueGeneration = useHiggsfieldStore((s) => s.enqueueGeneration)
  const setSelectedWorkspaceId = useHiggsfieldStore((s) => s.setSelectedWorkspaceId)

  useEffect(() => {
    void refreshStatus()
    const progressUnsub = window.electronAPI?.onHiggsfieldProgress((message) => {
      useHiggsfieldStore.setState({ progressMessage: message })
    })
    return () => {
      progressUnsub?.()
    }
  }, [refreshStatus])

  const credits =
    status?.account?.credits_available ?? status?.account?.credits ?? undefined

  const activeWorkspaceId =
    selectedWorkspaceId || workspaces.find((ws) => ws.isSelected)?.id || workspaces[0]?.id || ''

  const isVisualCategory = category === 'image' || category === 'video'
  const referenceCount = composer.references.length
  const canGenerateVisual = canSubmitVisualGeneration(
    modelSchema,
    composer.prompt,
    referenceCount
  )
  const requiresReferenceOnly = modelSchema != null && !modelSchema.acceptsPrompt
  const requiresSourceImage =
    modelSchema?.imageInput === 'image_url' || (modelSchema?.minImageReferences ?? 0) > 0

  const handleGenerate = async (): Promise<void> => {
    if (isVisualCategory) {
      await enqueueGeneration(
        currentAudioPath && category === 'video'
          ? { mediaPath: currentAudioPath, mediaFlag: 'audio' }
          : undefined
      )
      return
    }

    const result = await generate(
      currentAudioPath ? { mediaPath: currentAudioPath, mediaFlag: 'audio' } : undefined
    )
    if (result?.localPath && category === 'audio') {
      onImportAudio(result.localPath)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto text-sm border-t border-border">
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-primary" />
        <h3 className="font-semibold text-base">Higgsfield AI</h3>
      </div>

      {!window.electronAPI && (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 space-y-1">
          <p className="font-medium">Desktop app required</p>
          <p>
            Close this browser tab. Run <code className="text-foreground">npm run dev</code> and use
            the <strong>Silence Editor</strong> Electron window — not localhost in Chrome.
          </p>
        </div>
      )}

      {window.electronAPI && statusLoading && (
        <div className="rounded border border-border bg-background p-3 text-xs text-muted">
          Checking Higgsfield CLI…
        </div>
      )}

      {window.electronAPI && !statusLoading && status && !status.cliAvailable && (
        <div className="rounded border border-destructive/30 bg-destructive/10 p-3 text-xs text-red-300 space-y-1">
          <p>Higgsfield CLI not found.</p>
          {status.statusMessage && <p className="text-muted">{status.statusMessage}</p>}
          <p>
            Install with{' '}
            <code className="text-foreground">npm install @higgsfield/cli</code>, then restart.
          </p>
        </div>
      )}

      {status?.cliAvailable && (
        <div className="rounded border border-border bg-background p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted">
              {status.authenticated
                ? `Signed in${status.account?.email ? ` as ${status.account.email}` : ''}`
                : status.statusMessage ?? 'Not connected'}
            </span>
            {typeof credits === 'number' && (
              <span className="text-xs text-primary">{credits} credits</span>
            )}
          </div>
          {status.cliPath && (
            <p className="text-[10px] text-muted truncate" title={status.cliPath}>
              CLI: {status.cliPath.split(/[/\\]/).slice(-3).join('/')}
            </p>
          )}
          <div className="flex gap-2">
            {!status.authenticated ? (
              <Button size="sm" className="flex-1" onClick={() => void login()}>
                <LogIn size={14} className="mr-1" />{' '}
                {status.statusMessage?.toLowerCase().includes('expired')
                  ? 'Reconnect'
                  : 'Connect'}
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => void refreshStatus()}>
              <RefreshCw size={14} className="mr-1" /> Refresh
            </Button>
          </div>
        </div>
      )}

      {error && window.electronAPI && (
        <div className="rounded border border-destructive/30 bg-destructive/10 p-2 text-xs text-red-300 space-y-2">
          <p>{error.replace(/^Error:\s*/i, '').replace(/^Error invoking remote method '[^']+':\s*/i, '')}</p>
          <div className="flex gap-3">
            {isHiggsfieldAuthFailureMessage(error) && (
              <button className="underline text-foreground" onClick={() => void login()}>
                reconnect
              </button>
            )}
            <button className="underline" onClick={() => setError(null)}>
              dismiss
            </button>
            <button
              className="underline text-foreground"
              onClick={() => void window.electronAPI?.openLogFile()}
            >
              open log file
            </button>
          </div>
        </div>
      )}

      {status?.authenticated && (
        <>
          <div>
            <Label>Workspace</Label>
            {workspaces.length === 0 ? (
              <p className="text-xs text-muted mt-1">
                No workspaces loaded. Click <strong>Refresh</strong> above.
              </p>
            ) : (
              <>
                <Select
                  value={activeWorkspaceId}
                  onChange={(id) => void setSelectedWorkspaceId(id)}
                  options={workspaces.map((ws) => ({
                    value: ws.id,
                    label: `${ws.name} (${Math.floor(ws.credits).toLocaleString()} credits · ${ws.planType})`
                  }))}
                />
                {status.selectedWorkspace && (
                  <p className="text-[10px] text-muted mt-1">
                    Active: {status.selectedWorkspace.name}
                    {status.selectedWorkspace.name.toLowerCase().includes('ledisa') ? ' ✓' : ''}
                  </p>
                )}
              </>
            )}
          </div>

          <div>
            <Label>Content type</Label>
            <Select<HiggsfieldModelCategory>
              value={category}
              onChange={setCategory}
              options={[
                { value: 'audio', label: 'Audio (TTS, music, SFX)' },
                { value: 'image', label: 'Image' },
                { value: 'video', label: 'Video' }
              ]}
            />
          </div>

          <div>
            <Label>Model</Label>
            <Select
              value={selectedModel}
              onChange={setSelectedModel}
              options={models.map((m) => ({ value: m.id, label: m.name }))}
            />
            {selectedModel && (
              <p className="text-[10px] text-muted mt-1 break-words">
                {models.find((m) => m.id === selectedModel)?.name ?? selectedModel}
              </p>
            )}
          </div>

          {selectedModel === 'text2speech_v2' && (
            <>
              <div>
                <Label>TTS engine</Label>
                <Select value={ttsEngine} onChange={setTtsEngine} options={TTS_ENGINES} />
              </div>
              {voices.length > 0 && (
                <div>
                  <Label>Voice</Label>
                  <Select
                    value={selectedVoiceId}
                    onChange={setSelectedVoiceId}
                    options={voices.map((v) => ({
                      value: v.id,
                      label: `${v.name} (${v.type})`
                    }))}
                  />
                </div>
              )}
            </>
          )}

          {category === 'image' && <PromptAttachmentZone />}

          {requiresSourceImage && (
            <p className="text-[10px] text-amber-200/90 rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1.5">
              {modelSchema?.displayName ?? 'This model'} needs a reference image
              {requiresReferenceOnly
                ? ' and does not accept a text prompt.'
                : selectedModel === 'autosprite'
                  ? ' (AutoSprite creates sprite animations from a character or object image; prompt is optional unless using a custom animation kind).'
                  : '.'}
            </p>
          )}

          {!(isVisualCategory && requiresReferenceOnly) && (
            <div>
              <Label>
                {requiresSourceImage && modelSchema?.acceptsPrompt ? 'Prompt (optional)' : 'Prompt'}
              </Label>
              <textarea
                value={composer.prompt}
                onChange={(e) => setComposerPrompt(e.target.value)}
                rows={4}
                placeholder={
                  category === 'audio'
                    ? 'Enter narration text or describe the sound you want…'
                    : 'Describe what you want to generate…'
                }
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          )}

          {generating && progressMessage && category === 'audio' && (
            <p className="text-xs text-primary animate-pulse">{progressMessage}</p>
          )}

          {isVisualCategory && (queueStats.running > 0 || queueStats.queued > 0) && (
            <p className="text-xs text-primary">
              Background queue · Running {queueStats.running} · Queued {queueStats.queued}
            </p>
          )}

          <Button
            className="w-full"
            disabled={
              (category === 'audio' && (generating || !composer.prompt.trim())) ||
              (isVisualCategory && !canGenerateVisual) ||
              (workspaces.length > 0 && !activeWorkspaceId)
            }
            onClick={() => void handleGenerate()}
          >
            {category === 'audio'
              ? generating
                ? 'Generating…'
                : 'Generate with Higgsfield'
              : 'Queue generation'}
          </Button>

          {category === 'audio' && (
            <p className="text-[10px] text-muted">
              Generated audio is downloaded and imported into the timeline automatically.
            </p>
          )}

          {isVisualCategory && (
            <p className="text-[10px] text-muted">
              Generations run in the background with unlimited queue. Click a preview tile to load its
              prompt here, or drag a tile onto the reference zone.
            </p>
          )}
        </>
      )}
    </div>
  )
}
