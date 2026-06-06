/**
 * Audit tab — site-wide AI usage rollups.
 *
 * Three rollups stitched into one view:
 *   • Totals strip            — tokens in/out, USD cost, distinct chats.
 *   • Top users               — table sorted by cost.
 *   • Per-surface breakdown   — table with one row per chat scope.
 *   • Daily bars              — sparkline-style cost-per-day bar list.
 *
 * Sourced from `GET /admin/api/ai/audit?since=ISO`. Time window driven by
 * the same `RangeTabs` primitive the dashboard uses (Today / 7d / 30d /
 * All), so the data feels coherent across the admin.
 */

import { useState, type CSSProperties } from 'react'
import { useAsyncResource } from '@admin/lib/useAsyncResource'
import { RangeTabs } from '@ui/components/RangeTabs'
import {
  listAiAudit,
  type AiAuditResponse,
  type AiUsageByDayRow,
  type AiUsageByModelRow,
  type AiUsageByScopeRow,
  type AiUsageByUserRow,
} from '../../../ai/api'
import styles from '../AiPage.module.css'

type Range = 'today' | '7d' | '30d' | 'all'

const RANGE_OPTIONS: ReadonlyArray<{ value: Range; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All time' },
]

// "All time" is implemented as a long lookback rather than a separate
// no-filter path so the server has exactly one query shape to optimise.
// 365 days × 10 years comfortably outlasts any realistic self-hosted
// installation that wants to see lifetime AI cost on a single page.
const ALL_TIME_LOOKBACK_DAYS = 365 * 10

function rangeToSinceIso(range: Range): string {
  const now = new Date()
  if (range === 'today') {
    // "Today" means since the start of the operator's LOCAL calendar day, not
    // UTC midnight. setHours (local) then toISOString yields the correct UTC
    // instant for that local-midnight boundary — so an operator at UTC+2 at
    // 20:30 still sees the whole day's activity instead of an off-by-timezone
    // empty window.
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    return start.toISOString()
  }
  const days = range === '7d' ? 7 : range === '30d' ? 30 : ALL_TIME_LOOKBACK_DAYS
  const start = new Date(now)
  start.setDate(start.getDate() - days)
  return start.toISOString()
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return `< $0.01`
  if (usd < 1) return `$${usd.toFixed(2)}`
  return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

export function AuditTab() {
  const [range, setRange] = useState<Range>('30d')
  // Pass the viewer's IANA zone so the server buckets the daily rollup into
  // the operator's calendar day, not UTC. Matches the local-day boundary that
  // rangeToSinceIso already uses for the window filter.
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const { data, loading, error } = useAsyncResource(
    () => listAiAudit(rangeToSinceIso(range), timeZone),
    [range, timeZone],
    { fallbackError: 'Failed to load audit data.' },
  )

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>Usage audit</h2>
          <p>Per-user and per-surface AI usage with token + cost rollups.</p>
        </div>
        <div className={styles.auditHeaderActions}>
          <RangeTabs<Range>
            value={range}
            options={RANGE_OPTIONS}
            onChange={setRange}
            ariaLabel="Audit range"
          />
        </div>
      </div>

      {error && <p role="alert" className={styles.errorAlert}>{error}</p>}

      {loading && !data && (
        <div className={styles.emptyState}>Loading…</div>
      )}

      {data && (
        <>
          <TotalsRow data={data} />
          <ModelsPanel rows={data.byModel} />
          <div className={styles.auditPanels}>
            <UsersPanel rows={data.byUser} />
            <ScopesPanel rows={data.byScope} />
          </div>
          <DaysPanel rows={data.byDay} />
        </>
      )}
    </section>
  )
}

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  ollama: 'Ollama',
  unknown: 'Unknown (deleted credential)',
}

function ModelsPanel({ rows }: { rows: AiUsageByModelRow[] }) {
  return (
    <div className={styles.auditPanel}>
      <div className={styles.auditPanelHeader}>
        <h3 className={styles.auditPanelTitle}>By model</h3>
        <span className={styles.auditPanelHint}>{rows.length} models</span>
      </div>
      <table className={styles.auditTable}>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Model</th>
            <th className={styles.numeric}>Chats</th>
            <th className={styles.numeric}>Input</th>
            <th className={styles.numeric}>Output</th>
            <th className={styles.numeric}>Spend</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className={styles.auditEmptyRow}>
                No model activity yet.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={`${row.providerId}:${row.modelId}`}>
                <td>{PROVIDER_LABEL[row.providerId] ?? row.providerId}</td>
                <td><code>{row.modelId}</code></td>
                <td className={styles.numeric}>{formatNumber(row.chatCount)}</td>
                <td className={styles.numeric}>{formatNumber(row.promptTokens)}</td>
                <td className={styles.numeric}>{formatNumber(row.completionTokens)}</td>
                <td className={styles.numeric}>{formatCost(row.costUsd)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function TotalsRow({ data }: { data: AiAuditResponse }) {
  const { totals } = data
  // Cache-hit ratio: cached reads vs. total input the model consumed. Only
  // meaningful when the operator's using a provider that supports caching
  // (Anthropic today); OpenAI/Ollama report zero and the panel hides the
  // card. Total denominator = promptTokens (uncached billed input) +
  // cacheReadTokens (cached billed at ~10%) + cacheCreationTokens (write
  // surcharge applied once per cache lifetime).
  const cacheDenom = totals.promptTokens + totals.cacheReadTokens + totals.cacheCreationTokens
  const cacheHitPct = cacheDenom > 0
    ? Math.round((totals.cacheReadTokens / cacheDenom) * 100)
    : 0
  const showCache = totals.cacheReadTokens > 0 || totals.cacheCreationTokens > 0

  return (
    <div className={styles.auditTotalsRow}>
      <div className={styles.auditTotalCard}>
        <span className={styles.auditTotalLabel}>Spend</span>
        <span className={styles.auditTotalValue}>{formatCost(totals.costUsd)}</span>
        <span className={styles.auditTotalHint}>
          Best-effort estimate from the price table.
        </span>
      </div>
      <div className={styles.auditTotalCard}>
        <span className={styles.auditTotalLabel}>Chats</span>
        <span className={styles.auditTotalValue}>{formatNumber(totals.chatCount)}</span>
        <span className={styles.auditTotalHint}>Distinct conversations with activity.</span>
      </div>
      <div className={styles.auditTotalCard}>
        <span className={styles.auditTotalLabel}>Input tokens</span>
        <span className={styles.auditTotalValue}>{formatNumber(totals.promptTokens)}</span>
        <span className={styles.auditTotalHint}>
          {showCache
            ? `Uncached billed input. ${formatNumber(totals.cacheReadTokens)} more served from cache.`
            : 'Prompt + cached input combined.'}
        </span>
      </div>
      <div className={styles.auditTotalCard}>
        <span className={styles.auditTotalLabel}>
          {showCache ? 'Cache hit' : 'Output tokens'}
        </span>
        <span className={styles.auditTotalValue}>
          {showCache ? `${cacheHitPct}%` : formatNumber(totals.completionTokens)}
        </span>
        <span className={styles.auditTotalHint}>
          {showCache
            ? `Cached reads ÷ total input. Higher = bigger cost savings.`
            : 'Assistant text + tool-call envelopes.'}
        </span>
      </div>
    </div>
  )
}

function UsersPanel({ rows }: { rows: AiUsageByUserRow[] }) {
  return (
    <div className={styles.auditPanel}>
      <div className={styles.auditPanelHeader}>
        <h3 className={styles.auditPanelTitle}>Top users by cost</h3>
        <span className={styles.auditPanelHint}>{rows.length} users</span>
      </div>
      <table className={styles.auditTable}>
        <thead>
          <tr>
            <th>User</th>
            <th className={styles.numeric}>Chats</th>
            <th className={styles.numeric}>Input</th>
            <th className={styles.numeric}>Output</th>
            <th className={styles.numeric}>Spend</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className={styles.auditEmptyRow}>
                No AI activity in this range yet.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.userId}>
                <td>{row.userLabel}</td>
                <td className={styles.numeric}>{formatNumber(row.chatCount)}</td>
                <td className={styles.numeric}>{formatNumber(row.promptTokens)}</td>
                <td className={styles.numeric}>{formatNumber(row.completionTokens)}</td>
                <td className={styles.numeric}>{formatCost(row.costUsd)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function ScopesPanel({ rows }: { rows: AiUsageByScopeRow[] }) {
  return (
    <div className={styles.auditPanel}>
      <div className={styles.auditPanelHeader}>
        <h3 className={styles.auditPanelTitle}>By surface</h3>
        <span className={styles.auditPanelHint}>{rows.length} scopes</span>
      </div>
      <table className={styles.auditTable}>
        <thead>
          <tr>
            <th>Scope</th>
            <th className={styles.numeric}>Chats</th>
            <th className={styles.numeric}>Tokens</th>
            <th className={styles.numeric}>Spend</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className={styles.auditEmptyRow}>
                No surface activity yet.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.scope}>
                <td className={styles.auditScopeLabel}>{row.scope}</td>
                <td className={styles.numeric}>{formatNumber(row.chatCount)}</td>
                <td className={styles.numeric}>
                  {formatNumber(row.promptTokens + row.completionTokens)}
                </td>
                <td className={styles.numeric}>{formatCost(row.costUsd)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function DaysPanel({ rows }: { rows: AiUsageByDayRow[] }) {
  // Derive the max cost so each bar reads as a proportion of the busiest
  // day in the window. Cheap, no need for a chart library.
  const maxCost = rows.reduce((acc, r) => Math.max(acc, r.costUsd), 0)

  return (
    <div className={styles.auditPanel}>
      <div className={styles.auditPanelHeader}>
        <h3 className={styles.auditPanelTitle}>Daily spend</h3>
        <span className={styles.auditPanelHint}>{rows.length} days</span>
      </div>
      <div className={styles.auditChartShell}>
        {rows.length === 0 ? (
          <p className={styles.auditEmptyRow}>No daily activity in this range.</p>
        ) : (
          <ul className={styles.auditDayList}>
            {rows.map((row) => {
              const widthPct = maxCost > 0 ? Math.max(2, (row.costUsd / maxCost) * 100) : 0
              const fillStyle = { '--day-bar-pct': `${widthPct}%` } as CSSProperties
              return (
                <li key={row.day} className={styles.auditDayItem}>
                  <span>{row.day}</span>
                  <span className={styles.auditDayBar}>
                    <span className={styles.auditDayBarFill} style={fillStyle} />
                  </span>
                  <span className={styles.auditDayCost}>{formatCost(row.costUsd)}</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
