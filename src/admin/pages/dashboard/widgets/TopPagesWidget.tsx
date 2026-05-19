/**
 * Top Pages widget — sorted list of most-viewed paths with view counts +
 * percent delta.
 */
import { StarSolidIcon } from 'pixel-art-icons/icons/star-solid'
import { Delta } from '@ui/components/charts'
import type { DashboardWidgetRendererProps } from '@core/dashboard'
import { Widget } from '../components/Widget'
import styles from './widgets.module.css'

interface Row { path: string; views: string; delta: string }

const ROWS: readonly Row[] = [
  { path: '/', views: '4,820', delta: '+12%' },
  { path: '/blog/launching-page-builder', views: '2,114', delta: '+38%' },
  { path: '/pricing', views: '1,608', delta: '+4%' },
  { path: '/docs/plugins', views: '980', delta: '−2%' },
  { path: '/changelog', views: '742', delta: '+9%' },
]

export function TopPagesWidget({ span, editing }: DashboardWidgetRendererProps) {
  return (
    <Widget
      widgetId="topPages"
      title="Top pages"
      icon={StarSolidIcon}
      tint="lilac"
      span={span}
      editing={editing}
    >
      <ul className={styles.wlist}>
        {ROWS.map((r) => (
          <li key={r.path}>
            <span className={styles.wlistTitle}>
              <span className={styles.wlistPath}>{r.path}</span>
            </span>
            <span className={styles.wlistMeta}>
              {r.views}
              <span className={styles.deltaSpacing}>
                <Delta>{r.delta}</Delta>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Widget>
  )
}
