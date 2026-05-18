/**
 * Template preview data — generate synthetic `LoopItem` values from a
 * `DataTable`'s field definitions so the editor canvas can preview a
 * template page without needing a real published row.
 *
 * Used by the editor in two paths:
 *  - Canvas preview: render a template page with representative data so
 *    editors can see layout and styling without publishing a real row.
 *  - Loop preview items: fill `base.loop` nodes on a template page with
 *    representative items from the table's field definitions.
 *
 * Preview values are intentionally generic (Lorem ipsum, placeholder
 * numbers, today's date). Real data is never fetched here — the DB is
 * not available in the browser context.
 */

import type { DataTable, DataField, DataRowCells } from '@core/data/schemas'
import {
  POST_TYPE_FIELD_BODY,
  POST_TYPE_FIELD_FEATURED_MEDIA,
  POST_TYPE_FIELD_SEO_DESCRIPTION,
  POST_TYPE_FIELD_SEO_TITLE,
  POST_TYPE_FIELD_SLUG,
  POST_TYPE_FIELD_TITLE,
} from '@core/data/schemas'
import type { LoopItem } from '@core/loops/types'
import { normalizeRouteBase } from './templateMatching'

// ---------------------------------------------------------------------------
// Preview cell generation
// ---------------------------------------------------------------------------

/**
 * Generate a sensible preview value for a single field.
 *
 * Post-type built-in field ids get contextual defaults (e.g. `title` →
 * `'Example Post Title'`). All other fields get a generic value that is
 * visually meaningful in the canvas (text, numbers, dates).
 */
function previewValueForField(field: DataField): unknown {
  switch (field.type) {
    case 'text':
      if (field.id === POST_TYPE_FIELD_TITLE) return 'Example Post Title'
      if (field.id === POST_TYPE_FIELD_SLUG) return 'example-post-title'
      if (field.id === POST_TYPE_FIELD_SEO_TITLE) return 'Example Post — Site Name'
      return field.defaultValue ?? 'Lorem ipsum'
    case 'longText':
      if (field.id === POST_TYPE_FIELD_SEO_DESCRIPTION)
        return 'A short description of this example post for search engines.'
      return field.defaultValue ?? 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.'
    case 'richText':
      if (field.id === POST_TYPE_FIELD_BODY)
        return '## Example heading\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque at porta est.'
      return field.defaultValue ?? 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.'
    case 'number':
      return field.defaultValue ?? 42
    case 'boolean':
      return field.defaultValue ?? false
    case 'date':
      return new Date().toISOString().split('T')[0]
    case 'dateTime':
      return new Date().toISOString()
    case 'select':
      return field.defaultValue ?? field.options[0]?.value ?? null
    case 'multiSelect':
      return field.options.length > 0 ? [field.options[0]!.value] : []
    case 'url':
      return 'https://example.com'
    case 'email':
      return 'hello@example.com'
    case 'media':
      // No synthetic media URL — modules that render a media field must handle null gracefully.
      return null
    case 'relation':
      return null
    default: {
      // Exhaustive check: TypeScript will error here if a new field type
      // is added to the discriminated union without a case above.
      const _exhaustive: never = field
      void _exhaustive
      return null
    }
  }
}

/**
 * Build a synthetic `DataRowCells` payload from a table's field definitions.
 * Every field in `table.fields` gets a preview value via `previewValueForField`.
 */
export function buildPreviewCells(table: DataTable): DataRowCells {
  const cells: DataRowCells = {}
  for (const field of table.fields) {
    cells[field.id] = previewValueForField(field)
  }
  return cells
}

// ---------------------------------------------------------------------------
// LoopItem projection
// ---------------------------------------------------------------------------

/**
 * Convert a `DataTable`'s field definitions into a synthetic `LoopItem` for
 * canvas preview. The item's `fields` map mirrors the shape produced at
 * runtime by `publishedDataRowToLoopItem` so template bindings resolve the
 * same way during preview as they do when rendering a real published row.
 */
export function dataTablePreviewToLoopItem(table: DataTable): LoopItem {
  const cells = buildPreviewCells(table)
  const tableRouteBase = normalizeRouteBase(table.routeBase || `/${table.slug}`)
  const slugValue = typeof cells[POST_TYPE_FIELD_SLUG] === 'string' && cells[POST_TYPE_FIELD_SLUG]
    ? cells[POST_TYPE_FIELD_SLUG] as string
    : 'preview-row'
  const permalink = `${tableRouteBase === '/' ? '' : tableRouteBase}/${slugValue}`

  // Determine featured media field: post-type tables have a known field id;
  // for generic data tables we look for the first `media` field.
  const hasFeaturedMediaField = table.fields.some((f) => f.id === POST_TYPE_FIELD_FEATURED_MEDIA)
  const featuredMediaField = hasFeaturedMediaField
    ? POST_TYPE_FIELD_FEATURED_MEDIA
    : table.fields.find((f) => f.type === 'media')?.id ?? null

  return {
    id: '__preview__',
    fields: {
      // Cells — all user-defined fields accessible by fieldId
      ...cells,
      // System identity (overlay so these can never be shadowed by cells)
      id: '__preview__',
      rowId: '__preview__',
      tableId: table.id,
      tableSlug: table.slug,
      // No real people in preview
      author: null,
      authorName: null,
      authorRoleSlug: null,
      authorRoleName: null,
      publishedBy: null,
      publishedByName: null,
      publishedByRoleSlug: null,
      publishedByRoleName: null,
      // Media aliases — no resolved path in preview
      featuredMediaId: featuredMediaField ? cells[featuredMediaField] ?? null : null,
      featuredMedia: null,
      featuredMediaPath: null,
      featuredMediaUrl: null,
      firstImage: null,
      firstImagePath: null,
      firstImageUrl: null,
      // Dates / routing
      slug: slugValue,
      publishedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      permalink,
    },
  }
}
