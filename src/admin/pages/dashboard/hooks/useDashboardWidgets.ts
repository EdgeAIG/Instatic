/**
 * useDashboardWidgets — subscribe to the live widget registry.
 *
 * Lives in `@admin/pages/dashboard/hooks/` (NOT `@core/dashboard/`)
 * because the core layer is framework-agnostic — runtime React imports
 * in `src/core/` are blocked by the phase-0 architecture gate. The
 * registry itself lives in `@core/dashboard` so server-side / SDK code
 * can reason about it without dragging React along; only the React
 * subscription hook is admin-shell-local.
 */
import { useSyncExternalStore } from 'react'
import { dashboardWidgetRegistry } from '@core/dashboard'
import type { DashboardWidgetDefinition } from '@core/dashboard'

export function useDashboardWidgets(): readonly DashboardWidgetDefinition[] {
  return useSyncExternalStore(
    dashboardWidgetRegistry.subscribe.bind(dashboardWidgetRegistry),
    dashboardWidgetRegistry.list.bind(dashboardWidgetRegistry),
    dashboardWidgetRegistry.list.bind(dashboardWidgetRegistry),
  )
}
