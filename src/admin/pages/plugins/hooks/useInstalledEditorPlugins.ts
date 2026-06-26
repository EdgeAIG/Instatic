import { useEffect } from 'react'
import { activateInstalledEditorPlugins } from '@core/plugins/editorPluginLoader'
import { bindDashboardWidgetIconResolver } from '@core/plugins/runtime'
import { editorPluginModuleComponentFactory } from '@site/canvas/pluginModuleComponentFactory'
import { resolveDashboardWidgetIcon } from '@admin/pages/dashboard/widgetIcons'
import { ensurePluginRuntime } from '@admin/pluginRuntimeBootstrap'
import { CMS_PLUGINS_CHANGED_EVENT } from '@plugins/utils/pluginEvents'
import { setEditorActivationFailures } from './editorPluginActivationErrors'

// Bind the dashboard widget icon resolver at module-load time, BEFORE
// any React effect fires. Plugins call `api.dashboard.widgets.register`
// during their `activate()` hook, and that requires a bound resolver
// to map iconName strings to React components. The DashboardPage used
// to do this binding at its own module-load — but plugin activation
// runs at admin boot regardless of which route the user is on, so the
// dashboard module hadn't loaded yet when the analytics plugin tried
// to register its Visitors / Top pages widgets. Binding here, in the
// same file that owns `useInstalledEditorPlugins`, guarantees the
// resolver is ready before the activation pass it triggers.
bindDashboardWidgetIconResolver(resolveDashboardWidgetIcon)

// Session-scoped activation guard. Without it every admin layout mount would
// fire a fresh activation pass — which calls
// `pluginRuntime.reset()` at its top and unregisters all plugin widgets
// before re-registering them, causing a visible flicker where plugin
// widgets disappear from the dashboard for ~50–500 ms on every nav.
//
// Activation is idempotent (running the same plugin's `activate()`
// twice in a session is safe), so we run it once at first admin-layout mount
// and then only when something changes (CMS_PLUGINS_CHANGED_EVENT — plugin
// installed / upgraded / uninstalled, SSE plugin-state updates).
let didInitialActivation = false

export function useInstalledEditorPlugins(enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      setEditorActivationFailures([])
      return
    }

    let cancelled = false

    async function activatePlugins() {
      // The runtime MUST be ready before any plugin module dynamic-imports
      // (the plugin bundle's `import * as React from 'react'` statements
      // resolve via the `/runtime/*.js` shims, which read
      // `globalThis.__instatic`). The first call here triggers the
      // download of the plugin host UI + host hooks + plugin SDK chunks;
      // subsequent calls (on PLUGIN_CHANGED rebroadcasts, on every page
      // mount) receive the cached resolved promise instantly.
      await ensurePluginRuntime()
      if (cancelled) return
      const result = await activateInstalledEditorPlugins({
        componentFactory: editorPluginModuleComponentFactory,
      })
      if (cancelled) return
      // Fan failures out to the activation-errors store so the Plugins admin
      // page can render them inline next to server-side `lastError`. The
      // store is replaced wholesale on every pass — successful re-activation
      // clears stale entries automatically.
      setEditorActivationFailures(result.failed)
      if (result.failed.length > 0) {
        console.error('Some editor plugins failed to activate', result.failed)
      }
      didInitialActivation = true
    }

    function refreshPlugins() {
      void activatePlugins().catch(() => {
        // The editor remains usable when plugin metadata cannot be loaded.
      })
    }

    // First-mount-only activation: subsequent navigations re-use the
    // already-registered widgets / module packs. CMS_PLUGINS_CHANGED_EVENT
    // still triggers a re-activation when plugins genuinely change.
    if (!didInitialActivation) {
      refreshPlugins()
    }
    window.addEventListener(CMS_PLUGINS_CHANGED_EVENT, refreshPlugins)

    return () => {
      cancelled = true
      window.removeEventListener(CMS_PLUGINS_CHANGED_EVENT, refreshPlugins)
    }
  }, [enabled])
}
