/**
 * Visitors — pageview sparkline with a 24h / 7d / 30d range toggle.
 *
 * Static demo data; real wiring lands when the first-party analytics
 * collector ships (or a plugin registers an `analytics.visitors` widget
 * that supersedes this one).
 */
import { useState } from 'react'
import { EyeSolidIcon } from 'pixel-art-icons/icons/eye-solid'
import { Sparkline, StatValue, Delta } from '@ui/components/charts'
import type { DashboardWidgetRendererProps } from '@core/dashboard'
import { Widget } from '../components/Widget'
import { RangeTabs } from '../components/RangeTabs'
import styles from './widgets.module.css'

type Range = '24h' | '7d' | '30d'

const DATA: Record<Range, readonly number[]> = {
  '24h': [4, 6, 5, 8, 12, 9, 14, 18, 22, 20, 24, 28, 26, 31, 36, 34, 39, 42, 38, 41, 36, 30, 27, 22],
  '7d': [180, 220, 260, 240, 310, 380, 360, 420, 410, 460, 500, 540, 520, 600, 640, 700, 680, 760, 820, 790, 860, 940],
  '30d': [120, 180, 240, 200, 260, 320, 380, 360, 420, 480, 460, 540, 580, 620, 700, 760, 820, 800, 920, 1040, 1100, 1180, 1260, 1340, 1420, 1480, 1560, 1640],
}

const TOTALS: Record<Range, string> = { '24h': '1,284', '7d': '12,847', '30d': '47,210' }
const DELTAS: Record<Range, string> = { '24h': '+8.2%', '7d': '+24.6%', '30d': '+18.1%' }
const SINCE: Record<Range, string> = { '24h': '00:00', '7d': 'May 13', '30d': 'Apr 20' }

export function VisitorsWidget({ span, editing }: DashboardWidgetRendererProps) {
  const [range, setRange] = useState<Range>('7d')
  return (
    <Widget
      widgetId="visitors"
      title="Visitors"
      icon={EyeSolidIcon}
      tint="mint"
      span={span}
      editing={editing}
      action={(
        <RangeTabs<Range>
          value={range}
          options={[
            { value: '24h', label: '24h' },
            { value: '7d', label: '7d' },
            { value: '30d', label: '30d' },
          ]}
          onChange={setRange}
          ariaLabel="Visitor range"
        />
      )}
    >
      <StatValue
        value={TOTALS[range]}
        delta={<Delta>{DELTAS[range]}</Delta>}
        sub={<span>Unique visitors · all pages</span>}
      />
      <div className={styles.fillBottom}>
        <Sparkline data={DATA[range]} tint="var(--rail-tint-mint)" height={68} />
        <div className={styles.axisRow}>
          <span>{SINCE[range]}</span>
          <span>Now</span>
        </div>
      </div>
    </Widget>
  )
}
