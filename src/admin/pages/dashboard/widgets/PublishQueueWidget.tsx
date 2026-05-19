/**
 * Publish queue widget — lists upcoming + in-flight builds with a status
 * badge per row.
 */
import { CloudUploadSolidIcon } from 'pixel-art-icons/icons/cloud-upload-solid'
import type { DashboardWidgetRendererProps } from '@core/dashboard'
import { Widget } from '../components/Widget'
import styles from './widgets.module.css'

interface Row { title: string; status: 'queued' | 'building' | 'draft'; time: string }

const ROWS: readonly Row[] = [
  { title: '/changelog/v0.9', status: 'queued', time: 'in 12m' },
  { title: '/blog/sandbox-deep-dive', status: 'queued', time: 'in 1h' },
  { title: '/docs/plugins/sandbox', status: 'building', time: 'now' },
  { title: '/team/joining-us', status: 'draft', time: '—' },
]

function badgeClass(status: Row['status']): string {
  if (status === 'queued') return styles.badgeQueued
  if (status === 'building') return styles.badgeLive
  return styles.badgeDraft
}

export function PublishQueueWidget({ span, editing }: DashboardWidgetRendererProps) {
  return (
    <Widget
      widgetId="publish"
      title="Publish queue"
      icon={CloudUploadSolidIcon}
      tint="sky"
      span={span}
      editing={editing}
    >
      <ul className={styles.wlist}>
        {ROWS.map((r) => (
          <li key={r.title}>
            <span className={styles.wlistTitle}>
              <span className={styles.wlistPath}>{r.title}</span>
            </span>
            <span className={styles.wlistMeta}>
              <span className={`${styles.badge} ${badgeClass(r.status)}`}>{r.status}</span>
              <span>{r.time}</span>
            </span>
          </li>
        ))}
      </ul>
    </Widget>
  )
}
