/**
 * ConditionsSection — manage the site's reusable custom conditions
 * (@media / @container / @supports) used across classes.
 *
 * Conditions are *created* from the canvas editing-context switcher's
 * "Add condition…" affordance; this section renames and removes them
 * site-wide. Removing a condition clears its overrides from every class that
 * used it (mirrors how breakpoint removal works). Changes reflect immediately
 * because the canvas + style panel read `site.conditions` from the store.
 */
import { useState, useRef, useEffect } from 'react'
import { useEditorStore } from '@site/store/store'
import { conditionLabel, type ConditionDef } from '@core/page-tree'
import { Button } from '@ui/components/Button'
import { Input } from '@ui/components/Input'
import { SkeletonBlock } from '@ui/components/Skeleton'
import s from '../SettingsModal.module.css'

/** How many classes carry an override under this condition. */
function usageCount(styleRules: Record<string, { contextStyles?: Record<string, unknown> }>, id: string): number {
  let n = 0
  for (const rule of Object.values(styleRules)) {
    if (rule.contextStyles && id in rule.contextStyles) n += 1
  }
  return n
}

function kindLabel(def: ConditionDef): string {
  switch (def.condition.kind) {
    case 'media': return '@media'
    case 'container': return '@container'
    case 'supports': return '@supports'
  }
}

export function ConditionsSection() {
  const site = useEditorStore((state) => state.site)
  const renameCondition = useEditorStore((state) => state.renameCondition)
  const removeCondition = useEditorStore((state) => state.removeCondition)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const confirmBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (confirmRemoveId) confirmBtnRef.current?.focus()
  }, [confirmRemoveId])

  if (!site) {
    return <SkeletonBlock minHeight={200} ariaLabel="Loading site settings" />
  }

  const conditions = site.conditions ?? []

  const handleStartEdit = (def: ConditionDef) => {
    setEditingId(def.id)
    setEditLabel(def.label)
  }

  const handleSaveEdit = () => {
    if (editingId && editLabel.trim()) renameCondition(editingId, editLabel.trim())
    setEditingId(null)
  }

  const handleRemove = (id: string) => {
    removeCondition(id)
    setConfirmRemoveId(null)
  }

  return (
    <div>
      <h3 className={s.sectionHeading}>Conditions</h3>
      <p className={s.sectionDescription}>
        Reusable <code>@media</code> / <code>@container</code> / <code>@supports</code> conditions.
        Add new ones from the editing-context switcher on the canvas; any class can then carry
        overrides under them. Removing a condition clears it from every class that used it.
      </p>

      {conditions.length === 0 ? (
        <p className={s.sectionDescription}>
          No custom conditions yet. Use “Add condition…” in the canvas context switcher to create one.
        </p>
      ) : (
        <ul role="list" className={s.list}>
          {conditions.map((def) => {
            const uses = usageCount(site.styleRules, def.id)
            return (
              <li key={def.id}>
                {editingId === def.id ? (
                  <div className={s.bpEditForm}>
                    <Input
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      placeholder="Label (e.g. Dark)"
                      autoFocus
                      aria-label="Condition label"
                      className={s.fieldFlex}
                    />
                    <div className={s.bpEditActions}>
                      <Button variant="primary" size="md" onClick={handleSaveEdit}>Save</Button>
                      <Button variant="secondary" size="md" onClick={() => setEditingId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className={s.listItem}>
                    <div className={s.row}>
                      <div className={s.listItemContent}>
                        <div className={s.listItemTitle}>
                          {def.label}
                          <span className={s.activeBadge}>{kindLabel(def)}</span>
                        </div>
                        <div className={s.listItemSubtitle}>
                          {conditionLabel(def.condition)} · used by {uses} {uses === 1 ? 'class' : 'classes'}
                        </div>
                      </div>
                    </div>

                    <div
                      className={s.listItemActions}
                      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setConfirmRemoveId(null) } }}
                    >
                      <Button
                        variant="secondary"
                        size="md"
                        onClick={() => handleStartEdit(def)}
                        aria-label={`Rename ${def.label} condition`}
                      >
                        Rename
                      </Button>
                      {confirmRemoveId === def.id ? (
                        <>
                          <Button
                            ref={confirmBtnRef}
                            variant="destructive"
                            size="sm"
                            onClick={() => handleRemove(def.id)}
                            aria-label={`Confirm remove ${def.label} condition`}
                          >
                            Delete
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setConfirmRemoveId(null)}
                            aria-label="Cancel remove"
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="destructive"
                          size="md"
                          onClick={() => setConfirmRemoveId(def.id)}
                          aria-label={`Remove ${def.label} condition`}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
