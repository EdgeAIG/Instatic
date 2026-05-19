/**
 * Pages widget — total published count, drafts / scheduled counters,
 * +N this week delta. Static counters; wires up to the data layer once
 * the dashboard data hooks land.
 */
import { FileTextSolidIcon } from 'pixel-art-icons/icons/file-text-solid'
import { StatValue, Delta } from '@ui/components/charts'
import type { DashboardWidgetRendererProps } from '@core/dashboard'
import { Widget } from '../components/Widget'
import styles from './widgets.module.css'

export function PagesWidget({ span, editing }: DashboardWidgetRendererProps) {
  return (
    <Widget
      widgetId="pages"
      title="Pages"
      icon={FileTextSolidIcon}
      tint="lilac"
      span={span}
      editing={editing}
    >
      <StatValue
        value="24"
        sub={(
          <>
            <span>Published</span>
            <Delta>+3 this week</Delta>
          </>
        )}
      />
      <div className={styles.subFootRow}>
        <span>3 drafts</span>
        <span>1 scheduled</span>
      </div>
    </Widget>
  )
}
