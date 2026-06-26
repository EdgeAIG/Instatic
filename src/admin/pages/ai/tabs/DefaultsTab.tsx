/**
 * Defaults tab — per-scope default `(credentialId, modelId)` selection.
 *
 * One row per `ToolScope`. Each row uses the shared {@link ModelPicker} — the
 * same combined credential+model picker as the chat composer — and a Save
 * button. Saving a row PUTs to /admin/api/ai/defaults/:scope.
 */

import { useState } from 'react'
import { useAsyncResource } from '@admin/lib/useAsyncResource'
import { Button } from '@ui/components/Button'
import { ModelPicker, type ModelChoice } from '@admin/ai/ModelPicker'
import { CloseIcon } from 'pixel-art-icons/icons/close'
import { SaveSolidIcon } from 'pixel-art-icons/icons/save-solid'
import {
  type AiDefaults,
  type CredentialView,
  clearDefault,
  listCredentials,
  listDefaults,
  setDefault,
} from '../../../ai/api'
import { ApiError } from '@core/http'
import styles from '../AiPage.module.css'

type ToolScope = 'site' | 'content' | 'data' | 'plugin'
const SCOPES: ToolScope[] = ['site', 'content', 'data', 'plugin']
const SCOPE_DESCRIPTIONS: Record<ToolScope, string> = {
  site: 'Used by the visual site editor chat.',
  content: 'Used by the content workspace.',
  data: 'Used by the data workspace (Phase 4).',
  plugin: 'Used by api.ai.* calls from plugin code (Phase 5).',
}

async function saveScope(
  scope: ToolScope,
  credentialId: string,
  modelId: string,
  refresh: () => void,
  setSavingScope: (value: ToolScope | null) => void,
  setStatusByScope: (updater: (prev: Record<string, string>) => Record<string, string>) => void,
): Promise<void> {
  setSavingScope(scope)
  setStatusByScope((prev) => ({ ...prev, [scope]: '' }))
  try {
    await setDefault(scope, { credentialId, modelId })
    setStatusByScope((prev) => ({ ...prev, [scope]: 'Saved.' }))
    refresh()
  } catch (err) {
    const message = err instanceof ApiError
      ? err.message
      : err instanceof Error
        ? err.message
        : 'Failed to save.'
    setStatusByScope((prev) => ({ ...prev, [scope]: message }))
  } finally {
    setSavingScope(null)
  }
}

async function clearScope(
  scope: ToolScope,
  refresh: () => void,
  setSavingScope: (value: ToolScope | null) => void,
  setStatusByScope: (updater: (prev: Record<string, string>) => Record<string, string>) => void,
): Promise<boolean> {
  setSavingScope(scope)
  setStatusByScope((prev) => ({ ...prev, [scope]: '' }))
  try {
    await clearDefault(scope)
    setStatusByScope((prev) => ({ ...prev, [scope]: 'Cleared.' }))
    refresh()
    return true
  } catch (err) {
    const message = err instanceof ApiError
      ? err.message
      : err instanceof Error
        ? err.message
        : 'Failed to clear.'
    setStatusByScope((prev) => ({ ...prev, [scope]: message }))
    return false
  } finally {
    setSavingScope(null)
  }
}

export function DefaultsTab() {
  const { data, loading, error, refresh } = useAsyncResource(
    () => Promise.all([listCredentials(), listDefaults()]).then(([creds, defs]) => ({ creds, defs })),
    [],
    { fallbackError: 'Failed to load defaults.' },
  )
  const credentials: CredentialView[] = data?.creds ?? []
  const defaults: AiDefaults = data?.defs ?? {}
  const [savingScope, setSavingScope] = useState<ToolScope | null>(null)
  const [statusByScope, setStatusByScope] = useState<Record<string, string>>({})

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>Per-scope defaults</h2>
          <p>Pick which credential + model each AI surface uses by default. Users can override in the chat picker.</p>
        </div>
      </div>

      {error && <p role="alert" className={styles.errorAlert}>{error}</p>}

      {loading ? (
        <div className={styles.emptyState}>Loading…</div>
      ) : credentials.length === 0 ? (
        <div className={styles.emptyState}>
          Add a credential on the Providers tab before setting defaults.
        </div>
      ) : (
        <div className={styles.defaultsGrid}>
          {SCOPES.map((scope) => (
            <ScopeRow
              key={scope}
              scope={scope}
              credentials={credentials}
              current={defaults[scope]}
              busy={savingScope === scope}
              status={statusByScope[scope]}
              onSave={(credentialId, modelId) => saveScope(scope, credentialId, modelId, refresh, setSavingScope, setStatusByScope)}
              onClear={() => clearScope(scope, refresh, setSavingScope, setStatusByScope)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ScopeRow({
  scope,
  credentials,
  current,
  busy,
  status,
  onSave,
  onClear,
}: {
  scope: ToolScope
  credentials: CredentialView[]
  current: { credentialId: string; modelId: string } | undefined
  busy: boolean
  status: string | undefined
  onSave: (credentialId: string, modelId: string) => Promise<void>
  onClear: () => Promise<boolean>
}) {
  // Track ONLY the user's pick. The displayed value falls back to the saved
  // default when it still resolves to a credential this user can access.
  //
  // Why: the saved default may point to a credential the current user can no
  // longer resolve (deleted, owned by another user, master-key rotated). In
  // that case we show nothing and require a fresh pick before Save.
  const [override, setOverride] = useState<ModelChoice | null>(null)

  const savedResolves = current?.credentialId
    ? credentials.some((c) => c.id === current.credentialId)
    : false

  const value: ModelChoice | null =
    override ??
    (savedResolves ? { credentialId: current!.credentialId, modelId: current!.modelId } : null)

  const stale = Boolean(current?.credentialId) && !savedResolves

  const dirty =
    override != null &&
    (override.credentialId !== current?.credentialId || override.modelId !== current?.modelId)
  const canSave = !busy && value != null && dirty
  const canClear = !busy && current != null

  return (
    <div className={styles.defaultRow}>
      <div>
        <div className={styles.defaultScopeLabel}>{scope}</div>
        <p className={styles.secondaryText}>{SCOPE_DESCRIPTIONS[scope]}</p>
        {stale && (
          <p role="status" className={`${styles.testResult} ${styles.danger}`}>
            Previously saved credential is no longer available. Pick another and Save.
          </p>
        )}
      </div>
      <ModelPicker
        variant="field"
        ariaLabel={`Model for ${scope}`}
        placeholder="Choose a model"
        credentials={credentials}
        credentialsLoaded
        value={value}
        onChange={setOverride}
      />
      <div className={styles.defaultActions}>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={!canSave}
          onClick={() => value && void onSave(value.credentialId, value.modelId)}
        >
          <SaveSolidIcon size={14} aria-hidden="true" />
          <span>Save</span>
        </Button>
        {current && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!canClear}
            onClick={() => {
              void onClear().then((cleared) => {
                if (cleared) setOverride(null)
              })
            }}
          >
            <CloseIcon size={14} aria-hidden="true" />
            <span>Clear</span>
          </Button>
        )}
        {status && (
          <p
            role="status"
            className={`${styles.testResult} ${status === 'Saved.' || status === 'Cleared.' ? styles.success : styles.danger}`}
          >
            {status}
          </p>
        )}
      </div>
    </div>
  )
}
