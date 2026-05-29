/**
 * AssetScopeControl — shared targeting picker for scripts and stylesheets.
 *
 * Both scripts and stylesheets carry a `SiteAssetScope` (all pages / a list of
 * specific pages / a list of specific templates). This control renders the
 * mode dropdown plus, for the two "specific" modes, a multi-select list of
 * toggle chips. It is fully controlled — it never snapshots editor state, so
 * "Specific pages" means exactly the pages the author checked, regardless of
 * which page happens to be open in the editor.
 */

import type { SiteAssetScope } from '@core/site-runtime'
import { Button } from '@ui/components/Button'
import { Select } from '@ui/components/Select'
import styles from './AssetScopeControl.module.css'

export interface ScopePageOption {
  id: string
  label: string
  isTemplate: boolean
}

interface AssetScopeControlProps {
  scope: SiteAssetScope
  pages: ScopePageOption[]
  onChange: (scope: SiteAssetScope) => void
  /** Human label prefix for aria attributes, e.g. "Script" / "Stylesheet". */
  ariaLabelPrefix: string
}

export function AssetScopeControl({ scope, pages, onChange, ariaLabelPrefix }: AssetScopeControlProps) {
  const selectedPageIds = scope.type === 'pages' ? scope.pageIds : []
  const selectedTemplateIds = scope.type === 'templates' ? scope.templatePageIds : []
  const regularPages = pages.filter((page) => !page.isTemplate)
  const templatePages = pages.filter((page) => page.isTemplate)

  function setMode(next: SiteAssetScope['type']) {
    if (next === 'pages') {
      onChange({ type: 'pages', pageIds: selectedPageIds })
    } else if (next === 'templates') {
      onChange({ type: 'templates', templatePageIds: selectedTemplateIds })
    } else {
      onChange({ type: 'all-pages' })
    }
  }

  function toggle(id: string, selected: string[], make: (ids: string[]) => SiteAssetScope) {
    const next = selected.includes(id)
      ? selected.filter((value) => value !== id)
      : [...selected, id]
    onChange(make(next))
  }

  return (
    <div className={styles.field}>
      <span className={styles.label}>Scope</span>
      <Select
        aria-label={`${ariaLabelPrefix} scope`}
        fieldSize="xs"
        value={scope.type}
        onChange={(event) => setMode(event.target.value as SiteAssetScope['type'])}
        options={[
          { value: 'all-pages', label: 'All pages' },
          { value: 'pages', label: 'Specific pages' },
          { value: 'templates', label: 'Specific templates' },
        ]}
      />

      {scope.type === 'pages' && (
        <div className={styles.list} role="group" aria-label={`${ariaLabelPrefix} target pages`}>
          {regularPages.length === 0 ? (
            <span className={styles.empty}>No pages to target</span>
          ) : (
            regularPages.map((page) => (
              <Button
                key={page.id}
                variant="secondary"
                size="xs"
                align="start"
                fullWidth
                pressed={selectedPageIds.includes(page.id)}
                onClick={() => toggle(page.id, selectedPageIds, (ids) => ({ type: 'pages', pageIds: ids }))}
              >
                {page.label}
              </Button>
            ))
          )}
        </div>
      )}

      {scope.type === 'templates' && (
        <div className={styles.list} role="group" aria-label={`${ariaLabelPrefix} target templates`}>
          {templatePages.length === 0 ? (
            <span className={styles.empty}>No templates to target</span>
          ) : (
            templatePages.map((page) => (
              <Button
                key={page.id}
                variant="secondary"
                size="xs"
                align="start"
                fullWidth
                pressed={selectedTemplateIds.includes(page.id)}
                onClick={() => toggle(page.id, selectedTemplateIds, (ids) => ({ type: 'templates', templatePageIds: ids }))}
              >
                {page.label}
              </Button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
