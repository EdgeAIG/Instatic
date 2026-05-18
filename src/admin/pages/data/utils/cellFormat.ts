import type { DataField, DataRow, DataRowCells } from '@core/data/schemas'
import {
  readStringCell,
  readNumberCell,
  readBooleanCell,
  readStringArrayCell,
} from '@core/data/cells'

interface FormatOpts {
  resolveRelation?: (id: string) => DataRow | null
  resolveMedia?: (id: string) => { fileName?: string } | null
}

/**
 * Returns a compact text preview of a cell value suitable for grid display.
 * Returns `''` for empty / null values.
 */
export function formatCellPreview(
  field: DataField,
  cells: DataRowCells,
  opts: FormatOpts = {},
): string {
  switch (field.type) {
    case 'text':
    case 'longText':
    case 'url':
    case 'email': {
      return readStringCell(cells, field.id)
    }

    case 'richText': {
      const raw = readStringCell(cells, field.id)
      if (!raw) return ''
      // Strip common Markdown / HTML tokens for a plain-text preview.
      return raw
        .replace(/<[^>]*>/g, '')
        .replace(/[#*_`~>-]+/g, '')
        .trim()
        .slice(0, 80)
    }

    case 'number': {
      const num = readNumberCell(cells, field.id)
      if (num === null) return ''
      switch (field.format) {
        case 'currency': {
          const code = field.currency ?? 'USD'
          try {
            return new Intl.NumberFormat(undefined, {
              style: 'currency',
              currency: code,
              maximumFractionDigits: field.integer ? 0 : 2,
            }).format(num)
          } catch {
            return `${code} ${num}`
          }
        }
        case 'percent':
          return `${field.integer ? Math.round(num) : num}%`
        default:
          return field.integer ? String(Math.round(num)) : String(num)
      }
    }

    case 'boolean': {
      return readBooleanCell(cells, field.id) ? 'Yes' : 'No'
    }

    case 'date': {
      const raw = readStringCell(cells, field.id)
      if (!raw) return ''
      // Return YYYY-MM-DD portion only.
      return raw.slice(0, 10)
    }

    case 'dateTime': {
      const raw = readStringCell(cells, field.id)
      if (!raw) return ''
      try {
        return new Date(raw).toLocaleString()
      } catch {
        return raw
      }
    }

    case 'select': {
      const id = readStringCell(cells, field.id)
      if (!id) return ''
      return field.options.find((o) => o.id === id)?.label ?? id
    }

    case 'multiSelect': {
      const ids = readStringArrayCell(cells, field.id)
      if (ids.length === 0) return ''
      return ids
        .map((id) => field.options.find((o) => o.id === id)?.label ?? id)
        .join(', ')
    }

    case 'media': {
      const raw = cells[field.id]
      if (field.allowMultiple) {
        const ids = Array.isArray(raw) ? (raw as unknown[]).filter((v): v is string => typeof v === 'string') : []
        return ids.length === 0 ? '' : `${ids.length} file${ids.length === 1 ? '' : 's'}`
      }
      const id = typeof raw === 'string' ? raw : null
      if (!id) return ''
      const resolved = opts.resolveMedia?.(id)
      return resolved?.fileName ?? 'Media'
    }

    case 'relation': {
      const raw = cells[field.id]
      if (field.allowMultiple) {
        const ids = Array.isArray(raw) ? (raw as unknown[]).filter((v): v is string => typeof v === 'string') : []
        return ids.length === 0 ? '' : `${ids.length} related`
      }
      const id = typeof raw === 'string' ? raw : null
      if (!id) return ''
      if (!opts.resolveRelation) return '—'
      const target = opts.resolveRelation(id)
      if (!target) return '—'
      // Return first string cell as the display value — callers can provide
      // richer resolution logic via `resolveRelation`.
      const firstValue = Object.values(target.cells).find((v) => typeof v === 'string' && v !== '')
      return typeof firstValue === 'string' ? firstValue : '—'
    }

    default: {
      const _exhaustive: never = field
      void _exhaustive
      return ''
    }
  }
}
