/**
 * Phase D — Agent executor tests.
 *
 * Covers:
 * - executeAgentAction: happy path for each action type
 * - Zod validation: invalid params → success: false
 * - executeAgentActions: batch execution, fail-fast on error
 *
 * Constraint #272: all inputs must pass Zod validation before store dispatch.
 * Constraint #283/#286: no Anthropic SDK imports.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { useEditorStore } from '../../core/editor-store/store'
import { executeAgentAction, executeAgentActions } from '../../core/agent/executor'
import '../../modules/base'

// ---------------------------------------------------------------------------
// Store reset helper
// ---------------------------------------------------------------------------

function freshStore() {
  useEditorStore.setState({
    project: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    selectedNodeId: null,
    hoveredNodeId: null,
    activeClassId: null,
    isAgentOpen: false,
    isAgentStreaming: false,
    agentMessages: [],
    agentError: null,
    hasUnsavedChanges: false,
  })
  const s = useEditorStore.getState()
  const project = s.createProject('Test')
  const rootId = project.pages[0].rootNodeId
  return { rootId, store: useEditorStore.getState() }
}

// ---------------------------------------------------------------------------
// insertNode
// ---------------------------------------------------------------------------

describe('executeAgentAction — insertNode', () => {
  it('inserts a node and returns success + nodeId', async () => {
    const { rootId } = freshStore()
    const result = await executeAgentAction({
      type: 'insertNode',
      moduleId: 'base.text',
      parentId: rootId,
      props: { text: 'Hello', tag: 'h1' },
    })
    expect(result.success).toBe(true)
    expect(result.nodeId).toBeTruthy()
    // Verify the node was actually inserted
    const page = useEditorStore.getState().project!.pages[0]
    expect(Object.values(page.nodes).some((n) => n.moduleId === 'base.text')).toBe(true)
  })

  it('merges module defaults when the agent omits props', async () => {
    const { rootId } = freshStore()
    const result = await executeAgentAction({
      type: 'insertNode',
      moduleId: 'base.container',
      parentId: rootId,
      props: {},
    })

    expect(result.success).toBe(true)
    const page = useEditorStore.getState().project!.pages[0]
    const node = page.nodes[result.nodeId!]
    expect(node.props.tag).toBe('div')
  })

  it('lets agent props override module defaults after merging defaults', async () => {
    const { rootId } = freshStore()
    const result = await executeAgentAction({
      type: 'insertNode',
      moduleId: 'base.container',
      parentId: rootId,
      props: { tag: 'section' },
    })

    expect(result.success).toBe(true)
    const page = useEditorStore.getState().project!.pages[0]
    const node = page.nodes[result.nodeId!]
    expect(node.props.tag).toBe('section')
  })

  it('appends to parent children without index', async () => {
    const { rootId } = freshStore()
    await executeAgentAction({ type: 'insertNode', moduleId: 'base.text', parentId: rootId })
    await executeAgentAction({ type: 'insertNode', moduleId: 'base.button', parentId: rootId })
    const page = useEditorStore.getState().project!.pages[0]
    const root = page.nodes[rootId]
    expect(root.children).toHaveLength(2)
  })

  it('returns failure for invalid params (missing moduleId)', async () => {
    const { rootId } = freshStore()
    const result = await executeAgentAction({
      type: 'insertNode',
      moduleId: '', // fails minLength(1)
      parentId: rootId,
    })
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('returns failure for module IDs that are not registered', async () => {
    const { rootId } = freshStore()
    const result = await executeAgentAction({
      type: 'insertNode',
      moduleId: 'missing.module',
      parentId: rootId,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Module not found')
  })
})

// ---------------------------------------------------------------------------
// deleteNode
// ---------------------------------------------------------------------------

describe('executeAgentAction — deleteNode', () => {
  it('deletes a node successfully', async () => {
    const { rootId } = freshStore()
    const insertResult = await executeAgentAction({
      type: 'insertNode', moduleId: 'base.text', parentId: rootId,
    })
    const nodeId = insertResult.nodeId!

    const deleteResult = await executeAgentAction({ type: 'deleteNode', nodeId })
    expect(deleteResult.success).toBe(true)

    const page = useEditorStore.getState().project!.pages[0]
    expect(page.nodes[nodeId]).toBeUndefined()
  })

  it('fails with empty nodeId', async () => {
    freshStore()
    const result = await executeAgentAction({ type: 'deleteNode', nodeId: '' })
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// updateNodeProps
// ---------------------------------------------------------------------------

describe('executeAgentAction — updateNodeProps', () => {
  it('patches node props', async () => {
    const { rootId } = freshStore()
    const { nodeId } = await executeAgentAction({
      type: 'insertNode', moduleId: 'base.text', parentId: rootId, props: { text: 'Old' },
    })
    await executeAgentAction({ type: 'updateNodeProps', nodeId: nodeId!, patch: { text: 'New' } })
    const page = useEditorStore.getState().project!.pages[0]
    expect(page.nodes[nodeId!].props.text).toBe('New')
  })

  it('can target a configured breakpoint without changing base props', async () => {
    const { rootId } = freshStore()
    const { nodeId } = await executeAgentAction({
      type: 'insertNode',
      moduleId: 'base.text',
      parentId: rootId,
      props: { text: 'Desktop copy' },
    })

    const result = await executeAgentAction({
      type: 'updateNodeProps',
      nodeId: nodeId!,
      breakpointId: 'mobile',
      patch: { text: 'Mobile copy' },
    })

    expect(result.success).toBe(true)
    const page = useEditorStore.getState().project!.pages[0]
    expect(page.nodes[nodeId!].props.text).toBe('Desktop copy')
    expect(page.nodes[nodeId!].breakpointOverrides.mobile.text).toBe('Mobile copy')
  })
})

// ---------------------------------------------------------------------------
// moveNode
// ---------------------------------------------------------------------------

describe('executeAgentAction — moveNode', () => {
  it('moves a node to a new parent', async () => {
    const { rootId } = freshStore()
    // Create two containers
    const c1 = (await executeAgentAction({ type: 'insertNode', moduleId: 'base.container', parentId: rootId })).nodeId!
    const c2 = (await executeAgentAction({ type: 'insertNode', moduleId: 'base.container', parentId: rootId })).nodeId!
    // Add child to c1
    const child = (await executeAgentAction({ type: 'insertNode', moduleId: 'base.text', parentId: c1 })).nodeId!
    // Move child to c2
    const result = await executeAgentAction({ type: 'moveNode', nodeId: child, newParentId: c2, newIndex: 0 })
    expect(result.success).toBe(true)
    const page = useEditorStore.getState().project!.pages[0]
    expect(page.nodes[c2].children).toContain(child)
    expect(page.nodes[c1].children).not.toContain(child)
  })
})

// ---------------------------------------------------------------------------
// renameNode
// ---------------------------------------------------------------------------

describe('executeAgentAction — renameNode', () => {
  it('sets the node label', async () => {
    const { rootId } = freshStore()
    const { nodeId } = await executeAgentAction({ type: 'insertNode', moduleId: 'base.text', parentId: rootId })
    await executeAgentAction({ type: 'renameNode', nodeId: nodeId!, label: 'Hero Heading' })
    const page = useEditorStore.getState().project!.pages[0]
    expect(page.nodes[nodeId!].label).toBe('Hero Heading')
  })
})

// ---------------------------------------------------------------------------
// createClass
// ---------------------------------------------------------------------------

describe('executeAgentAction — createClass', () => {
  it('creates a class and returns its ID in nodeId field', async () => {
    freshStore()
    const result = await executeAgentAction({
      type: 'createClass', name: 'btn-primary', styles: { fontSize: '14px' },
    })
    expect(result.success).toBe(true)
    expect(result.nodeId).toBeTruthy() // classId returned in nodeId field
    const classes = useEditorStore.getState().project!.classes
    expect(Object.values(classes).some((c) => c.name === 'btn-primary')).toBe(true)
  })

  it('fails when class name is empty', async () => {
    freshStore()
    const result = await executeAgentAction({ type: 'createClass', name: '' })
    expect(result.success).toBe(false)
  })

  it('creates a class with breakpoint-specific styles', async () => {
    freshStore()
    const result = await executeAgentAction({
      type: 'createClass',
      name: 'responsive-heading',
      styles: { fontSize: '64px', lineHeight: '1' },
      breakpointStyles: {
        mobile: { fontSize: '40px', lineHeight: '1.05' },
      },
    })

    expect(result.success).toBe(true)
    const cls = useEditorStore.getState().project!.classes[result.nodeId!]
    expect(cls.styles.fontSize).toBe('64px')
    expect(cls.breakpointStyles.mobile.fontSize).toBe('40px')
    expect(cls.breakpointStyles.mobile.lineHeight).toBe('1.05')
  })
})

// ---------------------------------------------------------------------------
// assignClass / removeClass
// ---------------------------------------------------------------------------

describe('executeAgentAction — assignClass / removeClass', () => {
  it('assigns a class to a node', async () => {
    const { rootId } = freshStore()
    const { nodeId } = await executeAgentAction({ type: 'insertNode', moduleId: 'base.text', parentId: rootId })
    const classResult = await executeAgentAction({ type: 'createClass', name: 'highlighted' })
    const classId = classResult.nodeId!

    await executeAgentAction({ type: 'assignClass', nodeId: nodeId!, classId })
    const page = useEditorStore.getState().project!.pages[0]
    expect(page.nodes[nodeId!].classIds).toContain(classId)
  })

  it('removes a class from a node', async () => {
    const { rootId } = freshStore()
    const { nodeId } = await executeAgentAction({ type: 'insertNode', moduleId: 'base.text', parentId: rootId })
    const classResult = await executeAgentAction({ type: 'createClass', name: 'highlighted2' })
    const classId = classResult.nodeId!

    await executeAgentAction({ type: 'assignClass', nodeId: nodeId!, classId })
    await executeAgentAction({ type: 'removeClass', nodeId: nodeId!, classId })
    const page = useEditorStore.getState().project!.pages[0]
    expect(page.nodes[nodeId!].classIds ?? []).not.toContain(classId)
  })
})

// ---------------------------------------------------------------------------
// assignClass — name-based resolution (same-batch ID gap fix)
// ---------------------------------------------------------------------------

describe('executeAgentAction — assignClass name-based resolution', () => {
  it('resolves classId by name when the class was just created in the same batch', async () => {
    // Simulate agent workflow: createClass then assignClass using the name
    const { rootId } = freshStore()
    const { nodeId } = await executeAgentAction({ type: 'insertNode', moduleId: 'base.button', parentId: rootId })
    await executeAgentAction({ type: 'createClass', name: 'btn-hero', styles: { color: '#fff' } })

    // Agent uses name as classId (it can't know the nanoid)
    const result = await executeAgentAction({ type: 'assignClass', nodeId: nodeId!, classId: 'btn-hero' })
    expect(result.success).toBe(true)

    const page = useEditorStore.getState().project!.pages[0]
    const classes = useEditorStore.getState().project!.classes
    const heroClass = Object.values(classes).find((c) => c.name === 'btn-hero')!
    expect(page.nodes[nodeId!].classIds).toContain(heroClass.id)
  })

  it('returns failure when classId / name does not match any class', async () => {
    const { rootId } = freshStore()
    const { nodeId } = await executeAgentAction({ type: 'insertNode', moduleId: 'base.button', parentId: rootId })
    const result = await executeAgentAction({ type: 'assignClass', nodeId: nodeId!, classId: 'nonexistent-class' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('nonexistent-class')
  })

  it('removeClass also resolves by name', async () => {
    const { rootId } = freshStore()
    const { nodeId } = await executeAgentAction({ type: 'insertNode', moduleId: 'base.button', parentId: rootId })
    await executeAgentAction({ type: 'createClass', name: 'removable' })
    await executeAgentAction({ type: 'assignClass', nodeId: nodeId!, classId: 'removable' })

    const result = await executeAgentAction({ type: 'removeClass', nodeId: nodeId!, classId: 'removable' })
    expect(result.success).toBe(true)

    const page = useEditorStore.getState().project!.pages[0]
    const classes = useEditorStore.getState().project!.classes
    const cls = Object.values(classes).find((c) => c.name === 'removable')!
    expect(page.nodes[nodeId!].classIds ?? []).not.toContain(cls.id)
  })

  it('updateClassStyles also resolves by name', async () => {
    freshStore()
    await executeAgentAction({ type: 'createClass', name: 'card', styles: { padding: '8px' } })

    const result = await executeAgentAction({
      type: 'updateClassStyles',
      classId: 'card',
      patch: { padding: '16px', borderRadius: '4px' },
    })
    expect(result.success).toBe(true)

    const classes = useEditorStore.getState().project!.classes
    const cls = Object.values(classes).find((c) => c.name === 'card')!
    expect(cls.styles.padding).toBe('16px')
    expect(cls.styles.borderRadius).toBe('4px')
  })

  it('updateClassStyles can target a configured breakpoint without changing base styles', async () => {
    freshStore()
    await executeAgentAction({ type: 'createClass', name: 'responsive-card', styles: { display: 'grid', gridTemplateColumns: '1fr 1fr' } })

    const result = await executeAgentAction({
      type: 'updateClassStyles',
      classId: 'responsive-card',
      breakpointId: 'mobile',
      patch: { gridTemplateColumns: '1fr', gap: '16px' },
    })
    expect(result.success).toBe(true)

    const classes = useEditorStore.getState().project!.classes
    const cls = Object.values(classes).find((c) => c.name === 'responsive-card')!
    expect(cls.styles.gridTemplateColumns).toBe('1fr 1fr')
    expect(cls.breakpointStyles.mobile.gridTemplateColumns).toBe('1fr')
    expect(cls.breakpointStyles.mobile.gap).toBe('16px')
  })

  it('fails when updateClassStyles targets an unknown breakpoint', async () => {
    freshStore()
    await executeAgentAction({ type: 'createClass', name: 'responsive-card', styles: { padding: '24px' } })

    const result = await executeAgentAction({
      type: 'updateClassStyles',
      classId: 'responsive-card',
      breakpointId: 'watch',
      patch: { padding: '12px' },
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Breakpoint not found')

    const cls = Object.values(useEditorStore.getState().project!.classes).find((c) => c.name === 'responsive-card')!
    expect(cls.styles.padding).toBe('24px')
    expect(cls.breakpointStyles.watch).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// addPage
// ---------------------------------------------------------------------------

describe('executeAgentAction — addPage', () => {
  it('adds a page to the project', async () => {
    freshStore()
    const result = await executeAgentAction({ type: 'addPage', title: 'About', slug: 'about' })
    expect(result.success).toBe(true)
    const pages = useEditorStore.getState().project!.pages
    expect(pages.some((p) => p.title === 'About')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// updateNodeProps — richtext sanitization (Constraint #299 / security)
// ---------------------------------------------------------------------------
//
// The agent executor receives action objects from an AI server response.
// Even with Zod schema validation, the content of richtext-typed prop values
// must be sanitized via DOMPurify before being stored. Constraint #299 mandates
// that every write path — including the agent dispatcher — calls sanitizeRichtext()
// on richtext-keyed props. A prompt-injected AI response could otherwise inject
// XSS payloads (e.g. <script>alert(1)</script>) into richtext props that the
// publisher then passes through unescaped to the final HTML (CWE-79, High).

describe('executeAgentAction — updateNodeProps richtext sanitization (Constraint #299)', () => {
  it('strips <script> from a richtext prop updated via the agent', async () => {
    const { rootId } = freshStore()
    const { nodeId } = await executeAgentAction({
      type: 'insertNode', moduleId: 'base.text', parentId: rootId,
    })
    await executeAgentAction({
      type: 'updateNodeProps',
      nodeId: nodeId!,
      patch: { richtext: '<p>Hello</p><script>alert(1)</script>' },
    })
    const page = useEditorStore.getState().project!.pages[0]
    const stored = page.nodes[nodeId!].props.richtext as string
    // XSS must be stripped — executor must call sanitizeRichtext()
    expect(stored).not.toContain('<script>')
    expect(stored).not.toContain('alert(1)')
    // Safe content must be preserved
    expect(stored).toContain('Hello')
  })

  it('strips onerror attribute from richtext prop via agent updateNodeProps', async () => {
    const { rootId } = freshStore()
    const { nodeId } = await executeAgentAction({
      type: 'insertNode', moduleId: 'base.text', parentId: rootId,
    })
    await executeAgentAction({
      type: 'updateNodeProps',
      nodeId: nodeId!,
      patch: { richtext: '<img src=x onerror=alert(1)>' },
    })
    const page = useEditorStore.getState().project!.pages[0]
    const stored = page.nodes[nodeId!].props.richtext as string
    expect(stored).not.toContain('onerror')
    expect(stored).not.toContain('alert(1)')
  })

  it('strips javascript: href from richtext prop via agent updateNodeProps', async () => {
    const { rootId } = freshStore()
    const { nodeId } = await executeAgentAction({
      type: 'insertNode', moduleId: 'base.text', parentId: rootId,
    })
    await executeAgentAction({
      type: 'updateNodeProps',
      nodeId: nodeId!,
      patch: { bodyHtml: '<a href="javascript:alert(1)">click</a>' },
    })
    const page = useEditorStore.getState().project!.pages[0]
    const stored = page.nodes[nodeId!].props.bodyHtml as string
    expect(stored).not.toContain('javascript:')
  })

  it('preserves safe HTML in richtext prop via agent updateNodeProps', async () => {
    const { rootId } = freshStore()
    const { nodeId } = await executeAgentAction({
      type: 'insertNode', moduleId: 'base.text', parentId: rootId,
    })
    const safeHtml = '<p><strong>Bold</strong> and <em>italic</em></p>'
    await executeAgentAction({
      type: 'updateNodeProps',
      nodeId: nodeId!,
      patch: { richtext: safeHtml },
    })
    const page = useEditorStore.getState().project!.pages[0]
    const stored = page.nodes[nodeId!].props.richtext as string
    expect(stored).toContain('Bold')
    expect(stored).toContain('italic')
  })

  it('plain (non-richtext-keyed) props are NOT sanitized by DOMPurify', async () => {
    // "text" is a plain prop — it is NOT richtext-keyed. The executor must NOT
    // run DOMPurify on it (that would strip legitimate HTML entity content).
    // Plain string props are sanitized at publish time via escapeHtml() instead.
    const { rootId } = freshStore()
    const { nodeId } = await executeAgentAction({
      type: 'insertNode', moduleId: 'base.text', parentId: rootId,
    })
    await executeAgentAction({
      type: 'updateNodeProps',
      nodeId: nodeId!,
      patch: { text: 'Cats & Dogs' },
    })
    const page = useEditorStore.getState().project!.pages[0]
    // "text" should be stored as-is (no DOMPurify treatment)
    expect(page.nodes[nodeId!].props.text).toBe('Cats & Dogs')
  })
})

describe('executeAgentAction — insertNode richtext sanitization (Constraint #299)', () => {
  it('sanitizes richtext prop in initial props during insertNode', async () => {
    const { rootId } = freshStore()
    const result = await executeAgentAction({
      type: 'insertNode',
      moduleId: 'base.text',
      parentId: rootId,
      props: { richtext: '<p>Hello</p><script>alert(1)</script>' },
    })
    expect(result.success).toBe(true)
    const page = useEditorStore.getState().project!.pages[0]
    const stored = page.nodes[result.nodeId!].props.richtext as string
    // XSS must be stripped at insertion time too
    expect(stored).not.toContain('<script>')
    expect(stored).toContain('Hello')
  })
})

// ---------------------------------------------------------------------------
// executeAgentActions — batch + fail-fast
// ---------------------------------------------------------------------------

describe('executeAgentActions — batch execution', () => {
  it('executes multiple actions in order', async () => {
    const { rootId } = freshStore()
    const results = await executeAgentActions([
      { type: 'insertNode', moduleId: 'base.container', parentId: rootId },
      { type: 'insertNode', moduleId: 'base.text', parentId: rootId },
    ])
    expect(results).toHaveLength(2)
    expect(results.every((r) => r.success)).toBe(true)
  })

  it('resolves temporary node refs inside a batch for nested inserts', async () => {
    const { rootId } = freshStore()
    const results = await executeAgentActions([
      { type: 'insertNode', ref: 'hero', moduleId: 'base.container', parentId: rootId, props: { tag: 'section' } },
      { type: 'insertNode', moduleId: 'base.text', parentRef: 'hero', props: { tag: 'h1', text: 'Design systems for web teams' } },
    ])

    expect(results).toHaveLength(2)
    expect(results.every((r) => r.success)).toBe(true)

    const page = useEditorStore.getState().project!.pages[0]
    const heroId = results[0].nodeId!
    const headingId = results[1].nodeId!
    expect(page.nodes[heroId].children).toContain(headingId)
    expect(page.nodes[headingId].props.text).toBe('Design systems for web teams')
  })

  it('can style newly inserted nodes in the same batch using class names and node refs', async () => {
    const { rootId } = freshStore()
    const results = await executeAgentActions([
      {
        type: 'createClass',
        name: 'designer-hero',
        styles: {
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
          padding: '96px 64px',
          backgroundColor: '#111827',
          color: '#ffffff',
        },
      },
      {
        type: 'createClass',
        name: 'designer-title',
        styles: {
          fontSize: '64px',
          lineHeight: '1',
          fontWeight: '700',
        },
      },
      {
        type: 'insertNode',
        ref: 'hero',
        moduleId: 'base.container',
        parentId: rootId,
        props: { tag: 'section' },
        classIds: ['designer-hero'],
      },
      {
        type: 'insertNode',
        ref: 'title',
        moduleId: 'base.text',
        parentRef: 'hero',
        props: { tag: 'h1', text: 'Web Design That Converts' },
      },
      {
        type: 'assignClass',
        nodeRef: 'title',
        classId: 'designer-title',
      },
    ])

    expect(results).toHaveLength(5)
    expect(results.every((r) => r.success)).toBe(true)

    const page = useEditorStore.getState().project!.pages[0]
    const classes = useEditorStore.getState().project!.classes
    const heroClass = Object.values(classes).find((c) => c.name === 'designer-hero')!
    const titleClass = Object.values(classes).find((c) => c.name === 'designer-title')!
    const heroId = results[2].nodeId!
    const titleId = results[3].nodeId!

    expect(page.nodes[heroId].classIds).toContain(heroClass.id)
    expect(page.nodes[titleId].classIds).toContain(titleClass.id)
  })

  it('fails instead of silently creating empty classes for unknown insertNode class names', async () => {
    const { rootId } = freshStore()
    const results = await executeAgentActions([
      {
        type: 'insertNode',
        ref: 'title',
        moduleId: 'base.text',
        parentId: rootId,
        props: { tag: 'h1', text: 'Simple page' },
        classIds: ['agent-title'],
      },
      {
        type: 'insertNode',
        moduleId: 'base.button',
        parentId: rootId,
        props: { label: 'Contact' },
      },
    ])

    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(false)
    expect(results[0].error).toContain('Class not found')

    const classes = useEditorStore.getState().project!.classes
    const createdClass = Object.values(classes).find((c) => c.name === 'agent-title')
    expect(createdClass).toBeUndefined()

    const page = useEditorStore.getState().project!.pages[0]
    expect(page.nodes[rootId].children).toHaveLength(0)
  })

  it('inserts a styled nested tree in one efficient action', async () => {
    const { rootId } = freshStore()
    const results = await executeAgentActions([
      {
        type: 'insertTree',
        parentId: rootId,
        classes: [
          {
            name: 'agent-hero',
            styles: {
              display: 'flex',
              flexDirection: 'column',
              gap: '24px',
              paddingTop: '80px',
              paddingRight: '64px',
              paddingBottom: '80px',
              paddingLeft: '64px',
              backgroundColor: '#111827',
              color: '#ffffff',
            },
          },
          {
            name: 'agent-hero-title',
            styles: {
              fontSize: '56px',
              lineHeight: '1.05',
              fontWeight: '700',
              color: '#ffffff',
            },
            breakpointStyles: {
              mobile: {
                fontSize: '40px',
                lineHeight: '1.08',
              },
            },
          },
          {
            name: 'agent-cta',
            styles: {
              width: 'fit-content',
              paddingTop: '12px',
              paddingRight: '18px',
              paddingBottom: '12px',
              paddingLeft: '18px',
              borderRadius: '8px',
              backgroundColor: '#ffffff',
              color: '#111827',
            },
          },
        ],
        tree: {
          ref: 'hero',
          moduleId: 'base.container',
          props: { tag: 'section' },
          classIds: ['agent-hero'],
          children: [
            {
              ref: 'title',
              moduleId: 'base.text',
              props: { tag: 'h1', text: 'Designed with intent' },
              classIds: ['agent-hero-title'],
            },
            {
              moduleId: 'base.button',
              props: { label: 'Start a project' },
              classIds: ['agent-cta'],
            },
          ],
        },
      },
    ])

    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(true)

    const state = useEditorStore.getState()
    const page = state.project!.pages[0]
    const heroId = results[0].nodeId!
    const hero = page.nodes[heroId]
    const title = page.nodes[hero.children[0]]
    const classes = Object.values(state.project!.classes)
    const heroClass = classes.find((c) => c.name === 'agent-hero')
    const titleClass = classes.find((c) => c.name === 'agent-hero-title')
    const ctaClass = classes.find((c) => c.name === 'agent-cta')

    expect(hero.children).toHaveLength(2)
    expect(hero.classIds).toContain(heroClass!.id)
    expect(title.classIds).toContain(titleClass!.id)
    expect(heroClass?.styles.backgroundColor).toBe('#111827')
    expect(titleClass?.styles.fontSize).toBe('56px')
    expect(titleClass?.breakpointStyles.mobile.fontSize).toBe('40px')
    expect(ctaClass?.styles.backgroundColor).toBe('#ffffff')
  })

  it('stops at first failure (fail-fast)', async () => {
    const { rootId } = freshStore()
    const results = await executeAgentActions([
      { type: 'insertNode', moduleId: '', parentId: rootId }, // fails — empty moduleId
      { type: 'insertNode', moduleId: 'base.text', parentId: rootId }, // should not run
    ])
    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(false)
  })

  it('rolls back earlier mutations when a later action in the batch fails', async () => {
    const { rootId } = freshStore()
    const results = await executeAgentActions([
      { type: 'insertNode', ref: 'hero', moduleId: 'base.container', parentId: rootId },
      { type: 'insertNode', moduleId: 'missing.module', parentRef: 'hero' },
    ])

    expect(results).toHaveLength(2)
    expect(results[0].success).toBe(true)
    expect(results[1].success).toBe(false)

    const page = useEditorStore.getState().project!.pages[0]
    expect(page.nodes[rootId].children).toHaveLength(0)
    expect(Object.values(page.nodes).some((node) => node.moduleId === 'base.container')).toBe(false)
  })

  it('returns empty array for empty batch', async () => {
    freshStore()
    const results = await executeAgentActions([])
    expect(results).toHaveLength(0)
  })
})
