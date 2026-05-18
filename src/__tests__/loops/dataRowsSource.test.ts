import { describe, expect, it } from 'bun:test'
import { DataRowsSource } from '@core/loops/sources/dataRows'

describe('data.rows loop source', () => {
  it('offers author display fields without exposing user ids as binding fields', () => {
    expect(DataRowsSource.fields).toContainEqual({
      id: 'authorName',
      label: 'Author name',
    })
    expect(DataRowsSource.fields).toContainEqual({
      id: 'authorRoleName',
      label: 'Author role',
    })
    expect(DataRowsSource.fields.map((field) => field.id)).not.toContain('authorUserId')
    expect(DataRowsSource.fields.map((field) => field.id)).not.toContain('publishedByUserId')
  })

  it('exposes a tableId filter for scoping to a specific data table', () => {
    expect(DataRowsSource.filterSchema).toHaveProperty('tableId')
    expect(DataRowsSource.filterSchema.tableId.type).toBe('select')
  })

  it('offers all expected order-by options', () => {
    const ids = DataRowsSource.orderByOptions.map((o) => o.id)
    expect(ids).toContain('publishedAt')
    expect(ids).toContain('createdAt')
    expect(ids).toContain('updatedAt')
    expect(ids).toContain('slug')
  })
})
