import { useMemo } from 'react'
import { useEditorStore } from '@site/store/store'
import type { SiteFile } from '@core/files/schemas'
import {
  DEFAULT_STYLE_RUNTIME_CONFIG,
  normalizeStyleRuntimeConfig,
} from '@core/site-runtime'
import { Button } from '@ui/components/Button'
import { Input } from '@ui/components/Input'
import { AssetScopeControl, type ScopePageOption } from './AssetScopeControl'
import styles from './ScriptSettingsPane.module.css'

interface StyleSettingsPaneProps {
  file: SiteFile
}

const EMPTY_PAGES: NonNullable<ReturnType<typeof useEditorStore.getState>['site']>['pages'] = []

/**
 * StyleSettingsPane — left rail for a user stylesheet, mirroring
 * ScriptSettingsPane. A stylesheet carries fewer knobs than a script: a
 * `<link>` is always in `<head>` and has no execution timing, so only the
 * enable toggle, page/template scope, and cascade priority apply. Shares the
 * ScriptSettingsPane chrome styles so both panes read identically.
 */
export function StyleSettingsPane({ file }: StyleSettingsPaneProps) {
  const site = useEditorStore((s) => s.site)
  const siteRuntime = useEditorStore((s) => s.siteRuntime)
  const patchStyleRuntimeConfig = useEditorStore((s) => s.patchStyleRuntimeConfig)

  const pages = site?.pages ?? EMPTY_PAGES
  const config = normalizeStyleRuntimeConfig(
    siteRuntime.styles[file.id] ?? DEFAULT_STYLE_RUNTIME_CONFIG,
  )
  const scopeOptions: ScopePageOption[] = useMemo(
    () => pages.map((page) => ({
      id: page.id,
      label: page.title || page.slug || page.id,
      isTemplate: Boolean(page.template),
    })),
    [pages],
  )

  function patch(patchValue: Parameters<typeof patchStyleRuntimeConfig>[1]) {
    patchStyleRuntimeConfig(file.id, patchValue)
  }

  return (
    <aside className={styles.pane} aria-label="Stylesheet settings">
      <div className={styles.header}>
        <span className={styles.title}>Stylesheet</span>
        <Button
          variant={config.enabled ? 'secondary' : 'ghost'}
          size="xs"
          pressed={config.enabled}
          onClick={() => patch({ enabled: !config.enabled })}
          aria-label="Stylesheet enabled"
        >
          {config.enabled ? 'On' : 'Off'}
        </Button>
      </div>

      <AssetScopeControl
        scope={config.scope}
        pages={scopeOptions}
        onChange={(scope) => patch({ scope })}
        ariaLabelPrefix="Stylesheet"
      />

      <div className={styles.field}>
        <span className={styles.label}>Priority</span>
        <Input
          aria-label="Stylesheet priority"
          fieldSize="xs"
          type="number"
          value={String(config.priority)}
          onChange={(event) => {
            const next = Number(event.target.value)
            patch({ priority: Number.isFinite(next) ? next : DEFAULT_STYLE_RUNTIME_CONFIG.priority })
          }}
        />
      </div>
    </aside>
  )
}
