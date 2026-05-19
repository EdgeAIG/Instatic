/**
 * Activity widget — recent edits / publishes / installs feed. The first
 * cut renders a static demo; once the audit log endpoint is on the admin
 * shell this swaps to a live `useAuditFeed()` hook.
 */
import { DashboardSolidIcon } from 'pixel-art-icons/icons/dashboard-solid'
import type { ReactNode } from 'react'
import type { DashboardWidgetRendererProps } from '@core/dashboard'
import { Widget } from '../components/Widget'
import styles from './widgets.module.css'

interface FeedItem { who: string; body: ReactNode; time: string }

const ROWS: readonly FeedItem[] = [
  { who: 'AT', body: <>edited <code>/pricing</code></>, time: '2m' },
  { who: 'KP', body: <>published <code>/blog/launching-page-builder</code></>, time: '24m' },
  { who: 'AI', body: <>imported framework variables <em>v1.4</em></>, time: '1h' },
  { who: 'AT', body: <>installed plugin <code>seo-meta</code></>, time: '3h' },
  { who: 'SY', body: <>backup completed <em>3.2 MB</em></>, time: 'yest.' },
]

export function ActivityWidget({ span, editing }: DashboardWidgetRendererProps) {
  return (
    <Widget
      widgetId="activity"
      title="Activity"
      icon={DashboardSolidIcon}
      tint="peach"
      span={span}
      editing={editing}
    >
      <div className={styles.feed}>
        {ROWS.map((r, i) => (
          <div key={i} className={styles.feedRow}>
            <span className={styles.feedAvatar}>{r.who}</span>
            <span className={styles.feedBody}>{r.body}</span>
            <span className={styles.feedTime}>{r.time}</span>
          </div>
        ))}
      </div>
    </Widget>
  )
}
