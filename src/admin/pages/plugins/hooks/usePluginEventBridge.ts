/**
 * Plugin event bridge — global side-effect handler for the live plugin
 * SSE stream. Mount once at the admin shell so plugin lifecycle events
 * (crash / parked / recovered / restarted / installed / updated /
 * uninstalled / enabled / disabled) reach the user from any admin route.
 *
 * Side effects:
 *  1. Push a toast on `crash` and `parked` — visible regardless of which
 *     admin page the user is on. `parked` (auto-respawn budget exhausted)
 *     gets the highest-severity styling because it requires manual action.
 *  2. Maintain the global "plugins-in-error" snapshot via
 *     `pluginIssuesStore` — drives the red dot on the Plugins nav link.
 *  3. Re-fetch the canonical plugins list whenever an event arrives, so
 *     the snapshot stays accurate even if the event sequence got
 *     coalesced or dropped (defensive — SSE is reliable, but a fresh
 *     fetch costs ~50ms and removes any "stale store" doubt).
 */

import { useEffect } from 'react'
import { pushToast } from '@ui/components/Toast'
import { listCmsPlugins } from '@core/persistence'
import { subscribePluginEvents, type PluginEvent } from '../utils/pluginEventStream'
import {
  clearPluginInError,
  markPluginInError,
  setPluginsInErrorFromList,
} from '../utils/pluginIssuesStore'

export function usePluginEventBridge(enabled = true): void {
  useEffect(() => {
    if (!enabled) {
      setPluginsInErrorFromList([])
      return
    }

    // Initial fetch — populate the in-error set at admin mount, before any
    // event arrives. This is what gives the nav badge its initial state on
    // a hard page load.
    void listCmsPlugins().then((payload) => {
      setPluginsInErrorFromList(payload.plugins)
    }).catch((err: unknown) => {
      console.error('[plugin-event-bridge] initial plugin list fetch failed:', err)
    })

    const unsubscribe = subscribePluginEvents((event) => {
      void handlePluginEvent(event)
    })
    return unsubscribe
  }, [enabled])
}

async function handlePluginEvent(event: PluginEvent): Promise<void> {
  switch (event.kind) {
    case 'crash':
      // Within budget — auto-respawn already underway. Keep the user
      // informed but don't escalate to error styling.
      pushToast({
        kind: 'warning',
        title: `Plugin "${event.pluginId}" crashed`,
        body: `Auto-respawning (crash #${event.recentCrashCount} in 5min). Reason: ${event.reason}`,
        location: 'plugin-event-bridge',
      })
      break

    case 'parked':
      // Crash budget exceeded — needs manual intervention.
      pushToast({
        kind: 'error',
        title: `Plugin "${event.pluginId}" parked in error state`,
        body: `Crashed ${event.recentCrashCount} times in 5min. Open the Plugins page to restart.`,
        location: 'plugin-event-bridge',
      })
      markPluginInError(event.pluginId)
      break

    case 'recovered':
      // Successful auto-respawn is "good news, no action needed" — surface
      // it silently in the issues store (clears the in-error badge) but
      // skip the toast. Site owners only care about events that require
      // attention; firing a recovery toast for every transient crash
      // would just create noise (and on a repeatedly-failing plugin, we'd
      // alternate "crashed" and "recovered" until the budget exhausts).
      clearPluginInError(event.pluginId)
      break

    case 'restarted':
      clearPluginInError(event.pluginId)
      break

    case 'disabled':
    case 'uninstalled':
      clearPluginInError(event.pluginId)
      break

    case 'installed':
    case 'updated':
    case 'enabled':
      // These don't affect the in-error set in any direction; the
      // post-event re-fetch below brings the snapshot back in line.
      break
  }

  // Defensive resync — keep the in-error snapshot canonical even if we
  // missed an intermediate event. Cheap; the response is small + cached.
  try {
    const payload = await listCmsPlugins()
    setPluginsInErrorFromList(payload.plugins)
  } catch (err) {
    console.error('[plugin-event-bridge] post-event resync failed:', err)
  }
}
