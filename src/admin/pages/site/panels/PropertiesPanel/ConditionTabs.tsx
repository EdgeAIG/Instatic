/**
 * ConditionTabs — the conditional-layer tab strip + add-condition dialog
 * (CSS fidelity plan, Phase 2b).
 *
 * Sits at the top of the ClassComposer when a rule is selected. Shows a "Base"
 * tab plus one tab per conditional layer (custom @media / @container /
 * @supports), and an "+ Add condition" affordance. Selecting a tab tells the
 * style surface which target to edit (base vs a specific layer). The active
 * width-breakpoint (mobile/tablet/desktop) is an orthogonal axis owned by the
 * responsive toolbar — these tabs only switch the *condition* dimension.
 *
 * Adding a condition opens a small dialog: type (Media / Container / Supports)
 * + a validated query. On submit the layer is created and selected.
 */
import { useId, useState, type FormEvent } from 'react'
import type { StyleCondition, ConditionalStyleLayer } from '@core/page-tree'
import { Button } from '@ui/components/Button'
import { Dialog } from '@ui/components/Dialog'
import { Input } from '@ui/components/Input'
import { SegmentedControl } from '@ui/components/SegmentedControl'
import { PlusIcon } from 'pixel-art-icons/icons/plus'
import { CloseIcon } from 'pixel-art-icons/icons/close'
import { cn } from '@ui/cn'
import styles from './ConditionTabs.module.css'

/** The active style target: base styles or a specific conditional layer. */
export type StyleTarget = { kind: 'base' } | { kind: 'condition'; layerId: string }

interface ConditionTabsProps {
  layers: ReadonlyArray<ConditionalStyleLayer>
  active: StyleTarget
  onSelect: (target: StyleTarget) => void
  onAdd: (condition: StyleCondition) => void
  onRemove: (layerId: string) => void
}

/** Short human label for a condition, shown on its tab. */
export function conditionLabel(condition: StyleCondition): string {
  switch (condition.kind) {
    case 'media': return condition.query
    case 'container': return condition.name ? `@${condition.name} ${condition.query}` : condition.query
    case 'supports': return `supports ${condition.query}`
    case 'breakpoint': return condition.breakpointId
  }
}

export function ConditionTabs({ layers, active, onSelect, onAdd, onRemove }: ConditionTabsProps) {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div className={styles.root}>
      <div className={styles.tabs} role="tablist" aria-label="Style condition">
        <button
          type="button"
          role="tab"
          aria-selected={active.kind === 'base'}
          className={cn(styles.tab, active.kind === 'base' && styles.tabActive)}
          onClick={() => onSelect({ kind: 'base' })}
        >
          Base
        </button>
        {layers.map((layer) => {
          const isActive = active.kind === 'condition' && active.layerId === layer.id
          return (
            <span key={layer.id} className={cn(styles.tab, isActive && styles.tabActive)}>
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={`Edit condition ${conditionLabel(layer.condition)}`}
                className={styles.tabLabel}
                onClick={() => onSelect({ kind: 'condition', layerId: layer.id })}
              >
                {conditionLabel(layer.condition)}
              </button>
              <button
                type="button"
                className={styles.tabRemove}
                aria-label={`Remove condition ${conditionLabel(layer.condition)}`}
                onClick={() => onRemove(layer.id)}
              >
                <CloseIcon size={11} aria-hidden="true" />
              </button>
            </span>
          )
        })}
        <Button
          variant="ghost"
          size="micro"
          className={styles.addBtn}
          aria-label="Add condition"
          tooltip="Add a custom @media / @container / @supports condition"
          onClick={() => setDialogOpen(true)}
        >
          <PlusIcon size={12} aria-hidden="true" />
        </Button>
      </div>

      {dialogOpen && (
        <ConditionDialog
          onCancel={() => setDialogOpen(false)}
          onSubmit={(condition) => {
            onAdd(condition)
            setDialogOpen(false)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ConditionDialog
// ---------------------------------------------------------------------------

type ConditionKind = 'media' | 'container' | 'supports'

const KIND_OPTIONS = [
  { value: 'media', label: 'Media', ariaLabel: 'Media query' },
  { value: 'container', label: 'Container', ariaLabel: 'Container query' },
  { value: 'supports', label: 'Supports', ariaLabel: 'Feature query' },
] satisfies ReadonlyArray<{ value: ConditionKind; label: string; ariaLabel: string }>

const PLACEHOLDER: Record<ConditionKind, string> = {
  media: '(max-width: 860px)',
  container: 'min-width: 400px',
  supports: 'display: grid',
}

const CONDITION_FORM_ID = 'add-condition-form'

/**
 * Validate that a query parses inside its @-rule. Uses the browser CSS engine
 * (`insertRule` into a throwaway sheet) so invalid syntax is rejected before
 * it reaches storage. Falls back to permissive when no DOM is available.
 */
function isValidConditionQuery(kind: ConditionKind, query: string): boolean {
  const q = query.trim()
  if (!q) return false
  if (typeof document === 'undefined') return true
  const wrapped =
    kind === 'media' ? `@media ${q} {}`
    : kind === 'container' ? `@container ${ensureParens(q)} {}`
    : `@supports ${ensureParens(q)} {}`
  try {
    const sheet = new CSSStyleSheet()
    sheet.insertRule(wrapped)
    return sheet.cssRules.length > 0
  } catch {
    return false
  }
}

function ensureParens(q: string): string {
  const t = q.trim()
  return t.startsWith('(') ? t : `(${t})`
}

function ConditionDialog({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void
  onSubmit: (condition: StyleCondition) => void
}) {
  const [kind, setKind] = useState<ConditionKind>('media')
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const queryId = useId()
  const nameId = useId()

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!isValidConditionQuery(kind, q)) {
      setError('That query is not valid CSS.')
      return
    }
    const condition: StyleCondition =
      kind === 'media' ? { kind: 'media', query: q }
      : kind === 'container' ? { kind: 'container', query: q, ...(name.trim() ? { name: name.trim() } : {}) }
      : { kind: 'supports', query: q }
    onSubmit(condition)
  }

  return (
    <Dialog
      open
      onClose={onCancel}
      title="Add condition"
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" type="button" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" size="sm" type="submit" form={CONDITION_FORM_ID} disabled={!query.trim()}>
            Add
          </Button>
        </>
      }
    >
      <form id={CONDITION_FORM_ID} className={styles.form} onSubmit={handleSubmit}>
        <SegmentedControl<ConditionKind>
          value={kind}
          options={KIND_OPTIONS}
          onChange={(k) => { setKind(k); setError(null) }}
          size="sm"
          fullWidth
          aria-label="Condition type"
        />
        {kind === 'container' && (
          <div className={styles.field}>
            <label htmlFor={nameId} className={styles.label}>Container name (optional)</label>
            <Input
              id={nameId}
              fieldSize="sm"
              value={name}
              placeholder="sidebar"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        )}
        <div className={styles.field}>
          <label htmlFor={queryId} className={styles.label}>
            {kind === 'media' ? 'Media query' : kind === 'container' ? 'Container query' : 'Feature query'}
          </label>
          <Input
            id={queryId}
            fieldSize="sm"
            value={query}
            placeholder={PLACEHOLDER[kind]}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => { setQuery(e.target.value); setError(null) }}
          />
        </div>
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </form>
    </Dialog>
  )
}
