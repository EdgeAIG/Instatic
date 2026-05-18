import { describe, expect, it } from 'bun:test'
import type { DataTable } from '@core/data/schemas'
import {
  buildPreviewCells,
  dataTablePreviewToLoopItem,
} from '@core/templates/templatePreviewData'

function makeTable(overrides: Partial<DataTable> = {}): DataTable {
  return {
    id: overrides.id ?? 'posts',
    name: overrides.name ?? 'Posts',
    slug: overrides.slug ?? 'posts',
    kind: overrides.kind ?? 'postType',
    singularLabel: overrides.singularLabel ?? 'Post',
    pluralLabel: overrides.pluralLabel ?? 'Posts',
    routeBase: overrides.routeBase ?? '/posts',
    primaryFieldId: overrides.primaryFieldId ?? 'title',
    fields: overrides.fields ?? [
      { type: 'text', id: 'title', label: 'Title', required: true, builtIn: true },
      { type: 'text', id: 'slug', label: 'Slug', required: true, builtIn: true },
      {
        type: 'richText',
        id: 'body',
        label: 'Body',
        format: 'markdown',
        builtIn: true,
      },
      { type: 'media', id: 'featuredMedia', label: 'Featured media', builtIn: true },
      { type: 'text', id: 'seoTitle', label: 'SEO title', builtIn: true },
      {
        type: 'longText',
        id: 'seoDescription',
        label: 'SEO description',
        builtIn: true,
      },
    ],
    createdByUserId: null,
    updatedByUserId: null,
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
  }
}

describe('template preview data', () => {
  it('buildPreviewCells produces a cell for every field in the table', () => {
    const table = makeTable({
      fields: [
        { type: 'text', id: 'title', label: 'Title' },
        { type: 'number', id: 'price', label: 'Price' },
        { type: 'boolean', id: 'active', label: 'Active' },
      ],
    })
    const cells = buildPreviewCells(table)
    expect(Object.keys(cells)).toEqual(['title', 'price', 'active'])
  })

  it('buildPreviewCells uses contextual defaults for post-type built-in fields', () => {
    const table = makeTable()
    const cells = buildPreviewCells(table)

    expect(typeof cells['title']).toBe('string')
    expect(cells['title']).toContain('Example')
    expect(typeof cells['slug']).toBe('string')
    expect(cells['slug']).toBeTruthy()
    expect(typeof cells['body']).toBe('string')
    expect(typeof cells['seoTitle']).toBe('string')
  })

  it('buildPreviewCells produces sensible defaults per field type', () => {
    const table = makeTable({
      fields: [
        { type: 'text', id: 'name', label: 'Name' },
        { type: 'longText', id: 'bio', label: 'Bio' },
        { type: 'richText', id: 'content', label: 'Content', format: 'markdown' },
        { type: 'number', id: 'count', label: 'Count' },
        { type: 'boolean', id: 'active', label: 'Active' },
        { type: 'url', id: 'website', label: 'Website' },
        { type: 'email', id: 'email', label: 'Email' },
        { type: 'media', id: 'photo', label: 'Photo' },
        { type: 'relation', id: 'relatedId', label: 'Related' },
        {
          type: 'select',
          id: 'status',
          label: 'Status',
          options: [
            { id: 'opt_draft', label: 'Draft', value: 'draft' },
            { id: 'opt_published', label: 'Published', value: 'published' },
          ],
        },
        {
          type: 'multiSelect',
          id: 'tags',
          label: 'Tags',
          options: [
            { id: 'opt_a', label: 'Tag A', value: 'a' },
          ],
        },
      ],
    })
    const cells = buildPreviewCells(table)

    expect(typeof cells['name']).toBe('string')
    expect(typeof cells['bio']).toBe('string')
    expect(typeof cells['content']).toBe('string')
    expect(cells['count']).toBe(42)
    expect(cells['active']).toBe(false)
    expect(cells['website']).toBe('https://example.com')
    expect(cells['email']).toBe('hello@example.com')
    expect(cells['photo']).toBeNull()
    expect(cells['relatedId']).toBeNull()
    expect(cells['status']).toBe('draft')
    expect(cells['tags']).toEqual(['a'])
  })

  it('dataTablePreviewToLoopItem generates a LoopItem with the correct shape', () => {
    const table = makeTable()
    const item = dataTablePreviewToLoopItem(table)

    expect(item.id).toBe('__preview__')
    expect(item.fields).toMatchObject({
      id: '__preview__',
      rowId: '__preview__',
      tableId: 'posts',
      tableSlug: 'posts',
      // Media aliases are null for preview
      featuredMedia: null,
      featuredMediaPath: null,
      featuredMediaUrl: null,
      // People are null for preview
      author: null,
      authorName: null,
      publishedBy: null,
      publishedByName: null,
    })
  })

  it('dataTablePreviewToLoopItem derives permalink from routeBase + slug cell', () => {
    const table = makeTable({
      routeBase: '/posts',
      fields: [
        { type: 'text', id: 'title', label: 'Title' },
        { type: 'text', id: 'slug', label: 'Slug', defaultValue: 'my-post' },
      ],
    })
    const item = dataTablePreviewToLoopItem(table)
    expect(item.fields.permalink).toBe('/posts/example-post-title')
  })

  it('dataTablePreviewToLoopItem spreads cell values into fields', () => {
    const table = makeTable({
      fields: [
        { type: 'text', id: 'title', label: 'Title' },
        { type: 'number', id: 'views', label: 'Views' },
      ],
    })
    const item = dataTablePreviewToLoopItem(table)
    expect(typeof item.fields['title']).toBe('string')
    expect(item.fields['views']).toBe(42)
  })
})
