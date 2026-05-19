/**
 * Plugins widget — list of installed plugins with their status dot
 * (active / update / inactive).
 */
import { PlugSolidIcon } from 'pixel-art-icons/icons/plug-solid'
import type { DashboardWidgetRendererProps } from '@core/dashboard'
import { Widget } from '../components/Widget'
import styles from './widgets.module.css'

interface PluginRow { name: string; version: string; state: 'active' | 'update' | 'inactive' }

const PLUGINS: readonly PluginRow[] = [
  { name: 'SEO Meta', version: '1.2.0', state: 'active' },
  { name: 'Comments', version: '0.8.4', state: 'active' },
  { name: 'Image Optimizer', version: '2.0.1', state: 'update' },
  { name: 'Analytics Lite', version: '0.4.0', state: 'inactive' },
]

function dotClass(state: PluginRow['state']): string {
  if (state === 'active') return styles.dotGreen
  if (state === 'update') return styles.dotAmber
  return styles.dotMuted
}

function stateLabel(state: PluginRow['state']): string {
  if (state === 'active') return 'active'
  if (state === 'update') return 'update'
  return 'off'
}

export function PluginsWidget({ span, editing }: DashboardWidgetRendererProps) {
  return (
    <Widget
      widgetId="plugins"
      title="Plugins"
      icon={PlugSolidIcon}
      tint="mint"
      span={span}
      editing={editing}
    >
      <div>
        {PLUGINS.map((p) => (
          <div key={p.name} className={styles.pluginRow}>
            <span className={styles.pluginIcon}>
              <PlugSolidIcon size={12} aria-hidden="true" />
            </span>
            <span className={styles.pluginName}>
              {p.name}
              <small>v{p.version}</small>
            </span>
            <span className={styles.wlistMeta}>
              <span className={`${styles.dot} ${dotClass(p.state)}`} />
              {stateLabel(p.state)}
            </span>
          </div>
        ))}
      </div>
    </Widget>
  )
}
