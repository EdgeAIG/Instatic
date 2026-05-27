/**
 * ModelPicker — compact dropdown in the AgentPanel showing the currently
 * active credential + model with a flat menu of every `(credential, model)`
 * pair the user has access to.
 *
 * Sourcing:
 *   - Credentials: `GET /admin/api/ai/credentials` (CredentialView[])
 *   - Models per provider: `GET /admin/api/ai/providers/:id/models?credentialId=…`
 *     Cached per-credential in component state; picker only fetches once
 *     per credential while open.
 *
 * Selection effect via `setAgentProvider(credentialId, modelId)`:
 *   - With an active conversation → PUTs the conversation row (the next
 *     send uses the new provider).
 *   - Without → stages the values for the next conversation-create call.
 *
 * Built on the shared `ContextMenu` primitive — same dropdown styling +
 * auto-flip behaviour as the rest of the admin.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAgentStore } from '@admin/ai/useAgentStore'
import { Button } from '@ui/components/Button'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@ui/components/ContextMenu'
import { ChevronDownIcon } from 'pixel-art-icons/icons/chevron-down'
import {
  type AiModel,
  type CredentialView,
  listCredentials,
  listModels,
} from '@admin/ai/api'
import styles from './AgentPanel.module.css'

interface ModelPickerProps {
  /** Optional extra className for the trigger wrapper. */
  className?: string
}

export function ModelPicker({ className }: ModelPickerProps) {
  const activeCredentialId = useAgentStore((s) => s.agentActiveCredentialId)
  const activeModelId = useAgentStore((s) => s.agentActiveModelId)
  const setAgentProvider = useAgentStore((s) => s.setAgentProvider)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [credentials, setCredentials] = useState<CredentialView[]>([])
  const [modelsByCred, setModelsByCred] = useState<Record<string, AiModel[]>>({})
  const [refreshKey, setRefreshKey] = useState(0)

  // Load credentials on mount AND every time the popover re-opens. The mount
  // load is what makes the trigger label show the credential's friendly
  // displayLabel (instead of a 6-char id slice) before the user has ever
  // opened the popover. Cheap call — short list.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const list = await listCredentials()
        if (cancelled) return
        setCredentials(list)
      } catch {
        // swallow — UI shows "no credentials" empty state
      }
    }
    void load()
    return () => { cancelled = true }
  }, [refreshKey])

  // Lazy-load models for each credential's provider. Cached per credential
  // id so a later per-credential model list (Ollama with different
  // baseUrls returns different models) doesn't collide.
  //
  // Two-phase: while the popover is CLOSED we only fetch models for the
  // currently-active credential (just enough to render its model's friendly
  // label on the trigger). When the popover OPENS we fan out to every
  // credential so the full picker is populated.
  useEffect(() => {
    if (credentials.length === 0) return
    let cancelled = false
    const targets = open
      ? credentials
      : credentials.filter((c) => c.id === activeCredentialId)
    for (const cred of targets) {
      if (modelsByCred[cred.id]) continue
      void listModels(cred.providerId, cred.id).then((models) => {
        if (cancelled) return
        setModelsByCred((prev) => ({ ...prev, [cred.id]: models }))
      }).catch(() => { /* swallow */ })
    }
    return () => { cancelled = true }
  }, [open, credentials, modelsByCred, activeCredentialId])

  const activeLabel = useMemo(() => {
    if (!activeCredentialId || !activeModelId) return 'Default'
    const cred = credentials.find((c) => c.id === activeCredentialId)
    const models = modelsByCred[activeCredentialId] ?? []
    const model = models.find((m) => m.id === activeModelId)
    // Fall back to the model id (not the credential id slice) when the
    // credential row hasn't loaded yet — the model id is at least a
    // recognisable string like "gpt-5.5". Empty string until the first
    // credential fetch settles so we don't flash an id slice.
    const credLabel = cred?.displayLabel ?? ''
    const modelLabel = model?.label ?? activeModelId
    return credLabel ? `${credLabel} · ${modelLabel}` : modelLabel
  }, [activeCredentialId, activeModelId, credentials, modelsByCred])

  function toggle() {
    setOpen((v) => !v)
    setRefreshKey((n) => n + 1)
  }

  async function pick(credentialId: string, modelId: string) {
    setOpen(false)
    await setAgentProvider(credentialId, modelId)
  }

  // Flatten credentials + their models into ContextMenuItem rows. Grouped
  // by credential, separated by a ContextMenuSeparator between groups.
  const groups = credentials.map((cred) => ({
    cred,
    models: modelsByCred[cred.id] ?? [],
  }))

  return (
    <div className={className}>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="xs"
        onClick={toggle}
        tooltip="Model"
        aria-haspopup="menu"
        aria-expanded={open}
        className={styles.modelPickerButton}
      >
        <span className={styles.modelPickerLabel}>{activeLabel}</span>
        <ChevronDownIcon size={10} aria-hidden="true" />
      </Button>
      {open && (
        <ContextMenu
          anchorRef={triggerRef}
          triggerRef={triggerRef}
          align="start"
          side="auto"
          offset={6}
          minWidth={220}
          maxHeight={320}
          ariaLabel="Pick a model"
          onClose={() => setOpen(false)}
        >
          {credentials.length === 0
            ? (
              <ContextMenuItem disabled>
                <span>No credentials — open AI settings to add one.</span>
              </ContextMenuItem>
            )
            : groups.flatMap((group, groupIndex) => {
              const items: React.ReactNode[] = []
              if (groupIndex > 0) {
                items.push(<ContextMenuSeparator key={`sep-${group.cred.id}`} />)
              }
              items.push(
                <ContextMenuItem key={`${group.cred.id}:header`} disabled>
                  <span className={styles.modelPickerGroupHeader}>
                    {group.cred.displayLabel}
                    <span className={styles.modelPickerProvider}> · {group.cred.providerId}</span>
                  </span>
                </ContextMenuItem>,
              )
              if (group.models.length === 0) {
                items.push(
                  <ContextMenuItem key={`${group.cred.id}:loading`} disabled>
                    <span>Loading models…</span>
                  </ContextMenuItem>,
                )
              } else {
                for (const model of group.models) {
                  const isActive =
                    group.cred.id === activeCredentialId &&
                    model.id === activeModelId
                  items.push(
                    <ContextMenuItem
                      key={`${group.cred.id}:${model.id}`}
                      role="menuitemradio"
                      aria-checked={isActive}
                      active={isActive}
                      onClick={() => void pick(group.cred.id, model.id)}
                    >
                      <span>{model.label}</span>
                      {model.tier && (
                        <span className={styles.modelPickerTier}>{model.tier}</span>
                      )}
                    </ContextMenuItem>,
                  )
                }
              }
              return items
            })}
        </ContextMenu>
      )}
    </div>
  )
}
