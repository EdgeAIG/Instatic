import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { CmsPluginsPayload, PluginAdminPageRoute } from '@core/plugin-sdk'
import { listCmsPlugins } from '@core/persistence'
import EditorLayout from '../app/EditorLayout'
import { SettingsButton } from '../editor/components/Toolbar/SettingsButton'
import { PluginPageRenderer } from './PluginPageRenderer'
import styles from './PluginsAdmin.module.css'

const emptyPayload: CmsPluginsPayload = { plugins: [], adminPages: [] }

export function PluginPageAdmin() {
  const { pluginId = '', pageId = '' } = useParams()
  const [payload, setPayload] = useState<CmsPluginsPayload>(emptyPayload)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadPlugins() {
      setLoading(true)
      setError(null)
      try {
        const nextPayload = await listCmsPlugins()
        if (!cancelled) setPayload(nextPayload)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load plugin page')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadPlugins()
    return () => { cancelled = true }
  }, [])

  const page = useMemo<PluginAdminPageRoute | null>(() => {
    return payload.adminPages.find((candidate) =>
      candidate.pluginId === pluginId && candidate.id === pageId
    ) ?? null
  }, [pageId, payload.adminPages, pluginId])

  return (
    <EditorLayout
      workspace="pluginPage"
      toolbarRightSlot={<SettingsButton />}
      contentCanvas={(
        <main className={styles.pluginsCanvas} data-testid="plugin-page-admin-canvas">
          {loading ? (
            <p className={styles.emptyState}>Loading plugin page...</p>
          ) : error ? (
            <p className={styles.error} role="alert">{error}</p>
          ) : page ? (
            <PluginPageRenderer page={page} />
          ) : (
            <section className={styles.emptyPluginPage} aria-labelledby="plugin-page-missing">
              <h1 id="plugin-page-missing">Plugin page unavailable</h1>
              <p>The plugin may be disabled, removed, or using a page that no longer exists.</p>
            </section>
          )}
        </main>
      )}
    />
  )
}
