/**
 * Posts widget — total posts + a daily-distribution Bars chart over the
 * last 28 days, with the last 6 days highlighted as the "current week".
 */
import { PenSquareSolidIcon } from 'pixel-art-icons/icons/pen-square-solid'
import { Bars, StatValue } from '@ui/components/charts'
import type { DashboardWidgetRendererProps } from '@core/dashboard'
import { Widget } from '../components/Widget'

// Deterministic faux distribution: 28 days, with the last week trending up.
const DAILY = Array.from({ length: 28 }, (_, i) => 18 + ((i * 13) % 56))
const ACCENT = [22, 23, 24, 25, 26, 27]

export function PostsWidget({ span, editing }: DashboardWidgetRendererProps) {
  return (
    <Widget
      widgetId="posts"
      title="Posts"
      icon={PenSquareSolidIcon}
      tint="peach"
      span={span}
      editing={editing}
    >
      <StatValue value="138" sub={<span>Total · 12 categories</span>} />
      <Bars data={DAILY} accentIndexes={ACCENT} />
    </Widget>
  )
}
