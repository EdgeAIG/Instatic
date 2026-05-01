/**
 * Toolbar — fixed top bar for the editor.
 *
 * Layout (left → right):
 *   [Site name] [UndoRedo] [divider]
 *   [ZoomControls] [spacer→] [SaveIndicator/Save] [Open in new tab] [Preview] [Publish] [Settings]
 *
 * Accessibility (WCAG 2.1 AA):
 * - role="banner" for the top-level landmark
 * - aria-label on the nav region
 * - All interactive children have 44×44px minimum touch targets
 * - Keyboard shortcuts for Undo/Redo are registered by UndoRedoButtons
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useEditorStore } from '@core/editor-store/store'
import { pluginRuntime } from '@core/extensions/runtime'
import type { RegisteredPluginToolbarButton } from '@core/plugin-sdk'
import { UndoRedoButtons } from './UndoRedoButtons'
import { ZoomControls } from './ZoomControls'
import { PublishButton } from './PublishButton'
import { PreviewButton } from './PreviewButton'
import { OpenPageInNewTabButton } from './OpenPageInNewTabButton'
import { SettingsButton } from './SettingsButton'
import { SaveIndicator } from './SaveIndicator'
import { PreviewOverlay } from '../Preview/PreviewOverlay'
import { Button } from '@ui/components/Button'
import { cn } from '@ui/cn'
import type { PersistenceSaveStatus } from '@editor/hooks/usePersistence'
import type { AdminWorkspace } from '@app/EditorLayout'
import styles from './Toolbar.module.css'

interface ToolbarProps {
  onSave?: () => void | Promise<void>
  saveStatus?: PersistenceSaveStatus
  publishEnabled?: boolean
  section?: AdminWorkspace
  adminNavigationSlot?: ReactNode
  rightSlot?: ReactNode
}

type PluginButtonStatus = {
  state: 'running' | 'success' | 'error'
  message: string
}

export function Toolbar({
  onSave,
  saveStatus,
  publishEnabled = true,
  section = 'site',
  adminNavigationSlot,
  rightSlot,
}: ToolbarProps) {
  const siteName = useEditorStore((s) => s.site?.name ?? 'Untitled Site')
  const [pluginButtons, setPluginButtons] = useState<RegisteredPluginToolbarButton[]>(() =>
    pluginRuntime.getToolbarButtons(),
  )
  const [pluginStatuses, setPluginStatuses] = useState<Record<string, PluginButtonStatus>>({})
  const pluginStatusTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    return pluginRuntime.subscribe(() => {
      setPluginButtons(pluginRuntime.getToolbarButtons())
    })
  }, [])

  useEffect(() => {
    const timers = pluginStatusTimers.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  function pluginButtonKey(button: RegisteredPluginToolbarButton): string {
    return `${button.pluginId}:${button.id}`
  }

  function setPluginStatus(key: string, status: PluginButtonStatus): void {
    const currentTimer = pluginStatusTimers.current.get(key)
    if (currentTimer) {
      clearTimeout(currentTimer)
      pluginStatusTimers.current.delete(key)
    }

    setPluginStatuses((current) => ({ ...current, [key]: status }))

    if (status.state !== 'running') {
      const timer = setTimeout(() => {
        setPluginStatuses((current) => {
          const next = { ...current }
          delete next[key]
          return next
        })
        pluginStatusTimers.current.delete(key)
      }, 4000)
      pluginStatusTimers.current.set(key, timer)
    }
  }

  async function runPluginButtonCommand(button: RegisteredPluginToolbarButton): Promise<void> {
    const key = pluginButtonKey(button)
    setPluginStatus(key, {
      state: 'running',
      message: `${button.label} running`,
    })

    try {
      const result = await pluginRuntime.runCommand(button.command)
      setPluginStatus(key, {
        state: 'success',
        message: result && typeof result === 'object' && result.message
          ? result.message
          : `${button.label} complete`,
      })
    } catch (err) {
      console.error('[plugin-runtime] command failed:', err)
      setPluginStatus(key, {
        state: 'error',
        message: err instanceof Error ? err.message : `${button.label} failed`,
      })
    }
  }

  return (
    <>
      {/* Preview overlay rendered outside the toolbar so it can cover the whole screen */}
      <PreviewOverlay />
      <header
        role="banner"
        aria-label="Editor toolbar"
        data-testid="toolbar"
        className={styles.header}
      >
        {/* ── Left section ────────────────────────────────────────────────── */}

        {/* Site name */}
        <span
          className={styles.siteName}
          title={siteName}
          aria-label={`Site: ${siteName}`}
        >
          {siteName}
        </span>
        {adminNavigationSlot ?? <DefaultAdminNavigation section={section} />}

        <div className={styles.workspaceToolbarItems}>
          <Divider />
          <UndoRedoButtons />
          {pluginButtons.map((button) => {
            const key = pluginButtonKey(button)
            const status = pluginStatuses[key]
            const statusId = `plugin-command-status-${button.pluginId}-${button.id}`
            return (
              <div key={key} className={styles.pluginButtonWrapper}>
                <Button
                  variant="secondary"
                  size="sm"
                  className={styles.pluginButton}
                  aria-describedby={status ? statusId : undefined}
                  data-state={status?.state}
                  disabled={status?.state === 'running'}
                  onClick={() => {
                    void runPluginButtonCommand(button)
                  }}
                >
                  <span>{status?.state === 'running' ? `${button.label}...` : button.label}</span>
                </Button>
                {status && (
                  <span
                    id={statusId}
                    role="status"
                    aria-live="polite"
                    className={cn(
                      styles.pluginToast,
                      status.state === 'error' && styles.pluginToastError,
                    )}
                  >
                    {status.message}
                  </span>
                )}
              </div>
            )
          })}

          {/* ── Spacer ──────────────────────────────────────────────────────── */}
          <div className={styles.spacer} aria-hidden="true" />

          {/* ── Right section ───────────────────────────────────────────────── */}
          {rightSlot ?? (
            <>
              <ZoomControls />
              <Divider />
              <SaveIndicator onSave={onSave} saveStatus={saveStatus} />
              <Divider />
              <OpenPageInNewTabButton />
              <PreviewButton />
              <PublishButton enabled={publishEnabled} onSave={onSave} />
              <SettingsButton />
            </>
          )}
        </div>
      </header>
    </>
  )
}

function DefaultAdminNavigation({ section }: { section: AdminWorkspace }) {
  return (
    <>
      {section === 'site' ? (
        <span className={styles.activeSection}>Site</span>
      ) : (
        <a className={styles.adminLink} href="/admin/site">Site</a>
      )}
      {section === 'content' ? (
        <span className={styles.activeSection}>Content</span>
      ) : (
        <a className={styles.adminLink} href="/admin/content">Content</a>
      )}
      {section === 'plugins' ? (
        <span className={styles.activeSection}>Plugins</span>
      ) : (
        <a className={styles.adminLink} href="/admin/plugins">Plugins</a>
      )}
    </>
  )
}

function Divider() {
  return (
    <div
      aria-hidden="true"
      className={styles.divider}
    />
  )
}
