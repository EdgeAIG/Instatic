/**
 * dynamicBindingPicker.test.tsx
 *
 * Tests for the two-pane BindingPickerDialog UX inside DynamicBindingControl.
 * Uses globalThis.fetch mocking (same pattern as templatePreviewBindings.test.tsx)
 * to intercept the DataMeta API call.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DynamicBindingControl } from '@site/property-controls/DynamicBindingControl'
import { clearDataMetaCache } from '@site/property-controls/DynamicBindingControl.cache'
import { useEditorStore } from '@site/store/store'
import { makeNode, makePage, makeSite } from '../fixtures'
import type { DynamicPropBinding } from '@core/page-tree'

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const postsTable = {
  id: 'posts-id',
  slug: 'posts',
  name: 'Posts',
  kind: 'postType',
  singularLabel: 'Post',
  pluralLabel: 'Posts',
  primaryFieldId: 'title',
  routable: true,
  versioned: true,
  fields: [
    { id: 'title', label: 'Title', type: 'text' },
    { id: 'slug', label: 'Slug', type: 'text' },
    { id: 'body', label: 'Body', type: 'richText' },
    { id: 'featuredMedia', label: 'Featured media', type: 'media', mediaKind: 'image' },
    { id: 'seoTitle', label: 'SEO title', type: 'text' },
  ],
}

const productsTable = {
  id: 'products-id',
  slug: 'products',
  name: 'Products',
  kind: 'data',
  singularLabel: 'Product',
  pluralLabel: 'Products',
  primaryFieldId: 'name',
  routable: false,
  versioned: false,
  fields: [
    { id: 'name', label: 'Name', type: 'text' },
    { id: 'price', label: 'Price', type: 'number' },
    { id: 'thumbnail', label: 'Thumbnail', type: 'media', mediaKind: 'image' },
  ],
}

const mockDataMeta = {
  meta: { tables: [postsTable, productsTable] },
}

// ---------------------------------------------------------------------------
// Test setup / teardown
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch

beforeEach(() => {
  clearDataMetaCache()
  localStorage.clear()
  useEditorStore.setState({
    site: null,
    activePageId: null,
    activeDocument: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    activeBreakpointId: 'desktop',
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes('/data/_meta')) {
      return new Response(JSON.stringify(mockDataMeta), { status: 200 })
    }
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
  }) as typeof fetch
})

afterEach(() => {
  cleanup()
  clearDataMetaCache()
  globalThis.fetch = originalFetch
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderBinding(
  props: {
    control?: DynamicBindingControl extends { props: infer P } ? Partial<P> : never
    onSet?: (b: DynamicPropBinding) => void
    onClear?: () => void
    binding?: DynamicPropBinding
  } = {},
) {
  const onSet = props.onSet ?? (() => {})
  const onClear = props.onClear ?? (() => {})
  return render(
    <DynamicBindingControl
      propKey="text"
      label="Text"
      control={{ type: 'text', label: 'Text' }}
      onSet={onSet}
      onClear={onClear}
      binding={props.binding}
    >
      <input aria-label="Text" />
    </DynamicBindingControl>,
  )
}

function loadTemplatePageInStore(tableSlug = 'posts') {
  const root = makeNode({ id: 'root', moduleId: 'base.body', children: ['text-1'] })
  const text = makeNode({ id: 'text-1', moduleId: 'base.text', props: { text: 'Hello', tag: 'p' } })
  const page = makePage({
    id: 'page-1',
    slug: 'posts-template',
    rootNodeId: 'root',
    nodes: { root, 'text-1': text },
    template: {
      enabled: true,
      context: 'entry',
      tableSlug,
      priority: 100,
      conditions: [],
    },
  })
  useEditorStore.setState({
    site: makeSite({ pages: [page] }),
    activePageId: page.id,
  } as Parameters<typeof useEditorStore.setState>[0])
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DynamicBindingControl picker', () => {
  it('renders the binding affordance button in unbound state', () => {
    renderBinding()
    expect(screen.getByRole('button', { name: /bind text/i })).toBeDefined()
  })

  it('opens the dialog when the affordance button is clicked', async () => {
    renderBinding()
    fireEvent.click(screen.getByRole('button', { name: /bind text/i }))
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeDefined()
    })
  })

  it('shows Post types and Data tables groups in the left pane', async () => {
    renderBinding()
    fireEvent.click(screen.getByRole('button', { name: /bind text/i }))
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeDefined()
    })
    expect(screen.getByText('Post types')).toBeDefined()
    expect(screen.getByText('Data tables')).toBeDefined()
    expect(screen.getByRole('button', { name: /posts/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /products/i })).toBeDefined()
  })

  it('shows fields in the right pane after selecting a table', async () => {
    renderBinding()
    fireEvent.click(screen.getByRole('button', { name: /bind text/i }))
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeDefined()
    })
    fireEvent.click(screen.getByRole('button', { name: /^Posts$/i }))
    await waitFor(() => {
      expect(screen.getByText('Title')).toBeDefined()
    })
    expect(screen.getByText('Slug')).toBeDefined()
    expect(screen.getByText('SEO title')).toBeDefined()
  })

  it('filters the field list using the field search bar', async () => {
    renderBinding()
    fireEvent.click(screen.getByRole('button', { name: /bind text/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: /^Posts$/i }))
    await waitFor(() => expect(screen.getByText('Title')).toBeDefined())

    const searchBar = screen.getByRole('searchbox', { name: /search fields/i })
    fireEvent.change(searchBar, { target: { value: 'seo' } })
    await waitFor(() => {
      expect(screen.queryByText('Title')).toBeNull()
      expect(screen.getByText('SEO title')).toBeDefined()
    })
  })

  it('disables media fields when control type is text', async () => {
    renderBinding()
    fireEvent.click(screen.getByRole('button', { name: /bind text/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: /^Posts$/i }))
    await waitFor(() => expect(screen.getByText('Featured media')).toBeDefined())

    // The "Featured media" button should be aria-disabled for a text control
    // (Button uses aria-disabled when disabled+tooltip combo is present)
    const mediaBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.includes('Featured media'),
    )
    expect(mediaBtn).toBeDefined()
    expect(mediaBtn?.getAttribute('aria-disabled')).toBe('true')
  })

  it('calls onSet with correct binding when a field is selected and confirmed', async () => {
    let result: DynamicPropBinding | undefined
    renderBinding({ onSet: (b) => { result = b } })
    fireEvent.click(screen.getByRole('button', { name: /bind text/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: /^Posts$/i }))
    await waitFor(() => expect(screen.getByText('Title')).toBeDefined())

    // Select the field
    const titleBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.includes('Title') && !b.textContent?.includes('SEO'),
    )
    fireEvent.click(titleBtn!)

    // Confirm
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

    expect(result).toMatchObject({ source: 'currentEntry', field: 'title' })
  })

  it('auto-scopes and hides the left pane when the page has template.tableSlug', async () => {
    loadTemplatePageInStore('posts')
    renderBinding()
    fireEvent.click(screen.getByRole('button', { name: /bind text/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined())
    await waitFor(() => expect(screen.getByText('Title')).toBeDefined())

    // Auto-scope chip should appear
    expect(screen.getByText(/Current row — Posts/i)).toBeDefined()
    // Left pane table buttons should NOT be visible
    expect(screen.queryByText('Post types')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Posts$/i })).toBeNull()
  })

  it('shows loop scope in left pane when availableFields are provided', async () => {
    render(
      <DynamicBindingControl
        propKey="text"
        label="Text"
        control={{ type: 'text', label: 'Text' }}
        onSet={() => {}}
        onClear={() => {}}
        availableFields={[
          { id: 'title', label: 'Post title' },
          { id: 'slug', label: 'Post slug' },
        ]}
        sourceLabel="Posts loop"
      >
        <input aria-label="Text" />
      </DynamicBindingControl>,
    )
    fireEvent.click(screen.getByRole('button', { name: /bind text/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined())

    // Loop scope entry should appear in left pane
    expect(screen.getByRole('button', { name: /Posts loop/i })).toBeDefined()
  })

  it('closes the dialog on Cancel without calling onSet', async () => {
    let called = false
    renderBinding({ onSet: () => { called = true } })
    fireEvent.click(screen.getByRole('button', { name: /bind text/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(called).toBe(false)
  })
})
