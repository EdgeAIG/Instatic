/**
 * StatValue — the big numeric headline rendered at the top of most
 * stat-style dashboard widgets ("24", "1,284", "1.4 GB").
 *
 * Pulled out of inline widget code so plugins can render their own stat
 * widgets with the same visual weight as first-party widgets without
 * having to copy the styling.
 *
 * Accepts an optional `delta` slot for the small "+24%" badge typically
 * placed alongside.
 */
import type { ReactNode } from 'react'
import styles from './charts.module.css'

export interface StatValueProps {
  value: ReactNode
  /** Optional inline delta / unit. */
  delta?: ReactNode
  /** Caption rendered immediately below — "Published", "of 5 GB", etc. */
  sub?: ReactNode
}

export function StatValue({ value, delta, sub }: StatValueProps) {
  return (
    <>
      <div className={styles.statRow}>
        <div className={styles.statValue}>{value}</div>
        {delta && <div className={styles.statDelta}>{delta}</div>}
      </div>
      {sub && <div className={styles.statSub}>{sub}</div>}
    </>
  )
}

/**
 * Delta — small percentage / change indicator with semantic colouring.
 * Render as a child of `StatValue`'s `delta` slot, or stand-alone.
 */
export interface DeltaProps {
  /** Display label (e.g. "+24%", "+3 this week", "of 5 GB"). */
  children: ReactNode
  /**
   * Tone — controls colour. `auto` parses the leading char of the label
   * ("+" → up, "−" → down, anything else → flat).
   */
  tone?: 'auto' | 'up' | 'down' | 'flat'
}

export function Delta({ children, tone = 'auto' }: DeltaProps) {
  const resolved = tone === 'auto' ? inferTone(children) : tone
  return <span className={`${styles.delta} ${styles[`delta-${resolved}`]}`}>{children}</span>
}

function inferTone(value: ReactNode): 'up' | 'down' | 'flat' {
  if (typeof value !== 'string') return 'flat'
  if (value.startsWith('+')) return 'up'
  // U+2212 (mathematical minus) and ASCII hyphen
  if (value.startsWith('−') || value.startsWith('-')) return 'down'
  return 'flat'
}
