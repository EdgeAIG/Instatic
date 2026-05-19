/**
 * Domain widget — primary site domain + DNS / HTTPS verification rows.
 */
import { GlobeSolidIcon } from 'pixel-art-icons/icons/globe-solid'
import type { DashboardWidgetRendererProps } from '@core/dashboard'
import { Widget } from '../components/Widget'
import styles from './widgets.module.css'

export function DomainWidget({ span, editing }: DashboardWidgetRendererProps) {
  return (
    <Widget
      widgetId="domain"
      title="Domain"
      icon={GlobeSolidIcon}
      tint="sky"
      span={span}
      editing={editing}
    >
      <div className={styles.domainName}>pagebuilder.dev</div>
      <div>
        <span className={styles.wlistMeta}>SSL · auto-renew</span>
      </div>
      <div className={styles.domainList}>
        <div>
          <span>A record</span>
          <span className={styles.domainOk}>verified</span>
        </div>
        <div>
          <span>HTTPS</span>
          <span className={styles.domainOk}>active</span>
        </div>
      </div>
    </Widget>
  )
}
