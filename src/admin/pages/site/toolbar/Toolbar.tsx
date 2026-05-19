/**
 * Toolbar — fixed top bar shared by every admin route.
 *
 * Layout (left → right):
 *   [Site brand] [admin nav] [breadcrumb slot]
 *   [Plugin buttons] [spacer→] [right slot]    [Account menu]
 *
 * Undo/Redo lives inside the canvas notch (CanvasNotch), not the toolbar —
 * those controls only operate on the visual editor's page tree, so they have
 * no meaning on admin pages outside the canvas (Content, Plugins, …).
 *
 * Composition contract:
 *   - `siteName` / `faviconUrl` are PROPS, NOT a store subscription. That
 *     keeps the toolbar usable from `AdminPageLayout` (Plugins / Users /
 *     Account / plugin admin pages) without pulling the editor store into
 *     the non-editor admin bundle.
 *   - The editor-specific overlay (preview iframe) and breadcrumb (VC mode)
 *     are passed in by the canvas layout via `overlay` and `breadcrumbSlot`.
 *     AdminPageLayout passes neither and the toolbar shows nothing in those
 *     positions.
 *   - The `rightSlot` is owned by the caller — `AdminCanvasLayout` builds
 *     zoom / publish / settings buttons; `AdminPageLayout` builds its own
 *     toolbar right slot + settings button.
 *
 * Accessibility (WCAG 2.1 AA):
 * - role="banner" for the top-level landmark
 * - aria-label on the nav region
 * - All interactive children have 44×44px minimum touch targets
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArticleSolidIcon } from 'pixel-art-icons/icons/article-solid'
import { DashboardSolidIcon } from 'pixel-art-icons/icons/dashboard-solid'
import { DatabaseSolidIcon } from 'pixel-art-icons/icons/database-solid'
import { ImagesSolidIcon } from 'pixel-art-icons/icons/images-solid'
import { LayoutSolidIcon } from 'pixel-art-icons/icons/layout-solid'
import { PackageSolidIcon } from 'pixel-art-icons/icons/package-solid'
import { pluginRuntime } from '@core/plugins/runtime'
import type { RegisteredPluginToolbarButton } from '@core/plugin-sdk'
import { AccountMenuButton } from '@admin/shared/AccountMenuButton'
import { Button } from '@ui/components/Button'
import { cn } from '@ui/cn'
import type { AdminWorkspace } from '@admin/workspace'
import styles from './Toolbar.module.css'

const NAV_ICON_SIZE = 13

interface ToolbarProps {
  /** Site name shown in the brand position. Defaults to "Untitled Site". */
  siteName?: string
  /** Optional favicon URL. When set, renders instead of the site-name text. */
  faviconUrl?: string | null
  /** Active admin section — drives the default nav slot's highlight. */
  section?: AdminWorkspace
  /** Replaces the default admin section navigation links. */
  adminNavigationSlot?: ReactNode
  /**
   * Optional content rendered between the admin nav and the plugin buttons.
   * Used by AdminCanvasLayout to mount the VC breadcrumb (which is editor-
   * only and lazy-loaded via its own chunk).
   */
  breadcrumbSlot?: ReactNode
  /**
   * Full-screen overlay siblings rendered before the toolbar header. Used by
   * AdminCanvasLayout to mount the preview overlay (also editor-only and
   * lazy-loaded). The overlay is a sibling rather than a child so it can
   * cover the whole viewport instead of being clipped by the toolbar's
   * stacking context.
   */
  overlay?: ReactNode
  /**
   * Content rendered immediately before the account menu. Both layouts
   * own this region: AdminCanvasLayout fills it with zoom / publish /
   * settings; AdminPageLayout passes any page-specific toolbar items
   * followed by the SettingsButton.
   */
  rightSlot?: ReactNode
}

type PluginButtonStatus = {
  state: 'running' | 'success' | 'error'
  message: string
}

export function Toolbar({
  siteName = 'Untitled Site',
  faviconUrl = null,
  section = 'site',
  adminNavigationSlot,
  breadcrumbSlot,
  overlay,
  rightSlot,
}: ToolbarProps) {
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
      {overlay}
      <header
        role="banner"
        aria-label="Editor toolbar"
        data-testid="toolbar"
        className={styles.header}
      >
        {/* ── Left section ────────────────────────────────────────────────── */}

        {/* Site brand — favicon when configured (icon replaces text per
            operator preference); falls back to the site name text for fresh
            installs that haven't picked a logo yet. The image is rendered
            here purely as a visual brand mark: SafeURL'd assets land at
            `/uploads/...` from the picker, so we don't need extra escaping. */}
        {faviconUrl ? (
          <img
            className={styles.siteFavicon}
            src={faviconUrl}
            alt=""
            title={siteName}
            aria-label={`Site: ${siteName}`}
            draggable={false}
          />
        ) : (
          <span
            className={styles.siteName}
            title={siteName}
            aria-label={`Site: ${siteName}`}
          >
            {siteName}
          </span>
        )}
        {adminNavigationSlot ?? <DefaultAdminNavigation section={section} />}

        {/* Optional breadcrumb region (e.g. VC mode in the canvas layout).
            The wrapper div is always rendered so the toolbar grid keeps a
            stable column count regardless of breadcrumb presence. */}
        <div className={styles.breadcrumbRegion}>{breadcrumbSlot}</div>

        <div className={styles.workspaceToolbarItems}>
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

          {/* ── Right section — caller-owned ─────────────────────────────── */}
          {rightSlot}
          {/* AccountMenuButton always rendered, regardless of `rightSlot`.
              Users may need to switch accounts / sign out from every admin
              page (Users, Content, Plugins, etc.). */}
          <AccountMenuButton />
        </div>
      </header>
    </>
  )
}

function DefaultAdminNavigation({ section }: { section: AdminWorkspace }) {
  return (
    <>
      <DefaultNavSlot
        href="/admin/dashboard"
        icon={<DashboardSolidIcon size={NAV_ICON_SIZE} aria-hidden="true" />}
        label="Dashboard"
        active={section === 'dashboard'}
      />
      <DefaultNavSlot
        href="/admin/site"
        icon={<LayoutSolidIcon size={NAV_ICON_SIZE} aria-hidden="true" />}
        label="Site"
        active={section === 'site'}
      />
      <DefaultNavSlot
        href="/admin/content"
        icon={<ArticleSolidIcon size={NAV_ICON_SIZE} aria-hidden="true" />}
        label="Content"
        active={section === 'content'}
      />
      <DefaultNavSlot
        href="/admin/data"
        icon={<DatabaseSolidIcon size={NAV_ICON_SIZE} aria-hidden="true" />}
        label="Data"
        active={section === 'data'}
      />
      <DefaultNavSlot
        href="/admin/media"
        icon={<ImagesSolidIcon size={NAV_ICON_SIZE} aria-hidden="true" />}
        label="Media"
        active={section === 'media'}
      />
      <DefaultNavSlot
        href="/admin/plugins"
        icon={<PackageSolidIcon size={NAV_ICON_SIZE} aria-hidden="true" />}
        label="Plugins"
        active={section === 'plugins'}
      />
    </>
  )
}

function DefaultNavSlot({
  href,
  icon,
  label,
  active,
}: {
  href: string
  icon: ReactNode
  label: string
  active: boolean
}) {
  if (active) {
    return (
      <span className={styles.activeSection}>
        {icon}
        <span>{label}</span>
      </span>
    )
  }
  return (
    <a className={styles.adminLink} href={href}>
      {icon}
      <span>{label}</span>
    </a>
  )
}

export function ToolbarDivider() {
  return (
    <div
      aria-hidden="true"
      className={styles.divider}
    />
  )
}
