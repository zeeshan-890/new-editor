import { useEffect, useRef, useState } from 'react'

/** Debounced local draft for creative instructions, synced from pipeline on project change. */
export function useCreativeInstructionsDraft(
  pipelineInstructions: string,
  projectId: string,
  onSave: (value: string) => void
): [string, (value: string) => void] {
  const [draft, setDraft] = useState(() => pipelineInstructions)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setDraft(pipelineInstructions)
  }, [projectId])

  useEffect(() => {
    if (pipelineInstructions === draft) return
    setDraft(pipelineInstructions)
  }, [pipelineInstructions])

  useEffect(() => {
    if (draft === pipelineInstructions) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      onSave(draft)
    }, 600)
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [draft, pipelineInstructions, onSave])

  return [draft, setDraft]
}
