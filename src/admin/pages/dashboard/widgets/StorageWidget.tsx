/**
 * Storage widget — used / total stat + a StackedBar showing the
 * breakdown (media, pages, plugins, database).
 */
import { DatabaseSolidIcon } from 'pixel-art-icons/icons/database-solid'
import { StackedBar, StatValue, Delta } from '@ui/components/charts'
import type { DashboardWidgetRendererProps } from '@core/dashboard'
import { Widget } from '../components/Widget'

const SEGMENTS = [
  { label: 'Media', value: 920, color: 'var(--rail-tint-mint)' },
  { label: 'Pages', value: 240, color: 'var(--rail-tint-lilac)' },
  { label: 'Plugins', value: 180, color: 'var(--rail-tint-sky)' },
  { label: 'Database', value: 60, color: 'var(--rail-tint-peach)' },
] as const

const TOTAL_MB = 5120 // 5 GB cap, expressed in MB so the legend formatter works.

export function StorageWidget({ span, editing }: DashboardWidgetRendererProps) {
  return (
    <Widget
      widgetId="storage"
      title="Storage"
      icon={DatabaseSolidIcon}
      tint="sky"
      span={span}
      editing={editing}
    >
      <StatValue
        value="1.4 GB"
        delta={<Delta tone="flat">of 5 GB</Delta>}
        sub={<span>27% used · SQLite · self-hosted</span>}
      />
      <StackedBar segments={SEGMENTS} total={TOTAL_MB} />
    </Widget>
  )
}
