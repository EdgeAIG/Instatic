/**
 * Widget — shared chrome for every dashboard tile.
 *
 * Renders the achromatic card surface, the title row (tint dot, icon,
 * title, optional action slot, drag handle, kebab menu), and the content
 * body. The grid span is set from outside via the `span` prop and
 * forwarded as a `data-span` attribute so the grid stylesheet can place
 * the card with `grid-column: span N`.
 *
 * Each widget renderer composes this primitive directly — that keeps the
 * registry metadata (name, icon, tint, defaultSize) authoritative only
 * for the block picker, while the widget body owns whatever it wants in
 * the title row (range tabs, plus buttons, etc.).
 *
 * The `tint` token is published as a CSS custom property (`--tint`) so
 * children (chart primitives, bars, sparkline gradients) can read it
 * directly through the cascade without prop drilling.
 */
import { type CSSProperties, type ReactNode } from 'react'
import { DragAndDropSolidIcon } from 'pixel-art-icons/icons/drag-and-drop-solid'
import { MoreHorizontalSolidIcon } from 'pixel-art-icons/icons/more-horizontal-solid'
import type { DashboardWidgetTint, PixelArtIconComponent } from '@core/dashboard'
import { Button } from '@ui/components/Button'
import { cn } from '@ui/cn'
import styles from './Widget.module.css'

export interface WidgetProps {
  /** Identifier — used by the DnD layer to track this card. */
  widgetId: string
  title: string
  icon?: PixelArtIconComponent
  tint: DashboardWidgetTint
  /** Grid column span (1 .. 12). */
  span: number
  /** Optional action slot rendered between the title and the drag handle. */
  action?: ReactNode
  /** True when the dashboard is in customize mode (drag handle becomes visible). */
  editing: boolean
  children?: ReactNode
}

const TINT_TOKEN: Record<DashboardWidgetTint, string> = {
  mint: 'var(--rail-tint-mint)',
  lilac: 'var(--rail-tint-lilac)',
  sky: 'var(--rail-tint-sky)',
  peach: 'var(--rail-tint-peach)',
}

export function Widget({
  widgetId,
  title,
  icon: TitleIcon,
  tint,
  span,
  action,
  editing,
  children,
}: WidgetProps) {
  const style: CSSProperties = {
    ['--tint' as string]: TINT_TOKEN[tint],
  }

  return (
    <section
      className={cn(styles.widget, editing && styles.editing)}
      style={style}
      data-widget={widgetId}
      data-span={span}
    >
      <header className={styles.head}>
        <div className={styles.title}>
          <span className={styles.dot} />
          {TitleIcon && <TitleIcon size={11} aria-hidden="true" />}
          <span>{title}</span>
        </div>
        <div className={styles.headEnd}>
          {action}
          {editing ? (
            <span className={styles.handle} aria-hidden="true">
              <DragAndDropSolidIcon size={12} />
            </span>
          ) : (
            <Button
              variant="ghost"
              size="micro"
              iconOnly
              className={styles.menu}
              aria-label={`${title} options`}
            >
              <MoreHorizontalSolidIcon size={12} />
            </Button>
          )}
        </div>
      </header>
      {children}
    </section>
  )
}
