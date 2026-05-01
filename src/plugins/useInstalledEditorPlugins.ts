import { useEffect } from 'react'
import { activateInstalledEditorPlugins } from '../core/extensions/editorPluginLoader'
import { CMS_PLUGINS_CHANGED_EVENT } from './pluginEvents'

export function useInstalledEditorPlugins(): void {
  useEffect(() => {
    let cancelled = false

    async function activatePlugins() {
      const result = await activateInstalledEditorPlugins()
      if (!cancelled && result.failed.length > 0) {
        console.error('Some editor plugins failed to activate', result.failed)
      }
    }

    function refreshPlugins() {
      void activatePlugins().catch(() => {
        // The editor remains usable when plugin metadata cannot be loaded.
      })
    }

    refreshPlugins()
    window.addEventListener(CMS_PLUGINS_CHANGED_EVENT, refreshPlugins)

    return () => {
      cancelled = true
      window.removeEventListener(CMS_PLUGINS_CHANGED_EVENT, refreshPlugins)
    }
  }, [])
}
