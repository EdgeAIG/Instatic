/**
 * Dashboard widget icon registry — maps `iconName` strings declared by
 * plugins (via `api.dashboard.widgets.register({ iconName })`) to actual
 * `pixel-art-icons` components.
 *
 * Mirrors the curated lookup in
 * `src/admin/pages/site/sidebars/PanelRail/pluginPanelIcons.ts` — plugins
 * can't reach arbitrary icon files at runtime, so the dashboard bundle
 * stays tree-shakeable and the surface area authors compile against is
 * explicit. Unknown names fall back to `ChartSolidIcon` (a generic
 * dashboard glyph).
 *
 * Adding a new icon: import it here and add a record entry. First-party
 * widgets can import their icons directly — this lookup only exists
 * for plugin widgets that ship across the SDK boundary.
 */
import type { PixelArtIconComponent } from '@core/dashboard'
import { BoxSolidIcon } from 'pixel-art-icons/icons/box-solid'
import { ChartSolidIcon } from 'pixel-art-icons/icons/chart-solid'
import { CloudUploadSolidIcon } from 'pixel-art-icons/icons/cloud-upload-solid'
import { DashboardSolidIcon } from 'pixel-art-icons/icons/dashboard-solid'
import { DatabaseSolidIcon } from 'pixel-art-icons/icons/database-solid'
import { EyeSolidIcon } from 'pixel-art-icons/icons/eye-solid'
import { FileTextSolidIcon } from 'pixel-art-icons/icons/file-text-solid'
import { GlobeSolidIcon } from 'pixel-art-icons/icons/globe-solid'
import { ImageSolidIcon } from 'pixel-art-icons/icons/image-solid'
import { PenSquareSolidIcon } from 'pixel-art-icons/icons/pen-square-solid'
import { PlugSolidIcon } from 'pixel-art-icons/icons/plug-solid'
import { StarSolidIcon } from 'pixel-art-icons/icons/star-solid'
import { TrendingUpIcon } from 'pixel-art-icons/icons/trending-up'
import { UsersSolidIcon } from 'pixel-art-icons/icons/users-solid'
import { ZapSolidIcon } from 'pixel-art-icons/icons/zap-solid'

/** Icon name → component lookup, kebab-case keyed to upstream file names. */
const DASHBOARD_WIDGET_ICONS: Record<string, PixelArtIconComponent> = {
  'activity': DashboardSolidIcon,
  'box': BoxSolidIcon,
  'chart': ChartSolidIcon,
  'cloud-upload': CloudUploadSolidIcon,
  'dashboard': DashboardSolidIcon,
  'database': DatabaseSolidIcon,
  'eye': EyeSolidIcon,
  'file': FileTextSolidIcon,
  'globe': GlobeSolidIcon,
  'image': ImageSolidIcon,
  'pen': PenSquareSolidIcon,
  'plug': PlugSolidIcon,
  'star': StarSolidIcon,
  'trending-up': TrendingUpIcon,
  'users': UsersSolidIcon,
  'zap': ZapSolidIcon,
}

/**
 * Resolve a plugin-declared icon name to a `pixel-art-icons` component.
 * Falls back to `ChartSolidIcon` for any unknown name so the dashboard
 * still renders rather than crashing on a typo.
 */
export function resolveDashboardWidgetIcon(name: string): PixelArtIconComponent {
  return DASHBOARD_WIDGET_ICONS[name] ?? ChartSolidIcon
}
