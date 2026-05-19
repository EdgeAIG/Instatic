/**
 * RangeTabs — small inline pill segment used inside widget headers (e.g.
 * Visitors' "24h · 7d · 30d") and at the dashboard top ("Today · 7d · 30d ·
 * All"). Renders one tab child per option styled via the
 * `data-active` attribute the shared CSS module reads.
 *
 * Not a full `Tabs` component — these are display-only, no aria-tabpanel
 * wiring required (the change is local to the widget that owns the state).
 */
import { Button } from '@ui/components/Button'
import styles from './RangeTabs.module.css'

export interface RangeTabsProps<T extends string> {
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (next: T) => void
  ariaLabel?: string
}

export function RangeTabs<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: RangeTabsProps<T>) {
  return (
    <div className={styles.seg} role="tablist" aria-label={ariaLabel}>
      {options.map((opt) => (
        <Button
          key={opt.value}
          variant="ghost"
          size="micro"
          className={styles.tab}
          role="tab"
          aria-selected={opt.value === value}
          data-active={opt.value === value ? 'true' : undefined}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </Button>
      ))}
    </div>
  )
}
