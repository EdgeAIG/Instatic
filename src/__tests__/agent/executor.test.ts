/**
 * Browser-side executor tests.
 *
 * The executor receives `toolRequest` stream events from the server and
 * applies the corresponding mutation against the live editor store.
 * Each tool call is its own atomic mutation — no batch semantics, no
 * cross-call refs (Claude uses real returned IDs in subsequent tool calls).
 *
 * Constraint #272 — every input is validated with TypeBox before dispatch.
 * Constraint #299 — richtext props are sanitized via DOMPurify before storage.
 */

import { describe, it, expect } from 'bun:test'
import { useEditorStore } from '@site/store/store'
import { executeAgentTool } from '@site/agent/executor'
import { classNamesForClassIds } from '@core/page-tree/classNames'
import '@modules/base'

// ---------------------------------------------------------------------------
// Store reset helper
// ---------------------------------------------------------------------------

function freshStore() {
  useEditorStore.setState({
    site: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    activeClassId: null,
    isAgentOpen: false,
    isAgentStreaming: false,
    agentMessages: [],
    agentError: null,
    hasUnsavedChanges: false,
  })
  const s = useEditorStore.getState()
  const site = s.createSite('Test')
  const rootId = site.pages[0].rootNodeId
  return { rootId, store: useEditorStore.getState() }
}

// ---------------------------------------------------------------------------
// insertHtml
// ---------------------------------------------------------------------------

describe('executeAgentTool — insertHtml', () => {
  it('inserts a section with heading and paragraph as a real subtree', async () => {
    const { rootId } = freshStore()
    const result = await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '<section class="hero"><h1>Hi</h1><p>Yo</p></section>',
    })
    expect(result.success).toBe(true)
    expect(result.nodeIds).toBeTruthy()
    expect(result.nodeIds!.length).toBeGreaterThan(0)

    const page = useEditorStore.getState().site!.pages[0]
    const nodes = Object.values(page.nodes)

    // The section element maps to base.container
    expect(nodes.some((n) => n.moduleId === 'base.container')).toBe(true)
    // The h1 and p elements map to base.text
    expect(nodes.some((n) => n.moduleId === 'base.text')).toBe(true)

    // The inserted root (section) is wired as a child of the page root
    const root = page.nodes[rootId]
    expect(root.children).toContain(result.nodeIds![0])

    // The section node has two children (h1 + p)
    const sectionNode = page.nodes[result.nodeIds![0]]
    expect(sectionNode.children).toHaveLength(2)
  })

  it('class declared in the classes array is created in the store with its styles', async () => {
    const { rootId } = freshStore()
    const result = await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '<section class="hero-section"><h1>Title</h1></section>',
      classes: [
        {
          name: 'hero-section',
          styles: { padding: '80px', backgroundColor: '#111827' },
        },
      ],
    })
    expect(result.success).toBe(true)

    // The class must be created in the store
    const classes = Object.values(useEditorStore.getState().site!.styleRules)
    const heroClass = classes.find((c) => c.name === 'hero-section')
    expect(heroClass).toBeDefined()
    expect(heroClass!.styles.padding).toBe('80px')
    expect(heroClass!.styles.backgroundColor).toBe('#111827')

    // ...AND the imported node must reference the class by its registry id, so
    // the declared styles actually resolve at render time (regression guard:
    // the importer stamps class *names* onto classIds; insertImportedNodes
    // links them to ids — without that, styles silently never apply).
    const site = useEditorStore.getState().site!
    const sectionNode = site.pages[0].nodes[result.nodeIds![0]]
    expect(sectionNode.classIds).toContain(heroClass!.id)
    expect(sectionNode.classIds).not.toContain('hero-section')
    expect(classNamesForClassIds(site.styleRules, sectionNode.classIds)).toContain('hero-section')
  })

  it('bare class= attribute (no classes declaration) auto-creates a registry class and links it', async () => {
    const { rootId } = freshStore()
    const result = await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '<div class="card"><p class="card-body">Hi</p></div>',
    })
    expect(result.success).toBe(true)

    const site = useEditorStore.getState().site!
    const cardClass = Object.values(site.styleRules).find((c) => c.name === 'card')
    const bodyClass = Object.values(site.styleRules).find((c) => c.name === 'card-body')
    expect(cardClass).toBeDefined()
    expect(bodyClass).toBeDefined()

    const cardNode = site.pages[0].nodes[result.nodeIds![0]]
    expect(cardNode.classIds).toEqual([cardClass!.id])
    // The class attribute resolves back to the original name for render.
    expect(classNamesForClassIds(site.styleRules, cardNode.classIds)).toEqual(['card'])
  })

  it('reuses an existing same-named class instead of duplicating it', async () => {
    const { rootId } = freshStore()
    const existing = useEditorStore.getState().createClass('hero', { color: '#fff' })

    const result = await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '<section class="hero"></section><div class="hero"></div>',
    })
    expect(result.success).toBe(true)

    const site = useEditorStore.getState().site!
    const heroClasses = Object.values(site.styleRules).filter((c) => c.name === 'hero')
    expect(heroClasses).toHaveLength(1)
    for (const id of result.nodeIds!) {
      expect(site.pages[0].nodes[id].classIds).toEqual([existing.id])
    }
  })

  it('class with breakpoint styles is created correctly', async () => {
    const { rootId } = freshStore()
    const result = await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '<h1 class="hero-title">Hello</h1>',
      classes: [
        {
          name: 'hero-title',
          styles: { fontSize: '56px' },
          breakpointStyles: {
            mobile: { fontSize: '32px' },
          },
        },
      ],
    })
    expect(result.success).toBe(true)
    const cls = Object.values(useEditorStore.getState().site!.styleRules).find(
      (c) => c.name === 'hero-title',
    )
    expect(cls).toBeDefined()
    expect(cls!.styles.fontSize).toBe('56px')
    expect(cls!.contextStyles.mobile.fontSize).toBe('32px')
  })

  it('returns failure for missing html (schema validation)', async () => {
    const { rootId } = freshStore()
    const result = await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '',
    })
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('returns failure when parentId does not exist', async () => {
    freshStore()
    const result = await executeAgentTool('insertHtml', {
      parentId: 'nonexistent-node',
      html: '<p>Test</p>',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('appends at a given index position', async () => {
    const { rootId } = freshStore()
    // Insert two nodes first
    await executeAgentTool('insertHtml', { parentId: rootId, html: '<p>First</p>' })
    await executeAgentTool('insertHtml', { parentId: rootId, html: '<p>Second</p>' })

    // Now insert a third at index 0 (before both)
    const result = await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '<h1>Before</h1>',
      index: 0,
    })
    expect(result.success).toBe(true)

    const page = useEditorStore.getState().site!.pages[0]
    const root = page.nodes[rootId]
    // The newly inserted node is at position 0
    expect(root.children[0]).toBe(result.nodeIds![0])
    expect(root.children).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// getNodeHtml
// ---------------------------------------------------------------------------

describe('executeAgentTool — getNodeHtml', () => {
  it('returns the rendered HTML for an existing node subtree', async () => {
    const { rootId } = freshStore()

    // Insert a heading so there is something to read back
    const insertResult = await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '<h1>Hello World</h1>',
    })
    expect(insertResult.success).toBe(true)
    const nodeId = insertResult.nodeIds![0]

    const result = await executeAgentTool('getNodeHtml', { nodeId })
    expect(result.success).toBe(true)
    expect(result.html).toBeTruthy()
    // The rendered output must contain the heading text
    expect(result.html).toContain('Hello World')
    // And the h1 tag
    expect(result.html).toMatch(/<h1[^>]*>/)
  })

  it('returns html for a container node with children', async () => {
    const { rootId } = freshStore()

    const insertResult = await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '<section><h2>Title</h2><p>Body</p></section>',
    })
    expect(insertResult.success).toBe(true)
    const sectionId = insertResult.nodeIds![0]

    const result = await executeAgentTool('getNodeHtml', { nodeId: sectionId })
    expect(result.success).toBe(true)
    expect(result.html).toBeTruthy()
    // The section renders its children too
    expect(result.html).toContain('Title')
    expect(result.html).toContain('Body')
  })

  it('returns failure when nodeId does not exist', async () => {
    freshStore()
    const result = await executeAgentTool('getNodeHtml', { nodeId: 'nonexistent-node' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('returns failure for empty nodeId (schema validation)', async () => {
    freshStore()
    const result = await executeAgentTool('getNodeHtml', { nodeId: '' })
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// replaceNodeHtml
// ---------------------------------------------------------------------------

describe('executeAgentTool — replaceNodeHtml', () => {
  it('preserves the target container node and rebuilds its children from new HTML', async () => {
    const { rootId } = freshStore()

    // Insert a container with one child
    const containerResult = await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '<div></div>',
    })
    const containerId = containerResult.nodeIds![0]
    await executeAgentTool('insertHtml', { parentId: containerId, html: '<p>Old content</p>' })

    const pageBefore = useEditorStore.getState().site!.pages[0]
    expect(pageBefore.nodes[containerId].children).toHaveLength(1)

    // Replace children with two new elements
    const result = await executeAgentTool('replaceNodeHtml', {
      nodeId: containerId,
      html: '<h1>New Heading</h1><p>New paragraph</p>',
    })

    expect(result.success).toBe(true)
    expect(result.nodeIds).toBeTruthy()

    const pageAfter = useEditorStore.getState().site!.pages[0]
    // The container node is preserved as the parent
    expect(pageAfter.nodes[containerId]).toBeDefined()
    expect(pageAfter.nodes[containerId].moduleId).toBe('base.container')

    // Children are rebuilt from the new HTML (h1 + p = 2 nodes)
    expect(pageAfter.nodes[containerId].children).toHaveLength(2)

    // Both new children are base.text (h1 and p both map to base.text)
    const childNodes = pageAfter.nodes[containerId].children.map(
      (id) => pageAfter.nodes[id],
    )
    expect(childNodes.every((n) => n.moduleId === 'base.text')).toBe(true)
  })

  it('returns failure when nodeId does not exist', async () => {
    freshStore()
    const result = await executeAgentTool('replaceNodeHtml', {
      nodeId: 'nonexistent',
      html: '<p>Test</p>',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('returns failure for empty html (schema validation)', async () => {
    const { rootId } = freshStore()
    const containerResult = await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '<div></div>',
    })
    const result = await executeAgentTool('replaceNodeHtml', {
      nodeId: containerResult.nodeIds![0],
      html: '',
    })
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// deleteNode
// ---------------------------------------------------------------------------

describe('executeAgentTool — deleteNode', () => {
  it('deletes a node successfully', async () => {
    const { rootId } = freshStore()
    const { nodeIds } = await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '<p></p>',
    })
    const nodeId = nodeIds![0]

    const deleteResult = await executeAgentTool('deleteNode', { nodeId })
    expect(deleteResult.success).toBe(true)

    const page = useEditorStore.getState().site!.pages[0]
    expect(page.nodes[nodeId]).toBeUndefined()
  })

  it('fails with empty nodeId', async () => {
    freshStore()
    const result = await executeAgentTool('deleteNode', { nodeId: '' })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// updateNodeProps
// ---------------------------------------------------------------------------

describe('executeAgentTool — updateNodeProps', () => {
  it('patches node props', async () => {
    const { rootId } = freshStore()
    const insertResult = await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '<p>Old</p>',
    })
    const nodeId = insertResult.nodeIds![0]
    await executeAgentTool('updateNodeProps', { nodeId, patch: { text: 'New' } })
    const page = useEditorStore.getState().site!.pages[0]
    expect(page.nodes[nodeId].props.text).toBe('New')
  })

  it('rejects updateNodeProps with breakpointId for content props', async () => {
    // Module props are content (single value across all breakpoints) because
    // the published page is one HTML document. Per-breakpoint visual
    // variation lives in class breakpoint styles, not in module props. The
    // executor must reject the call with a clear error so the agent doesn't
    // silently produce data that the canvas/publisher will discard at read
    // time anyway.
    const { rootId } = freshStore()
    const insertResult = await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '<p>Desktop copy</p>',
    })
    const nodeId = insertResult.nodeIds![0]

    const result = await executeAgentTool('updateNodeProps', {
      nodeId,
      breakpointId: 'mobile',
      patch: { text: 'Mobile copy' },
    })

    expect(result.success).toBe(false)
    expect(result.error ?? '').toContain('breakpointOverridable')
    const page = useEditorStore.getState().site!.pages[0]
    expect(page.nodes[nodeId].props.text).toBe('Desktop copy')
    expect(page.nodes[nodeId].breakpointOverrides.mobile).toBeUndefined()
  })

  it('rejects updateNodeProps targeting an unknown breakpoint', async () => {
    const { rootId } = freshStore()
    const insertResult = await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '<p></p>',
    })
    const nodeId = insertResult.nodeIds![0]

    const result = await executeAgentTool('updateNodeProps', {
      nodeId,
      breakpointId: 'watch',
      patch: { text: 'Smaller' },
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Breakpoint not found')
  })
})

// ---------------------------------------------------------------------------
// moveNode
// ---------------------------------------------------------------------------

describe('executeAgentTool — moveNode', () => {
  it('moves a node to a new parent', async () => {
    const { rootId } = freshStore()
    const c1 = (await executeAgentTool('insertHtml', { parentId: rootId, html: '<div></div>' })).nodeIds![0]
    const c2 = (await executeAgentTool('insertHtml', { parentId: rootId, html: '<div></div>' })).nodeIds![0]
    const child = (await executeAgentTool('insertHtml', { parentId: c1, html: '<p></p>' })).nodeIds![0]
    const result = await executeAgentTool('moveNode', { nodeId: child, newParentId: c2, newIndex: 0 })
    expect(result.success).toBe(true)
    const page = useEditorStore.getState().site!.pages[0]
    expect(page.nodes[c2].children).toContain(child)
    expect(page.nodes[c1].children).not.toContain(child)
  })
})

// ---------------------------------------------------------------------------
// renameNode
// ---------------------------------------------------------------------------

describe('executeAgentTool — renameNode', () => {
  it('sets the node label', async () => {
    const { rootId } = freshStore()
    const { nodeIds } = await executeAgentTool('insertHtml', { parentId: rootId, html: '<p></p>' })
    const nodeId = nodeIds![0]
    await executeAgentTool('renameNode', { nodeId, label: 'Hero Heading' })
    const page = useEditorStore.getState().site!.pages[0]
    expect(page.nodes[nodeId].label).toBe('Hero Heading')
  })
})

// ---------------------------------------------------------------------------
// createClass
// ---------------------------------------------------------------------------

describe('executeAgentTool — createClass', () => {
  it('creates a class and returns its ID in nodeId field', async () => {
    freshStore()
    const result = await executeAgentTool('createClass', {
      name: 'btn-primary', styles: { fontSize: '14px' },
    })
    expect(result.success).toBe(true)
    expect(result.nodeId).toBeTruthy()
    const classes = useEditorStore.getState().site!.styleRules
    expect(Object.values(classes).some((c) => c.name === 'btn-primary')).toBe(true)
  })

  it('fails when class name is empty', async () => {
    freshStore()
    const result = await executeAgentTool('createClass', { name: '' })
    expect(result.success).toBe(false)
  })

  it('creates a class with breakpoint-specific styles', async () => {
    freshStore()
    const result = await executeAgentTool('createClass', {
      name: 'responsive-heading',
      styles: { fontSize: '64px', lineHeight: '1' },
      breakpointStyles: {
        mobile: { fontSize: '40px', lineHeight: '1.05' },
      },
    })

    expect(result.success).toBe(true)
    const cls = useEditorStore.getState().site!.styleRules[result.nodeId!]
    expect(cls.styles.fontSize).toBe('64px')
    expect(cls.contextStyles.mobile.fontSize).toBe('40px')
    expect(cls.contextStyles.mobile.lineHeight).toBe('1.05')
  })
})

// ---------------------------------------------------------------------------
// assignClass / removeClass
// ---------------------------------------------------------------------------

describe('executeAgentTool — assignClass / removeClass', () => {
  it('assigns a class to a node', async () => {
    const { rootId } = freshStore()
    const { nodeIds } = await executeAgentTool('insertHtml', { parentId: rootId, html: '<p></p>' })
    const nodeId = nodeIds![0]
    const classResult = await executeAgentTool('createClass', { name: 'highlighted' })
    const classId = classResult.nodeId!

    await executeAgentTool('assignClass', { nodeId, classId })
    const page = useEditorStore.getState().site!.pages[0]
    expect(page.nodes[nodeId].classIds).toContain(classId)
  })

  it('removes a class from a node', async () => {
    const { rootId } = freshStore()
    const { nodeIds } = await executeAgentTool('insertHtml', { parentId: rootId, html: '<p></p>' })
    const nodeId = nodeIds![0]
    const classResult = await executeAgentTool('createClass', { name: 'highlighted2' })
    const classId = classResult.nodeId!

    await executeAgentTool('assignClass', { nodeId, classId })
    await executeAgentTool('removeClass', { nodeId, classId })
    const page = useEditorStore.getState().site!.pages[0]
    expect(page.nodes[nodeId].classIds ?? []).not.toContain(classId)
  })
})

// ---------------------------------------------------------------------------
// Class identifiers — name vs id resolution
// ---------------------------------------------------------------------------

describe('executeAgentTool — class identifier resolution', () => {
  it('resolves classId by name in assignClass', async () => {
    const { rootId } = freshStore()
    const insertResult = await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '<button>Click</button>',
    })
    const nodeId = insertResult.nodeIds![0]
    await executeAgentTool('createClass', { name: 'btn-hero', styles: { color: '#fff' } })

    const result = await executeAgentTool('assignClass', { nodeId, classId: 'btn-hero' })
    expect(result.success).toBe(true)

    const page = useEditorStore.getState().site!.pages[0]
    const classes = useEditorStore.getState().site!.styleRules
    const heroClass = Object.values(classes).find((c) => c.name === 'btn-hero')!
    expect(page.nodes[nodeId].classIds).toContain(heroClass.id)
  })

  it('returns failure when classId / name does not match any class', async () => {
    const { rootId } = freshStore()
    const insertResult = await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '<button>Click</button>',
    })
    const nodeId = insertResult.nodeIds![0]
    const result = await executeAgentTool('assignClass', { nodeId, classId: 'nonexistent-class' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('nonexistent-class')
  })

  it('removeClass also resolves by name', async () => {
    const { rootId } = freshStore()
    const insertResult = await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '<button>Click</button>',
    })
    const nodeId = insertResult.nodeIds![0]
    await executeAgentTool('createClass', { name: 'removable' })
    await executeAgentTool('assignClass', { nodeId, classId: 'removable' })

    const result = await executeAgentTool('removeClass', { nodeId, classId: 'removable' })
    expect(result.success).toBe(true)

    const page = useEditorStore.getState().site!.pages[0]
    const classes = useEditorStore.getState().site!.styleRules
    const cls = Object.values(classes).find((c) => c.name === 'removable')!
    expect(page.nodes[nodeId].classIds ?? []).not.toContain(cls.id)
  })

  it('updateClassStyles resolves by name', async () => {
    freshStore()
    await executeAgentTool('createClass', { name: 'card', styles: { padding: '8px' } })

    const result = await executeAgentTool('updateClassStyles', {
      classId: 'card',
      patch: { padding: '16px', borderRadius: '4px' },
    })
    expect(result.success).toBe(true)

    const classes = useEditorStore.getState().site!.styleRules
    const cls = Object.values(classes).find((c) => c.name === 'card')!
    expect(cls.styles.padding).toBe('16px')
    expect(cls.styles.borderRadius).toBe('4px')
  })

  it('updateClassStyles can target a configured breakpoint without changing base styles', async () => {
    freshStore()
    await executeAgentTool('createClass', { name: 'responsive-card', styles: { display: 'grid', gridTemplateColumns: '1fr 1fr' } })

    const result = await executeAgentTool('updateClassStyles', {
      classId: 'responsive-card',
      breakpointId: 'mobile',
      patch: { gridTemplateColumns: '1fr', gap: '16px' },
    })
    expect(result.success).toBe(true)

    const classes = useEditorStore.getState().site!.styleRules
    const cls = Object.values(classes).find((c) => c.name === 'responsive-card')!
    expect(cls.styles.gridTemplateColumns).toBe('1fr 1fr')
    expect(cls.contextStyles.mobile.gridTemplateColumns).toBe('1fr')
    expect(cls.contextStyles.mobile.gap).toBe('16px')
  })

  it('fails when updateClassStyles targets an unknown breakpoint', async () => {
    freshStore()
    await executeAgentTool('createClass', { name: 'responsive-card', styles: { padding: '24px' } })

    const result = await executeAgentTool('updateClassStyles', {
      classId: 'responsive-card',
      breakpointId: 'watch',
      patch: { padding: '12px' },
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Breakpoint not found')

    const cls = Object.values(useEditorStore.getState().site!.styleRules).find((c) => c.name === 'responsive-card')!
    expect(cls.styles.padding).toBe('24px')
    expect(cls.contextStyles.watch).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// addPage
// ---------------------------------------------------------------------------

describe('executeAgentTool — addPage', () => {
  it('adds a page to the site', async () => {
    freshStore()
    const result = await executeAgentTool('addPage', { title: 'About', slug: 'about' })
    expect(result.success).toBe(true)
    expect(result.nodeId).toBeTruthy() // returns new page id
    const pages = useEditorStore.getState().site!.pages
    expect(pages.some((p) => p.title === 'About')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// renamePage / deletePage / duplicatePage — page-admin
// ---------------------------------------------------------------------------

describe('executeAgentTool — renamePage', () => {
  it('renames an existing page', async () => {
    freshStore()
    const addResult = await executeAgentTool('addPage', { title: 'About', slug: 'about' })
    const pageId = addResult.nodeId!

    const result = await executeAgentTool('renamePage', {
      pageId,
      title: 'About Us',
      slug: 'about-us',
    })
    expect(result.success).toBe(true)

    const page = useEditorStore.getState().site!.pages.find((p) => p.id === pageId)!
    expect(page.title).toBe('About Us')
    expect(page.slug).toBe('about-us')
  })

  it('fails for a missing page id', async () => {
    freshStore()
    const result = await executeAgentTool('renamePage', {
      pageId: 'nonexistent',
      title: 'Whatever',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Page not found')
  })
})

describe('executeAgentTool — deletePage', () => {
  it('deletes a page when more than one remains', async () => {
    freshStore()
    const added = await executeAgentTool('addPage', { title: 'About', slug: 'about' })
    const pageId = added.nodeId!

    const result = await executeAgentTool('deletePage', { pageId })
    expect(result.success).toBe(true)

    const pages = useEditorStore.getState().site!.pages
    expect(pages.some((p) => p.id === pageId)).toBe(false)
  })

  it('fails for a missing page id', async () => {
    freshStore()
    const result = await executeAgentTool('deletePage', { pageId: 'nonexistent' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Page not found')
  })

  it('refuses to delete the last remaining page', async () => {
    freshStore()
    // freshStore creates one page; we did not add another, so it's the only one.
    const onlyPage = useEditorStore.getState().site!.pages[0]
    const result = await executeAgentTool('deletePage', { pageId: onlyPage.id })
    expect(result.success).toBe(false)
    expect(result.error).toContain('last page')
  })
})

describe('executeAgentTool — duplicatePage', () => {
  it('deep-clones a page with all of its nodes under a new title and slug', async () => {
    const { rootId } = freshStore()
    // Add some content to the source page so the duplicate isn't trivially empty.
    await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '<h1>Hero</h1>',
    })
    await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '<button>Click me</button>',
    })

    const sourcePage = useEditorStore.getState().site!.pages[0]
    const sourceNodeCount = Object.keys(sourcePage.nodes).length

    const result = await executeAgentTool('duplicatePage', {
      pageId: sourcePage.id,
      title: 'Pricing',
      slug: 'pricing',
    })
    expect(result.success).toBe(true)
    expect(result.nodeId).toBeTruthy()

    const newPage = useEditorStore.getState().site!.pages.find((p) => p.id === result.nodeId)!
    expect(newPage.title).toBe('Pricing')
    expect(newPage.slug).toBe('pricing')
    // Every source node has a fresh-id counterpart in the new page.
    expect(Object.keys(newPage.nodes)).toHaveLength(sourceNodeCount)
    // No id overlap with the source.
    const sharedIds = Object.keys(newPage.nodes).filter((id) => sourcePage.nodes[id])
    expect(sharedIds).toEqual([])
  })

  it('fails for a missing source page id', async () => {
    freshStore()
    const result = await executeAgentTool('duplicatePage', {
      pageId: 'nonexistent',
      title: 'Copy',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Page not found')
  })
})

// ---------------------------------------------------------------------------
// duplicateNode
// ---------------------------------------------------------------------------

describe('executeAgentTool — duplicateNode', () => {
  it('clones a node and inserts it immediately after the source', async () => {
    const { rootId } = freshStore()
    const insertResult = await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '<h2>Original</h2>',
    })
    const sourceId = insertResult.nodeIds![0]

    const result = await executeAgentTool('duplicateNode', { nodeId: sourceId })
    expect(result.success).toBe(true)
    expect(result.nodeId).toBeTruthy()
    expect(result.nodeId).not.toBe(sourceId)

    const root = useEditorStore.getState().site!.pages[0].nodes[rootId]
    expect(root.children).toEqual([sourceId, result.nodeId])
    // Cloned props match source.
    const cloned = useEditorStore.getState().site!.pages[0].nodes[result.nodeId!]
    expect(cloned.props.text).toBe('Original')
    expect(cloned.props.tag).toBe('h2')
  })

  it('produces N clones in arrival order when count is set', async () => {
    const { rootId } = freshStore()
    const insertResult = await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '<div></div>',
    })
    const sourceId = insertResult.nodeIds![0]

    const result = await executeAgentTool('duplicateNode', {
      nodeId: sourceId,
      count: 3,
    })
    expect(result.success).toBe(true)

    const root = useEditorStore.getState().site!.pages[0].nodes[rootId]
    // Source + 3 clones, all in order, all distinct ids.
    expect(root.children).toHaveLength(4)
    expect(root.children[0]).toBe(sourceId)
    expect(new Set(root.children).size).toBe(4)
  })

  it('preserves class assignments and breakpoint overrides on clones', async () => {
    const { rootId } = freshStore()
    const cls = useEditorStore.getState().createClass('btn-primary', { color: '#fff' })
    const insertResult = await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '<p>Hi</p>',
    })
    const sourceId = insertResult.nodeIds![0]
    // Assign the class via the executor so the actual class ID is stored
    await executeAgentTool('assignClass', { nodeId: sourceId, classId: cls.id })
    // Seed a breakpoint override directly on the store — the agent executor
    // would reject this for content props, but the duplicateNode mutation
    // itself is generic and must carry whatever override data exists.
    useEditorStore.getState().setBreakpointOverride(sourceId, 'mobile', { text: 'Hi (mobile)' })

    const result = await executeAgentTool('duplicateNode', { nodeId: sourceId })
    expect(result.success).toBe(true)

    const cloned = useEditorStore.getState().site!.pages[0].nodes[result.nodeId!]
    expect(cloned.classIds).toContain(cls.id)
    expect(cloned.breakpointOverrides.mobile?.text).toBe('Hi (mobile)')
  })

  it('fails for a missing source node id', async () => {
    freshStore()
    const result = await executeAgentTool('duplicateNode', { nodeId: 'nonexistent' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('duplicate')
  })
})

// ---------------------------------------------------------------------------
// updateNodeProps — richtext sanitization (Constraint #299 / security)
// ---------------------------------------------------------------------------

describe('executeAgentTool — updateNodeProps richtext sanitization (Constraint #299)', () => {
  it('strips <script> from a richtext prop updated via the agent', async () => {
    const { rootId } = freshStore()
    const { nodeIds } = await executeAgentTool('insertHtml', { parentId: rootId, html: '<p></p>' })
    const nodeId = nodeIds![0]
    await executeAgentTool('updateNodeProps', {
      nodeId,
      patch: { richtext: '<p>Hello</p><script>alert(1)</script>' },
    })
    const page = useEditorStore.getState().site!.pages[0]
    const stored = page.nodes[nodeId].props.richtext as string
    expect(stored).not.toContain('<script>')
    expect(stored).not.toContain('alert(1)')
    expect(stored).toContain('Hello')
  })

  it('strips onerror attribute from richtext prop via agent updateNodeProps', async () => {
    const { rootId } = freshStore()
    const { nodeIds } = await executeAgentTool('insertHtml', { parentId: rootId, html: '<p></p>' })
    const nodeId = nodeIds![0]
    await executeAgentTool('updateNodeProps', {
      nodeId,
      patch: { richtext: '<img src=x onerror=alert(1)>' },
    })
    const page = useEditorStore.getState().site!.pages[0]
    const stored = page.nodes[nodeId].props.richtext as string
    expect(stored).not.toContain('onerror')
    expect(stored).not.toContain('alert(1)')
  })

  it('strips javascript: href from richtext prop via agent updateNodeProps', async () => {
    const { rootId } = freshStore()
    const { nodeIds } = await executeAgentTool('insertHtml', { parentId: rootId, html: '<p></p>' })
    const nodeId = nodeIds![0]
    await executeAgentTool('updateNodeProps', {
      nodeId,
      patch: { bodyHtml: '<a href="javascript:alert(1)">click</a>' },
    })
    const page = useEditorStore.getState().site!.pages[0]
    const stored = page.nodes[nodeId].props.bodyHtml as string
    expect(stored).not.toContain('javascript:')
  })

  it('preserves safe HTML in richtext prop via agent updateNodeProps', async () => {
    const { rootId } = freshStore()
    const { nodeIds } = await executeAgentTool('insertHtml', { parentId: rootId, html: '<p></p>' })
    const nodeId = nodeIds![0]
    const safeHtml = '<p><strong>Bold</strong> and <em>italic</em></p>'
    await executeAgentTool('updateNodeProps', {
      nodeId,
      patch: { richtext: safeHtml },
    })
    const page = useEditorStore.getState().site!.pages[0]
    const stored = page.nodes[nodeId].props.richtext as string
    expect(stored).toContain('Bold')
    expect(stored).toContain('italic')
  })

  it('plain (non-richtext-keyed) props are NOT sanitized by DOMPurify', async () => {
    const { rootId } = freshStore()
    const { nodeIds } = await executeAgentTool('insertHtml', { parentId: rootId, html: '<p></p>' })
    const nodeId = nodeIds![0]
    await executeAgentTool('updateNodeProps', {
      nodeId,
      patch: { text: 'Cats & Dogs' },
    })
    const page = useEditorStore.getState().site!.pages[0]
    expect(page.nodes[nodeId].props.text).toBe('Cats & Dogs')
  })
})

// ---------------------------------------------------------------------------
// insertHtml — unsafe HTML is stripped on import (Constraint #299 / security)
// ---------------------------------------------------------------------------

describe('executeAgentTool — insertHtml unsafe HTML stripping (Constraint #299)', () => {
  it('strips script tags from HTML on import', async () => {
    const { rootId } = freshStore()
    const result = await executeAgentTool('insertHtml', {
      parentId: rootId,
      html: '<p>Hello</p><script>alert(1)</script>',
    })
    // The <script> is stripped by stripUnsafe; only the <p> is imported
    expect(result.success).toBe(true)

    const page = useEditorStore.getState().site!.pages[0]
    // A base.text node was created from the <p>
    const addedNodes = Object.values(page.nodes).filter((n) => n.moduleId === 'base.text')
    expect(addedNodes.length).toBeGreaterThan(0)
    // No node props contain the script content
    const withScript = addedNodes.find((n) => String(n.props.text).includes('alert'))
    expect(withScript).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Unknown tool names
// ---------------------------------------------------------------------------

describe('executeAgentTool — unknown tool name', () => {
  it('returns success: false for tool names the executor does not recognise', async () => {
    freshStore()
    const result = await executeAgentTool('not-a-real-tool', {})
    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown')
  })
})
