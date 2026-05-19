/**
 * BlockPicker — floating right-edge picker that lists every registered
 * dashboard widget (first-party + plugin-registered) with an inline
 * search and add-to-grid action.
 *
 * Stays a stateless render component — the activeKeys / onAdd / onClose
 * wiring is owned by the DashboardPage, which holds the layout state.
 */
import { useState } from 'react'
import { PlusIcon } from 'pixel-art-icons/icons/plus'
import { SearchSolidIcon } from 'pixel-art-icons/icons/search-solid'
import { CloseIcon } from 'pixel-art-icons/icons/close'
import type { DashboardWidgetDefinition } from '@core/dashboard'
import { Button } from '@ui/components/Button'
import styles from './BlockPicker.module.css'

export interface BlockPickerProps {
  widgets: readonly DashboardWidgetDefinition[]
  activeKeys: readonly string[]
  onAdd: (widgetId: string, defaultSize: number) => void
  onClose: () => void
}

export function BlockPicker({ widgets, activeKeys, onAdd, onClose }: BlockPickerProps) {
  const [query, setQuery] = useState('')
  const q = query.toLowerCase().trim()
  const filtered = q
    ? widgets.filter((w) =>
        w.name.toLowerCase().includes(q) ||
        w.description.toLowerCase().includes(q),
      )
    : widgets

  return (
    <aside className={styles.picker} role="dialog" aria-label="Add dashboard block">
      <header className={styles.head}>
        <div>
          <h3>Block library</h3>
          <p>Click + to add to your dashboard</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="Close block library"
          onClick={onClose}
        >
          <CloseIcon size={12} aria-hidden="true" />
        </Button>
      </header>
      <div className={styles.searchWrap}>
        <div className={styles.search}>
          <SearchSolidIcon size={12} aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search blocks…"
            aria-label="Search blocks"
          />
        </div>
      </div>
      <div className={styles.list}>
        {filtered.map((widget) => {
          const added = activeKeys.includes(widget.id)
          const Icon = widget.icon
          return (
            <div className={styles.item} key={widget.id}>
              <span className={styles.icon}>
                <Icon size={14} aria-hidden="true" />
              </span>
              <span className={styles.name}>
                {widget.name}
                <small>{widget.description}</small>
              </span>
              {added ? (
                <span className={styles.added}>added</span>
              ) : (
                <Button
                  variant="ghost"
                  size="micro"
                  iconOnly
                  className={styles.add}
                  aria-label={`Add ${widget.name}`}
                  onClick={() => onAdd(widget.id, widget.defaultSize)}
                >
                  <PlusIcon size={10} />
                </Button>
              )}
            </div>
          )
        })}
        {filtered.length === 0 && (
          <p className={styles.empty}>No blocks match “{query}”.</p>
        )}
      </div>
    </aside>
  )
}
