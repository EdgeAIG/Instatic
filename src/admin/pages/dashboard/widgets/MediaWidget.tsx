/**
 * Media widget — total file count + a small 16-cell thumbnail mosaic that
 * teases the media library. Click-through wires to /admin/media once
 * Media exports its own list endpoint to the dashboard layer.
 */
import { ImageSolidIcon } from 'pixel-art-icons/icons/image-solid'
import { StatValue } from '@ui/components/charts'
import type { DashboardWidgetRendererProps } from '@core/dashboard'
import { Widget } from '../components/Widget'
import styles from './widgets.module.css'

// Indexes that should render with the accent tint vs. the muted surface.
const ACCENT_INDEXES = new Set([0, 5, 10, 15])
const EMPTY_INDEXES = new Set([4, 8, 12])

export function MediaWidget({ span, editing }: DashboardWidgetRendererProps) {
  return (
    <Widget
      widgetId="media"
      title="Media"
      icon={ImageSolidIcon}
      tint="peach"
      span={span}
      editing={editing}
    >
      <StatValue value="312" sub={<span>files · 920 MB</span>} />
      <div className={styles.mediaGrid} aria-hidden="true">
        {Array.from({ length: 16 }, (_, i) => {
          const klass = ACCENT_INDEXES.has(i)
            ? `${styles.mediaCell} ${styles.mediaCellAccent}`
            : EMPTY_INDEXES.has(i)
              ? `${styles.mediaCell} ${styles.mediaCellEmpty}`
              : styles.mediaCell
          return <span key={i} className={klass} />
        })}
      </div>
    </Widget>
  )
}
