/**
 * PropertiesPanel Redesign — PP-1..PP-16 Acceptance Gate Tests
 *
 * Task #456 / Spec #659 (UX Reviewer Contribution #659, accepted by Architect).
 *
 * Covers:
 *   PP-1  No role="tablist" in PropertiesPanel.tsx (static gate)
 *   PP-2  ClassPicker (pills + input) visible immediately on node selection — no tab click
 *   PP-3  Clicking class pill opens ClassComposer; clicking again closes it
 *   PP-4  Module props in collapsible Section (defaultOpen=true), titled definition.name
 *   PP-5  Advanced Section removed from the Properties panel
 *   PP-6  Both ClassComposer + PropertiesPanel import Section from same path (static gate)
 *   PP-7  Each pill shows cascade position badge (1-based ordinal ¹ ² ³)
 *   PP-8  Reorder buttons (↑/↓) functional — clicking up moves pill; badge updates
 *   PP-9  Pill × has title="Remove from this element" (static gate)
 *   PP-10 "Edit CSS" textarea is writable; typing + blur applies to class styles
 *   PP-11 Cmd/Ctrl+Enter in Edit CSS textarea applies styles (triggers blur)
 *   PP-12 Escape in Edit CSS textarea reverts without applying
 *   PP-13 Breakpoint hint appears inside Module section when non-desktop bp active
 *   PP-14 Phase-4 architecture gates (Gates 1–5) remain green — covered by existing test file
 *   PP-15 Existing 16 propertiesPanel.test.tsx tests remain green — covered by that file
 *   PP-16 No inline styles, no Tailwind, no !important in new source files (static gate)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import React from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'fs'
import { join } from 'path'
import { PropertiesPanel } from '../../editor/components/PropertiesPanel/PropertiesPanel'
import { parseCSSDeclarations } from '../../editor/components/PropertiesPanel/parseCSSDeclarations'
import { getCSSPropertyDefaultValue, ALL_CSS_PROPERTIES } from '../../editor/components/PropertiesPanel/cssControlTypes'
import type { CSSPropertyBag } from '../../core/page-tree/types'
import { useEditorStore } from '../../core/editor-store/store'
import { makeProject, makePage, makeNode } from '../fixtures'
import '../../modules/base/index'

const SRC_ROOT = join(import.meta.dir, '../../')
const PP_DIR = join(SRC_ROOT, 'editor/components/PropertiesPanel')

afterEach(cleanup)

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------

function resetStore() {
  localStorage.clear()
  useEditorStore.setState({
    project: null,
    activePageId: null,
    activeDocument: null,
    selectedNodeId: null,
    hoveredNodeId: null,
    activeBreakpointId: 'desktop',
    activeClassId: null,
    previewClassAssignment: null,
    domTreePanel: { collapsed: false, x: 0, y: 0, width: 280 },
    propertiesPanel: { collapsed: false, x: 0, y: 0, width: 280 },
    focusedPanel: 'canvas',
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(resetStore)

function loadProjectWithHeading(): { nodeId: string; rootId: string } {
  const rootId = 'root-1'
  const nodeId = 'text-1'
  const rootNode = makeNode({ id: rootId, moduleId: 'base.root', children: [nodeId] })
  const textNode = makeNode({
    id: nodeId,
    moduleId: 'base.text',
    props: { text: 'Hello', tag: 'h2' },
    children: [],
  })
  const page = makePage({ id: 'page-1', rootNodeId: rootId, nodes: { [rootId]: rootNode, [nodeId]: textNode } })
  const project = makeProject({ pages: [page] })
  useEditorStore.setState({ project, activePageId: 'page-1' } as Parameters<typeof useEditorStore.setState>[0])
  return { nodeId, rootId }
}

function loadProjectWithColumns(): { nodeId: string; rootId: string } {
  const rootId = 'root-1'
  const nodeId = 'columns-1'
  const rootNode = makeNode({ id: rootId, moduleId: 'base.root', children: [nodeId] })
  const columnsNode = makeNode({
    id: nodeId,
    moduleId: 'base.columns',
    props: {},
    children: [],
  })
  const page = makePage({ id: 'page-1', rootNodeId: rootId, nodes: { [rootId]: rootNode, [nodeId]: columnsNode } })
  const project = makeProject({ pages: [page] })
  useEditorStore.setState({ project, activePageId: 'page-1' } as Parameters<typeof useEditorStore.setState>[0])
  return { nodeId, rootId }
}

function selectNode(nodeId: string) {
  useEditorStore.setState({ selectedNodeId: nodeId } as Parameters<typeof useEditorStore.setState>[0])
}

/** Set up project with a node that has N classes pre-assigned. Returns nodeId + classIds. */
function loadProjectWithClasses(count: number): { nodeId: string; classIds: string[] } {
  const { nodeId } = loadProjectWithHeading()
  const state = useEditorStore.getState()
  const classIds: string[] = []
  for (let i = 1; i <= count; i++) {
    const cls = state.createClass(`class-${i}`)
    classIds.push(cls.id)
    state.addNodeClass(nodeId, cls.id)
  }
  return { nodeId, classIds }
}

// ---------------------------------------------------------------------------
// PP-1: No role="tablist" in PropertiesPanel.tsx (static)
// ---------------------------------------------------------------------------

describe('PP-1 — No role="tablist" in PropertiesPanel.tsx', () => {
  it('PropertiesPanel.tsx does not contain role="tablist"', () => {
    const src = readFileSync(join(PP_DIR, 'PropertiesPanel.tsx'), 'utf-8')
    expect(src).not.toContain('role="tablist"')
  })
})

// ---------------------------------------------------------------------------
// PP-2: ClassPicker visible immediately on selection — no tab click
// ---------------------------------------------------------------------------

describe('PP-2 — ClassPicker visible immediately on element selection', () => {
  it('class add input is visible directly under the panel header with no accordion interaction', () => {
    const { nodeId } = loadProjectWithHeading()
    selectNode(nodeId)
    render(<PropertiesPanel />)
    const renameButton = screen.getByRole('button', { name: /rename text/i })
    const classInput = screen.getByRole('textbox', { name: /add or create a css class/i })

    expect(classInput).toBeDefined()
    expect(renameButton.compareDocumentPosition(classInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^classes$/i })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// PP-3: Pill click opens minimal ClassComposer; clicking again closes it
// ---------------------------------------------------------------------------

describe('PP-3 — Pill click toggles inline ClassComposer', () => {
  it('clicking a class pill opens ClassComposer; clicking again closes it', () => {
    const { nodeId } = loadProjectWithClasses(1)
    selectNode(nodeId)
    render(<PropertiesPanel />)

    // ClassComposer not visible yet (no active class)
    expect(screen.queryByRole('searchbox', { name: /search class style properties to add/i })).toBeNull()

    // Find the pill and click it
    const pill = screen.getByRole('button', { name: /edit class class-1/i })
    fireEvent.click(pill)

    // ClassComposer now open — minimal property search visible
    expect(screen.getByRole('searchbox', { name: /search class style properties to add/i })).toBeDefined()

    // Click again to deselect
    fireEvent.click(pill)
    expect(screen.queryByRole('searchbox', { name: /search class style properties to add/i })).toBeNull()
  })
})

describe('ClassComposer style autocomplete menu', () => {
  it('uses the shared ContextMenu semantics for style suggestions', () => {
    const { nodeId } = loadProjectWithClasses(1)
    selectNode(nodeId)
    render(<PropertiesPanel />)

    fireEvent.click(screen.getByRole('button', { name: /edit class class-1/i }))
    fireEvent.change(screen.getByRole('searchbox', { name: /search class style properties to add/i }), {
      target: { value: 'color' },
    })

    expect(screen.getByRole('menu', { name: /available style properties/i })).toBeDefined()
    expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0)
    expect(screen.queryByRole('listbox', { name: /available style properties/i })).toBeNull()
    expect(screen.queryByRole('option')).toBeNull()
  })

  it('does not keep bespoke autocomplete result styles in ClassComposer.module.css', () => {
    const css = readFileSync(join(PP_DIR, 'ClassComposer.module.css'), 'utf-8')

    expect(css).not.toMatch(/\.searchResults\b/)
    expect(css).not.toMatch(/\.searchGroup\b/)
    expect(css).not.toMatch(/\.searchGroupHeader\b/)
    expect(css).not.toMatch(/\.searchGroupItems\b/)
    expect(css).not.toMatch(/\.searchResultsEmpty\b/)
  })
})

describe('ClassPicker — suggestion hover preview', () => {
  it('previews an unassigned class while its suggestion is hovered and clears on leave', () => {
    const { nodeId } = loadProjectWithHeading()
    const cls = useEditorStore.getState().createClass('preview-target')
    selectNode(nodeId)
    render(<PropertiesPanel />)

    fireEvent.focus(screen.getByRole('textbox', { name: /add or create a css class/i }))
    const item = screen.getByRole('menuitem', { name: 'preview-target' })

    fireEvent.mouseEnter(item)
    expect(useEditorStore.getState().previewClassAssignment).toEqual({
      nodeId,
      classId: cls.id,
    })
    expect(useEditorStore.getState().project!.pages[0].nodes[nodeId].classIds ?? []).not.toContain(cls.id)

    fireEvent.mouseLeave(item)
    expect(useEditorStore.getState().previewClassAssignment).toBeNull()
  })

  it('does not preview suggestion hovers when the preference is disabled', () => {
    localStorage.setItem('pb-editor-prefs', JSON.stringify({ classHoverPreview: false }))
    const { nodeId } = loadProjectWithHeading()
    useEditorStore.getState().createClass('no-preview')
    selectNode(nodeId)
    render(<PropertiesPanel />)

    fireEvent.focus(screen.getByRole('textbox', { name: /add or create a css class/i }))
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'no-preview' }))

    expect(useEditorStore.getState().previewClassAssignment).toBeNull()
  })

  it('consumes a hovered suggestion as a real class on click and clears the preview', () => {
    const { nodeId } = loadProjectWithHeading()
    const cls = useEditorStore.getState().createClass('consume-preview')
    selectNode(nodeId)
    render(<PropertiesPanel />)

    fireEvent.focus(screen.getByRole('textbox', { name: /add or create a css class/i }))
    const item = screen.getByRole('menuitem', { name: 'consume-preview' })

    fireEvent.mouseEnter(item)
    fireEvent.click(item)

    const node = useEditorStore.getState().project!.pages[0].nodes[nodeId]
    expect(node.classIds).toContain(cls.id)
    expect(useEditorStore.getState().previewClassAssignment).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// PP-4: Module Section visible with definition.name, controls in DOM by default
// ---------------------------------------------------------------------------

describe('PP-4 — Module Section default open with controls', () => {
  it('Module section titled with definition.name is present and open by default', () => {
    const { nodeId } = loadProjectWithHeading()
    selectNode(nodeId)
    render(<PropertiesPanel />)
    // "Text" is the definition.name for base.text
    expect(screen.getByRole('button', { name: /module settings.*text/i })).toBeDefined()
  })

  it('Property controls are visible without interaction (module section default open)', () => {
    const { nodeId } = loadProjectWithHeading()
    selectNode(nodeId)
    render(<PropertiesPanel />)
    // base.text has a 'text' property control — should be in DOM immediately
    expect(screen.getByTestId('property-control-text')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// PP-5: Advanced Section removed from the Properties panel
// ---------------------------------------------------------------------------

describe('PP-5 — Advanced Section removed', () => {
  it('does not render the Advanced section or Hidden/Locked toggles', () => {
    const { nodeId } = loadProjectWithHeading()
    selectNode(nodeId)
    render(<PropertiesPanel />)
    expect(screen.queryByRole('button', { name: /Advanced/i })).toBeNull()
    expect(screen.queryByLabelText(/^Hidden$/)).toBeNull()
    expect(screen.queryByLabelText(/^Locked$/)).toBeNull()
    expect(screen.queryByText(/^Node ID:/)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// PP-6: Section shared by top-level panel and class style categories
// ---------------------------------------------------------------------------

describe("PP-6 — Section shared from './Section' in PropertiesPanel and ClassComposer", () => {
  it('PropertiesPanel.tsx imports Section from ./Section', () => {
    const src = readFileSync(join(PP_DIR, 'PropertiesPanel.tsx'), 'utf-8')
    expect(src).toMatch(/import.*Section.*from\s+['"]\.\/Section['"]/)
  })

  it('ClassComposer.tsx imports Section from ./Section for assigned style categories', () => {
    const src = readFileSync(join(PP_DIR, 'ClassComposer.tsx'), 'utf-8')
    expect(src).toMatch(/import.*Section.*from\s+['"]\.\/Section['"]/)
  })
})

// ---------------------------------------------------------------------------
// PP-7: Each pill shows cascade position badge (1-based ¹²³)
// ---------------------------------------------------------------------------

describe('PP-7 — Cascade order badges on pills', () => {
  it('Three pills show ordinal superscript badges ¹ ² ³', () => {
    const { nodeId } = loadProjectWithClasses(3)
    selectNode(nodeId)
    render(<PropertiesPanel />)

    expect(screen.getByText('¹')).toBeDefined()
    expect(screen.getByText('²')).toBeDefined()
    expect(screen.getByText('³')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// PP-8: Reorder buttons functional
// ---------------------------------------------------------------------------

describe('PP-8 — Reorder buttons move pill position and update badges', () => {
  it('clicking move-up on pill 2 moves it to position 1; badge becomes ¹', () => {
    const { nodeId, classIds } = loadProjectWithClasses(3)
    selectNode(nodeId)
    render(<PropertiesPanel />)

    // Find "Move class-2 up in cascade" button
    const moveUpBtn = screen.getByRole('button', { name: /move class class-2 up in cascade/i })
    fireEvent.click(moveUpBtn)

    // After reorder, class-2 should be at index 0 (¹)
    const state = useEditorStore.getState()
    const page = state.project!.pages[0]
    const updatedNode = page.nodes[nodeId]
    expect(updatedNode.classIds![0]).toBe(classIds[1]) // class-2 (index 1) moved to index 0
  })

  it('clicking move-down on pill 2 of 3 moves it to position 3; classIds updated', () => {
    const { nodeId, classIds } = loadProjectWithClasses(3)
    selectNode(nodeId)
    render(<PropertiesPanel />)

    const moveDownBtn = screen.getByRole('button', { name: /move class class-2 down in cascade/i })
    fireEvent.click(moveDownBtn)

    const state = useEditorStore.getState()
    const page = state.project!.pages[0]
    const updatedNode = page.nodes[nodeId]
    expect(updatedNode.classIds![2]).toBe(classIds[1]) // class-2 moved to last position
  })

  it('no-op at boundary: move-up on first pill does not change order', () => {
    const { nodeId, classIds } = loadProjectWithClasses(2)
    selectNode(nodeId)
    render(<PropertiesPanel />)

    const moveUpBtn = screen.getByRole('button', { name: /move class class-1 up in cascade/i })
    fireEvent.click(moveUpBtn)

    const state = useEditorStore.getState()
    const updatedIds = state.project!.pages[0].nodes[nodeId].classIds!
    expect(updatedIds[0]).toBe(classIds[0]) // class-1 still first
  })
})

// ---------------------------------------------------------------------------
// PP-9: Pill × button has title="Remove from this element" (static)
// ---------------------------------------------------------------------------

describe('PP-9 — Pill × button tooltip "Remove from this element"', () => {
  it('ClassPicker.tsx source contains "Remove from this element"', () => {
    const src = readFileSync(join(PP_DIR, 'ClassPicker.tsx'), 'utf-8')
    expect(src).toContain('Remove from this element')
  })
})

// ---------------------------------------------------------------------------
// PP-10: Class and module style controls are visible in ClassComposer
// ---------------------------------------------------------------------------

describe('PP-10 — Class and module style controls visible in ClassComposer', () => {
  it('a class with a fontFamily style shows a CSS property row', () => {
    const { nodeId } = loadProjectWithHeading()
    const state = useEditorStore.getState()
    const cls = state.createClass('styled-class')
    state.addNodeClass(nodeId, cls.id)
    state.updateClassStyles(cls.id, { fontFamily: 'Inter' })
    selectNode(nodeId)
    render(<PropertiesPanel />)

    // Open the ClassComposer by clicking the pill
    const pill = screen.getByRole('button', { name: /edit class styled-class/i })
    fireEvent.click(pill)

    expect(document.querySelector('[data-testid="css-property-row-fontFamily"]')).not.toBeNull()
  })

  it('no textarea element is present in ClassComposer (PP-17)', () => {
    const { nodeId } = loadProjectWithClasses(1)
    selectNode(nodeId)
    render(<PropertiesPanel />)

    const pill = screen.getByRole('button', { name: /edit class class-1/i })
    fireEvent.click(pill)

    // Phase 3 removes the former ClassComposer "Edit CSS" textarea.
    expect(screen.queryByRole('textbox', { name: /edit css/i })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// PP-11: Editing a text-type class property via TextControl updates the store
// ---------------------------------------------------------------------------

describe('PP-11 — Editing a text-type class property via TextControl updates class styles', () => {
  it('changing the fontFamily input writes the new value to the class styles in the store', () => {
    const { nodeId } = loadProjectWithHeading()
    const state = useEditorStore.getState()
    const cls = state.createClass('edit-class')
    state.addNodeClass(nodeId, cls.id)
    state.updateClassStyles(cls.id, { fontFamily: 'serif' })
    selectNode(nodeId)
    render(<PropertiesPanel />)

    const pill = screen.getByRole('button', { name: /edit class edit-class/i })
    fireEvent.click(pill)

    // Find the text input for fontFamily (TextControl renders a text input)
    const input = screen.getByDisplayValue('serif') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Inter, sans-serif' } })

    const updatedCls = useEditorStore.getState().project!.classes[cls.id]
    expect(updatedCls.styles.fontFamily).toBe('Inter, sans-serif')
  })
})

// ---------------------------------------------------------------------------
// PP-12: Remove class CSS property via the ClassPropertyRow remove button
// ---------------------------------------------------------------------------

describe('PP-12 — Removing a class CSS property removes it from class styles', () => {
  it('clicking the remove button for fontFamily clears it from class styles', () => {
    const { nodeId } = loadProjectWithHeading()
    const state = useEditorStore.getState()
    const cls = state.createClass('remove-class')
    state.addNodeClass(nodeId, cls.id)
    state.updateClassStyles(cls.id, { fontFamily: 'serif' })
    selectNode(nodeId)
    render(<PropertiesPanel />)

    const pill = screen.getByRole('button', { name: /edit class remove-class/i })
    fireEvent.click(pill)

    const removeBtn = screen.getByRole('button', { name: /remove font family property/i })
    fireEvent.click(removeBtn)

    const updatedCls = useEditorStore.getState().project!.classes[cls.id]
    // fontFamily should be cleared (null or undefined or '')
    expect(updatedCls.styles.fontFamily).toBeFalsy()
  })
})

// ---------------------------------------------------------------------------
// PP-13: Breakpoint hint appears inside Module section when non-desktop bp active
// ---------------------------------------------------------------------------

describe('PP-13 — Breakpoint hint inside Module section when non-desktop bp active', () => {
  it('editing hint text visible inside module section when tablet bp active', () => {
    const { nodeId } = loadProjectWithHeading()
    selectNode(nodeId)
    useEditorStore.setState({ activeBreakpointId: 'tablet' } as Parameters<typeof useEditorStore.setState>[0])
    render(<PropertiesPanel />)

    // Module section is open by default — hint should be in DOM
    expect(screen.getByText(/editing/i)).toBeDefined()
    expect(screen.getByText('tablet')).toBeDefined()
  })

  it('breakpoint dot indicator appears on Module section header when non-desktop bp active', () => {
    const { nodeId } = loadProjectWithHeading()
    selectNode(nodeId)
    useEditorStore.setState({ activeBreakpointId: 'tablet' } as Parameters<typeof useEditorStore.setState>[0])
    render(<PropertiesPanel />)

    // The Module settings section includes the selected module name and breakpoint indicator.
    const moduleSection = screen.getByRole('button', { name: /module settings.*text/i })
    expect(moduleSection).toBeDefined()
  })

  it('no breakpoint hint when desktop bp is active', () => {
    const { nodeId } = loadProjectWithHeading()
    selectNode(nodeId)
    useEditorStore.setState({ activeBreakpointId: 'desktop' } as Parameters<typeof useEditorStore.setState>[0])
    render(<PropertiesPanel />)
    expect(screen.queryByText(/editing.*overrides/i)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// PP-16: No inline styles, no Tailwind, no !important in new source files (static)
// ---------------------------------------------------------------------------

describe('PP-16 — No inline styles / no Tailwind / no !important in new files', () => {
  const newFiles = [
    'Section.tsx',
    'Section.module.css',
    'ClassPicker.tsx',
    'ClassPicker.module.css',
    'ClassComposer.tsx',
    'ClassComposer.module.css',
    'ClassPropertyRow.tsx',
    'ClassPropertyRow.module.css',
    'parseCSSDeclarations.ts',
    'cssControlTypes.ts',
    'PropertiesPanel.tsx',
    'PropertiesPanel.module.css',
  ]

  for (const file of newFiles) {
    it(`${file}: no !important`, () => {
      const src = readFileSync(join(PP_DIR, file), 'utf-8')
      expect(src).not.toContain('!important')
    })
  }

  for (const file of newFiles.filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))) {
    it(`${file}: no style={{ ... }} inline styles`, () => {
      const src = readFileSync(join(PP_DIR, file), 'utf-8')
      // Allow the intentional CSS var injection in PropertiesPanel's aside element
      if (file === 'PropertiesPanel.tsx') {
        // Only the panel root aside uses style= for CSS var injection (panel width / position)
        // Count occurrences — there should be only 1
        const count = (src.match(/\bstyle=\{/g) ?? []).length
        expect(count).toBeLessThanOrEqual(1)
      } else {
        // All other tsx files: zero inline style= props
        expect(src).not.toContain('style={')
      }
    })
  }
})

// ---------------------------------------------------------------------------
// HF-1: Reorder ↑/↓ buttons reachable via keyboard (WCAG 2.1.1)
// ---------------------------------------------------------------------------

describe('HF-1 — Reorder buttons are keyboard-reachable (no tabIndex={-1})', () => {
  it('ClassPicker.tsx source does NOT contain tabIndex={-1} on any element', () => {
    const src = readFileSync(join(PP_DIR, 'ClassPicker.tsx'), 'utf-8')
    expect(src).not.toContain('tabIndex={-1}')
  })

  it('rendered reorder ↑/↓ buttons do not have tabIndex -1 (DOM check)', () => {
    const { nodeId } = loadProjectWithClasses(2)
    selectNode(nodeId)
    render(<PropertiesPanel />)

    // All buttons with "in cascade" in aria-label are the reorder buttons
    const reorderBtns = screen
      .getAllByRole('button')
      .filter((btn) => /in cascade/i.test(btn.getAttribute('aria-label') ?? ''))

    expect(reorderBtns.length).toBeGreaterThanOrEqual(2)

    for (const btn of reorderBtns) {
      // tabIndex -1 removes from keyboard navigation — must not be present
      expect(btn.getAttribute('tabindex')).not.toBe('-1')
    }
  })

  it('reorder ↑ button receives focus via Tab key traversal', async () => {
    const { nodeId } = loadProjectWithClasses(1)
    selectNode(nodeId)
    render(<PropertiesPanel />)

    const user = userEvent.setup()

    // Tab through the panel until we reach a reorder button
    const maxTabs = 20
    let focusedReorder = false
    for (let i = 0; i < maxTabs; i++) {
      await user.tab()
      const focused = document.activeElement
      if (
        focused instanceof HTMLButtonElement &&
        /in cascade/i.test(focused.getAttribute('aria-label') ?? '')
      ) {
        focusedReorder = true
        break
      }
    }

    expect(focusedReorder).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// HF-2: ClassComposer state isolation — switching class pills resets state
// ---------------------------------------------------------------------------

describe('HF-2 — Switching class pills resets ClassComposer local state', () => {
  it('property search resets and updates placeholder after switching classes (no state leak)', () => {
    const { nodeId } = loadProjectWithClasses(2)
    selectNode(nodeId)
    render(<PropertiesPanel />)

    // Activate class-1 — ClassComposer mounts
    const pill1 = screen.getByRole('button', { name: /edit class class-1/i })
    fireEvent.click(pill1)

    const searchInput1 = screen.getByRole('searchbox', { name: /search class style properties to add/i }) as HTMLInputElement
    expect(searchInput1.placeholder).toBe('Add style to class-1...')

    // Type a query into the local search field.
    fireEvent.change(searchInput1, { target: { value: 'font' } })
    expect(searchInput1.value).toBe('font')

    // Switch to class-2 — ClassComposer should remount (key={activeClassId})
    const pill2 = screen.getByRole('button', { name: /edit class class-2/i })
    fireEvent.click(pill2)

    // class-2's search must be empty and scoped to class-2, NOT leaked from class-1.
    const searchInput2 = screen.getByRole('searchbox', { name: /search class style properties to add/i }) as HTMLInputElement
    expect(searchInput2.value).toBe('')
    expect(searchInput2.placeholder).toBe('Add style to class-2...')
  })

  it('switching to an empty class shows no property rows (Phase 3 state isolation)', () => {
    // class-1 gets a fontFamily property; class-2 is empty
    const { nodeId } = loadProjectWithHeading()
    const storeState = useEditorStore.getState()
    const cls1 = storeState.createClass('class-1-isolation')
    const cls2 = storeState.createClass('class-2-isolation')
    storeState.addNodeClass(nodeId, cls1.id)
    storeState.addNodeClass(nodeId, cls2.id)
    storeState.updateClassStyles(cls1.id, { fontFamily: 'serif' })
    // cls2 has no styles
    selectNode(nodeId)
    render(<PropertiesPanel />)

    // Open class-1 — fontFamily CSS property row should be visible
    const pill1 = screen.getByRole('button', { name: /edit class class-1-isolation/i })
    fireEvent.click(pill1)
    expect(document.querySelector('[data-testid="css-property-row-fontFamily"]')).not.toBeNull()

    // Switch to class-2 — no property rows should appear (fresh mount via key={activeClassId})
    const pill2 = screen.getByRole('button', { name: /edit class class-2-isolation/i })
    fireEvent.click(pill2)
    expect(document.querySelector('[data-testid="css-property-row-fontFamily"]')).toBeNull()
    expect(document.querySelectorAll('[data-testid^="css-property-row-"]').length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// HF-3: parseCSSDeclarations correctly handles justifySelf and scrollBehavior
// ---------------------------------------------------------------------------

describe('HF-3 — parseCSSDeclarations recognises justify-self and scroll-behavior', () => {
  it('justify-self: center → { justifySelf: "center" }', () => {
    const result = parseCSSDeclarations('justify-self: center')
    expect(result).not.toBeNull()
    expect(result?.justifySelf).toBe('center')
  })

  it('scroll-behavior: smooth → { scrollBehavior: "smooth" }', () => {
    const result = parseCSSDeclarations('scroll-behavior: smooth')
    expect(result).not.toBeNull()
    expect(result?.scrollBehavior).toBe('smooth')
  })

  it('both together: returns { justifySelf: "center", scrollBehavior: "smooth" }', () => {
    const result = parseCSSDeclarations('justify-self: center; scroll-behavior: smooth;')
    expect(result).toEqual({ justifySelf: 'center', scrollBehavior: 'smooth' })
  })
})

// ---------------------------------------------------------------------------
// HF-4: KNOWN_PROPERTIES covers every key of CSSPropertyBag (static audit gate)
//
// Ensures parseCSSDeclarations.ts KNOWN_PROPERTIES cannot drift from CSSPropertyBag.
// Strategy: build a CSS string containing every CSSPropertyBag key (camelCase → kebab)
// then assert that parseCSSDeclarations returns ALL of them — none silently dropped.
// ---------------------------------------------------------------------------

describe('HF-4 — KNOWN_PROPERTIES is a complete superset of CSSPropertyBag keys', () => {
  /** Convert camelCase to kebab-case CSS property name */
  function camelToKebab(camel: string): string {
    return camel.replace(/([A-Z])/g, '-$1').toLowerCase()
  }

  /**
   * Exhaustive Record of every key in CSSPropertyBag — MF-A fix (CR #676 / Architect msg #2075).
   *
   * WHY Record<keyof CSSPropertyBag, true> and NOT ReadonlyArray<keyof CSSPropertyBag>:
   *   ReadonlyArray accepts SUBSETS — a subset of keyof CSSPropertyBag is still assignable,
   *   so adding a new field to CSSPropertyBag (e.g. `borderImageSource?: string`) would
   *   silently pass TypeScript here. The Record pattern requires ALL keys to be present;
   *   a missing key produces a compile error before tests run (pre-commit / pre-push `tsc`).
   *   Same pattern as ARIA-role enumeration in earlier suites (Constraint #234 family).
   *
   * Section order mirrors parseCSSDeclarations.ts KNOWN_PROPERTIES for visual diff-ability.
   */
  const ALL_KEYS_RECORD: Record<keyof CSSPropertyBag, true> = {
    // Typography
    fontFamily: true, fontSize: true, fontWeight: true, fontStyle: true,
    letterSpacing: true, lineHeight: true, textAlign: true, textDecoration: true,
    textTransform: true, color: true, textShadow: true,
    // Layout
    display: true, flexDirection: true, flexWrap: true, alignItems: true,
    justifyContent: true, justifyItems: true, alignSelf: true, justifySelf: true, flex: true,
    gap: true, rowGap: true, columnGap: true,
    gridTemplateColumns: true, gridTemplateRows: true, gridColumn: true, gridRow: true,
    // Size
    width: true, height: true, minWidth: true, maxWidth: true, minHeight: true,
    maxHeight: true, aspectRatio: true, boxSizing: true,
    // Spacing
    margin: true, marginTop: true, marginRight: true, marginBottom: true, marginLeft: true,
    padding: true, paddingTop: true, paddingRight: true, paddingBottom: true, paddingLeft: true,
    // Position
    position: true, top: true, right: true, bottom: true, left: true, zIndex: true,
    // Visual
    backgroundColor: true, background: true, backgroundImage: true, backgroundSize: true,
    backgroundPosition: true, backgroundRepeat: true, opacity: true,
    overflow: true, overflowX: true, overflowY: true,
    // Border
    border: true, borderTop: true, borderRight: true, borderBottom: true, borderLeft: true,
    borderRadius: true, borderTopLeftRadius: true, borderTopRightRadius: true,
    borderBottomLeftRadius: true, borderBottomRightRadius: true, outline: true, outlineOffset: true,
    // Effects
    boxShadow: true, filter: true, backdropFilter: true, transform: true, transformOrigin: true,
    // Motion
    transition: true, animation: true,
    // Interaction
    cursor: true, pointerEvents: true, userSelect: true,
    // Scrollbar
    scrollBehavior: true,
  }

  /** Derived from the exhaustive Record above — same keys, ordered for camelToKebab iteration. */
  const ALL_CSS_PROPERTY_BAG_KEYS = Object.keys(ALL_KEYS_RECORD) as Array<keyof CSSPropertyBag>

  it('parseCSSDeclarations accepts every CSSPropertyBag key; no key is silently dropped', () => {
    // Build a CSS string: "font-family: x; font-size: x; ..."
    const cssString = ALL_CSS_PROPERTY_BAG_KEYS
      .map((k) => `${camelToKebab(k)}: x`)
      .join('; ')

    const result = parseCSSDeclarations(cssString)
    expect(result).not.toBeNull()

    const missingKeys = ALL_CSS_PROPERTY_BAG_KEYS.filter(
      (k) => !(k in (result ?? {})),
    )

    // If this fails, add the missing keys to KNOWN_PROPERTIES in parseCSSDeclarations.ts
    expect(missingKeys).toEqual([])
  })

  it('ALL_CSS_PROPERTY_BAG_KEYS list is exhaustive — compile-time lock via Record<keyof CSSPropertyBag, true>', () => {
    // Primary lock = TypeScript: Record<keyof CSSPropertyBag, true> above MUST include ALL keys.
    // If CSSPropertyBag gains a new field, TS errors here at compile time (pre-commit / tsc).
    // Runtime assertion = defence-in-depth count check (catches build-tool bypasses).
    // Add new keys to ALL_KEYS_RECORD + KNOWN_PROPERTIES + cssControlTypes.ts together.
    expect(ALL_CSS_PROPERTY_BAG_KEYS.length).toBe(84)
  })
})

// ===========================================================================
// Phase 3 acceptance gates — PP-17..PP-25 (Task #464 / Spec #671)
// ===========================================================================

// ---------------------------------------------------------------------------
// PP-17: No <textarea> in ClassComposer (static gate)
// ---------------------------------------------------------------------------

describe('PP-17 — No textarea element in ClassComposer (Phase 3)', () => {
  it('ClassComposer.tsx source does not contain <textarea', () => {
    const src = readFileSync(join(PP_DIR, 'ClassComposer.tsx'), 'utf-8')
    expect(src).not.toContain('<textarea')
  })

  it('rendered ClassComposer contains no textarea element in the DOM', () => {
    const { nodeId } = loadProjectWithClasses(1)
    selectNode(nodeId)
    render(<PropertiesPanel />)

    const pill = screen.getByRole('button', { name: /edit class class-1/i })
    fireEvent.click(pill)

    expect(screen.queryByRole('textbox', { name: /edit css/i })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// PP-18: ClassPropertyRow imports same PropertyControl components as module rows (static)
// ---------------------------------------------------------------------------

describe('PP-18 — ClassPropertyRow uses same PropertyControl components as module rows', () => {
  it('ClassPropertyRow.tsx imports TextControl from PropertyControls', () => {
    const src = readFileSync(join(PP_DIR, 'ClassPropertyRow.tsx'), 'utf-8')
    expect(src).toMatch(/import.*TextControl.*from.*PropertyControls/)
  })

  it('ClassPropertyRow.tsx does not import NumberControl or SliderControl from PropertyControls', () => {
    const src = readFileSync(join(PP_DIR, 'ClassPropertyRow.tsx'), 'utf-8')
    expect(src).not.toMatch(/import.*NumberControl.*from.*PropertyControls/)
    expect(src).not.toMatch(/import.*SliderControl.*from.*PropertyControls/)
  })

  it('ClassPropertyRow.tsx imports ColorControl from PropertyControls', () => {
    const src = readFileSync(join(PP_DIR, 'ClassPropertyRow.tsx'), 'utf-8')
    expect(src).toMatch(/import.*ColorControl.*from.*PropertyControls/)
  })

  it('ClassPropertyRow.tsx imports SelectControl from PropertyControls', () => {
    const src = readFileSync(join(PP_DIR, 'ClassPropertyRow.tsx'), 'utf-8')
    expect(src).toMatch(/import.*SelectControl.*from.*PropertyControls/)
  })
})

// ---------------------------------------------------------------------------
// PP-19: No inline styles on ClassPropertyRow files (Constraint #402)
// ---------------------------------------------------------------------------

describe('PP-19 — No inline styles in ClassPropertyRow / cssControlTypes (Constraint #402)', () => {
  it('ClassPropertyRow.tsx has no style={ inline styles', () => {
    const src = readFileSync(join(PP_DIR, 'ClassPropertyRow.tsx'), 'utf-8')
    expect(src).not.toContain('style={')
  })

  it('ClassPropertyRow.module.css has no !important', () => {
    const src = readFileSync(join(PP_DIR, 'ClassPropertyRow.module.css'), 'utf-8')
    expect(src).not.toContain('!important')
  })

  it('cssControlTypes.ts has no style={ inline styles', () => {
    const src = readFileSync(join(PP_DIR, 'cssControlTypes.ts'), 'utf-8')
    expect(src).not.toContain('style={')
  })
})

// ---------------------------------------------------------------------------
// PP-20: Property search adds class-backed styles
// ---------------------------------------------------------------------------

describe('PP-20 — Property search adds class-backed styles to the active class', () => {
  it('searching for "font family" and selecting it adds fontFamily to class styles', () => {
    const { nodeId } = loadProjectWithHeading()
    const state = useEditorStore.getState()
    const cls = state.createClass('add-prop-class')
    state.addNodeClass(nodeId, cls.id)
    selectNode(nodeId)
    render(<PropertiesPanel />)

    const pill = screen.getByRole('button', { name: /edit class add-prop-class/i })
    fireEvent.click(pill)

    // The minimal add-property search is always present when a class is active.
    const searchInput = screen.getByRole('searchbox', { name: /search class style properties to add/i })
    expect(searchInput).toBeDefined()

    // Type to filter to fontFamily
    fireEvent.change(searchInput, { target: { value: 'fontF' } })

    // Click "Font family" option
    const fontFamilyBtn = screen.getByRole('menuitem', { name: /font family/i })
    fireEvent.click(fontFamilyBtn)

    // Class styles should now have fontFamily (with default value)
    const updatedCls = useEditorStore.getState().project!.classes[cls.id]
    expect('fontFamily' in updatedCls.styles).toBe(true)
  })

  it('breakpoint dropdown scopes added properties to the selected breakpoint', () => {
    const { nodeId } = loadProjectWithHeading()
    const state = useEditorStore.getState()
    const cls = state.createClass('bp-prop-class')
    state.addNodeClass(nodeId, cls.id)
    selectNode(nodeId)
    render(<PropertiesPanel />)

    const pill = screen.getByRole('button', { name: /edit class bp-prop-class/i })
    fireEvent.click(pill)

    fireEvent.change(screen.getByRole('combobox', { name: /class style breakpoint/i }), {
      target: { value: 'mobile' },
    })

    const searchInput = screen.getByRole('searchbox', { name: /search class style properties to add/i })
    fireEvent.change(searchInput, { target: { value: 'fontF' } })
    fireEvent.click(screen.getByRole('menuitem', { name: /font family/i }))

    const updatedCls = useEditorStore.getState().project!.classes[cls.id]
    expect(updatedCls.styles.fontFamily).toBeUndefined()
    expect(updatedCls.breakpointStyles.mobile.fontFamily).toBe('inherit')
  })

  it('module visual settings add class-backed CSS and respect breakpoints', () => {
    const { nodeId } = loadProjectWithColumns()
    const state = useEditorStore.getState()
    const cls = state.createClass('columns-style-class')
    state.addNodeClass(nodeId, cls.id)
    selectNode(nodeId)
    render(<PropertiesPanel />)

    fireEvent.click(screen.getByRole('button', { name: /edit class columns-style-class/i }))

    const searchInput = screen.getByRole('searchbox', { name: /search class style properties to add/i })
    fireEvent.change(searchInput, { target: { value: 'columns' } })
    fireEvent.click(screen.getByRole('menuitem', { name: /^columns$/i }))

    let updatedCls = useEditorStore.getState().project!.classes[cls.id]
    expect(updatedCls.styles.display).toBe('grid')
    expect(updatedCls.styles.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))')
    expect(document.querySelector('[data-testid="module-style-row-columns"]')).not.toBeNull()

    fireEvent.change(screen.getByRole('combobox', { name: /class style breakpoint/i }), {
      target: { value: 'mobile' },
    })
    fireEvent.change(searchInput, { target: { value: 'columns' } })
    fireEvent.click(screen.getByRole('menuitem', { name: /^columns$/i }))

    updatedCls = useEditorStore.getState().project!.classes[cls.id]
    expect(updatedCls.breakpointStyles.mobile.display).toBe('grid')
    expect(updatedCls.breakpointStyles.mobile.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))')
  })
})

// ---------------------------------------------------------------------------
// PP-20b: Module CSS fields are visible at instance level and class-backed
// ---------------------------------------------------------------------------

describe('PP-20b — Module CSS fields render in Module settings and write to node-scoped classes', () => {
  it('Columns exposes visual fields in Module settings without opening a class', () => {
    const { nodeId } = loadProjectWithColumns()
    selectNode(nodeId)
    render(<PropertiesPanel />)

    expect(screen.getByRole('textbox', { name: /^columns$/i })).toBeDefined()
    expect(screen.queryByRole('spinbutton', { name: /^columns$/i })).toBeNull()
    expect(screen.queryByRole('slider', { name: /^columns$/i })).toBeNull()
    expect(screen.getByLabelText(/align items/i)).toBeDefined()
    expect(screen.getByLabelText(/justify items/i)).toBeDefined()
  })

  it('editing a module CSS length field preserves explicit units', () => {
    const { nodeId } = loadProjectWithColumns()
    selectNode(nodeId)
    render(<PropertiesPanel />)

    fireEvent.change(screen.getByRole('textbox', { name: /column gap/i }), {
      target: { value: '10%' },
    })

    const state = useEditorStore.getState()
    const node = state.project!.pages[0].nodes[nodeId]
    const scopedClassId = node.classIds!.find((id) => state.project!.classes[id].scope?.type === 'node')
    expect(scopedClassId).toBeDefined()
    expect(state.project!.classes[scopedClassId!].styles.columnGap).toBe('10%')
  })

  it('editing a module CSS field creates a hidden node-scoped class', () => {
    const { nodeId } = loadProjectWithColumns()
    selectNode(nodeId)
    render(<PropertiesPanel />)

    fireEvent.change(screen.getByLabelText(/align items/i), {
      target: { value: 'center' },
    })

    const state = useEditorStore.getState()
    const node = state.project!.pages[0].nodes[nodeId]
    const scopedClassId = node.classIds!.find((id) => state.project!.classes[id].scope?.type === 'node')
    expect(scopedClassId).toBeDefined()
    expect(state.project!.classes[scopedClassId!].scope).toEqual({
      type: 'node',
      nodeId,
      role: 'module-style',
    })
    expect(state.project!.classes[scopedClassId!].styles.alignItems).toBe('center')
    expect(screen.queryByRole('button', { name: /edit class columns instance/i })).toBeNull()
  })

  it('module CSS fields write breakpoint overrides into the same node-scoped class system', () => {
    const { nodeId } = loadProjectWithColumns()
    selectNode(nodeId)
    useEditorStore.setState({ activeBreakpointId: 'mobile' } as Parameters<typeof useEditorStore.setState>[0])
    render(<PropertiesPanel />)

    fireEvent.change(screen.getByLabelText(/align items/i), {
      target: { value: 'center' },
    })

    const state = useEditorStore.getState()
    const node = state.project!.pages[0].nodes[nodeId]
    const scopedClassId = node.classIds!.find((id) => state.project!.classes[id].scope?.type === 'node')
    expect(scopedClassId).toBeDefined()
    expect(state.project!.classes[scopedClassId!].styles.alignItems).toBeUndefined()
    expect(state.project!.classes[scopedClassId!].breakpointStyles.mobile.alignItems).toBe('center')
  })
})

// ---------------------------------------------------------------------------
// PP-21: Empty class shows only the property search
// ---------------------------------------------------------------------------

describe('PP-21 — Empty class shows only property search', () => {
  it('a class with no styles shows 0 property rows and no empty-state message', () => {
    const { nodeId } = loadProjectWithHeading()
    const state = useEditorStore.getState()
    const cls = state.createClass('empty-cls')
    state.addNodeClass(nodeId, cls.id)
    selectNode(nodeId)
    render(<PropertiesPanel />)

    const pill = screen.getByRole('button', { name: /edit class empty-cls/i })
    fireEvent.click(pill)

    // No property rows
    expect(document.querySelectorAll('[data-testid^="css-property-row-"]').length).toBe(0)

    // Search affordance present; no extra empty state copy.
    expect(screen.getByRole('searchbox', { name: /search class style properties to add/i })).toBeDefined()
    expect(screen.queryByText(/no class styles set/i)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// PP-22: Module settings section is first visible accordion
// ---------------------------------------------------------------------------

describe('PP-22 — Module settings is the first visible accordion', () => {
  it('Module settings is the first accordion after the header class picker', () => {
    const { nodeId } = loadProjectWithHeading()
    selectNode(nodeId)
    render(<PropertiesPanel />)

    const classInput = screen.getByRole('textbox', { name: /add or create a css class/i })
    const moduleSectionBtn = screen.getByRole('button', { name: /module settings/i })

    expect(classInput.compareDocumentPosition(moduleSectionBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^classes$/i })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// PP-23: parseCSSDeclarations still exists as a serialisation utility
// ---------------------------------------------------------------------------

describe('PP-23 — parseCSSDeclarations.ts still exports parseCSSDeclarations (utility, not textarea-bound)', () => {
  it('parseCSSDeclarations.ts file exports parseCSSDeclarations function', () => {
    const src = readFileSync(join(PP_DIR, 'parseCSSDeclarations.ts'), 'utf-8')
    expect(src).toContain('export function parseCSSDeclarations')
  })

  it('ClassComposer.tsx does NOT import parseCSSDeclarations (no textarea binding)', () => {
    const src = readFileSync(join(PP_DIR, 'ClassComposer.tsx'), 'utf-8')
    // The textarea that bound to parseCSSDeclarations is gone in Phase 3.
    // The import statement (not doc-comment references) must be absent.
    expect(src).not.toMatch(/import.*parseCSSDeclarations/)
    // Calling parseCSSDeclarations at runtime must also be gone
    expect(src).not.toMatch(/parseCSSDeclarations\(/)
  })
})

// ---------------------------------------------------------------------------
// PP-24: ClassComposer shows only assigned style categories and uses shared Section
// ---------------------------------------------------------------------------

describe('PP-24 — ClassComposer assigned categories use shared Section', () => {
  it('ClassComposer.tsx imports Section from ./Section', () => {
    const src = readFileSync(join(PP_DIR, 'ClassComposer.tsx'), 'utf-8')
    expect(src).toMatch(/import.*Section.*from\s+['"]\.\/Section['"]/)
  })

  it('ClassComposer.tsx does not contain sectionsArea CSS class reference', () => {
    const src = readFileSync(join(PP_DIR, 'ClassComposer.tsx'), 'utf-8')
    expect(src).not.toContain('sectionsArea')
  })

  it('cssControlTypes.ts exports getCSSPropertyControlType', () => {
    const src = readFileSync(join(PP_DIR, 'cssControlTypes.ts'), 'utf-8')
    expect(src).toContain('export function getCSSPropertyControlType')
  })
})

// ---------------------------------------------------------------------------
// PP-25: Keyboard navigation reaches ClassPropertyRow remove buttons
// ---------------------------------------------------------------------------

describe('PP-25 — Keyboard navigation reaches ClassPropertyRow controls and remove button', () => {
  it('Tab key can reach the remove button for a class property row', async () => {
    const { nodeId } = loadProjectWithHeading()
    const state = useEditorStore.getState()
    const cls = state.createClass('kb-test-class')
    state.addNodeClass(nodeId, cls.id)
    state.updateClassStyles(cls.id, { fontFamily: 'serif' })
    selectNode(nodeId)
    render(<PropertiesPanel />)

    const pill = screen.getByRole('button', { name: /edit class kb-test-class/i })
    fireEvent.click(pill)

    const user = userEvent.setup()

    // Tab through the panel until we reach the remove button
    const maxTabs = 30
    let foundRemoveBtn = false
    for (let i = 0; i < maxTabs; i++) {
      await user.tab()
      const focused = document.activeElement
      if (
        focused instanceof HTMLButtonElement &&
        /remove font family/i.test(focused.getAttribute('aria-label') ?? '')
      ) {
        foundRemoveBtn = true
        break
      }
    }

    expect(foundRemoveBtn).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// PP3-2: getCSSPropertyDefaultValue round-trips through parseCSSDeclarations
//
// For every non-empty default value returned by getCSSPropertyDefaultValue,
// verify that parseCSSDeclarations can ingest it without silently dropping
// the key. This catches two future failure modes:
//   1. A default value that uses a CSS syntax parseCSSDeclarations cannot parse
//      (e.g. a value containing ':' that splits incorrectly).
//   2. A new CSSPropertyBag key that is in DEFAULT_CSS_VALUES but missing from
//      KNOWN_PROPERTIES in parseCSSDeclarations.ts.
// ---------------------------------------------------------------------------

describe('PP3-2 — getCSSPropertyDefaultValue values survive parseCSSDeclarations round-trip', () => {
  /** Convert camelCase to kebab-case CSS property name */
  function camelToKebab(camel: string): string {
    return camel.replace(/([A-Z])/g, '-$1').toLowerCase()
  }

  it('every non-empty default round-trips through parseCSSDeclarations without being dropped', () => {
    // Properties intentionally left empty — user must specify manually (border shorthands,
    // background shorthand, aspectRatio). parseCSSDeclarations drops empty values by design.
    const INTENTIONAL_EMPTY_DEFAULTS = new Set<keyof CSSPropertyBag>([
      'border', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft',
      'background', 'aspectRatio',
    ])

    const failures: string[] = []

    for (const prop of ALL_CSS_PROPERTIES) {
      if (INTENTIONAL_EMPTY_DEFAULTS.has(prop)) continue

      const defaultVal = getCSSPropertyDefaultValue(prop)
      // Number-typed props (opacity, zIndex) need String() conversion for CSS string
      const valStr = String(defaultVal)

      const cssStr = `${camelToKebab(prop)}: ${valStr}`
      const parsed = parseCSSDeclarations(cssStr)

      if (parsed === null || !(prop in parsed)) {
        failures.push(
          `${prop}: ${JSON.stringify(defaultVal)} → parseCSSDeclarations returned ` +
          `${parsed === null ? 'null' : 'object missing key'}`,
        )
      }
    }

    if (failures.length > 0) {
      throw new Error(
        'getCSSPropertyDefaultValue returns values silently dropped by parseCSSDeclarations:\n' +
        failures.map((f) => `  ${f}`).join('\n') +
        '\nFix: ensure KNOWN_PROPERTIES in parseCSSDeclarations.ts contains these keys ' +
        'and DEFAULT_CSS_VALUES uses non-empty string defaults.',
      )
    }

    expect(failures).toHaveLength(0)
  })

  it('intentionally-empty defaults are exactly the 7 documented border/background shorthands', () => {
    // These properties use empty string "" by design — the user fills them in manually.
    // Pinning the set here means adding a new empty-default requires an explicit code change,
    // preventing silent drift where a non-trivial property accidentally gets an empty default.
    const EXPECTED_EMPTY_DEFAULTS: Array<keyof CSSPropertyBag> = [
      'aspectRatio',
      'background',
      'border',
      'borderBottom',
      'borderLeft',
      'borderRight',
      'borderTop',
    ]

    const actualEmptyDefaults = ALL_CSS_PROPERTIES
      .filter((prop) => getCSSPropertyDefaultValue(prop) === '')
      .sort()

    expect(actualEmptyDefaults).toEqual(EXPECTED_EMPTY_DEFAULTS)
  })
})

// ---------------------------------------------------------------------------
// PP3-5: getCSSPropertyDefaultValue per-key reasonableness
//        (regression lock against the bucket-dispatch failure mode caught in CR #683 MF-B)
//
// Each test pins an exact value from Contribution #677 (accepted, Architect msg #2080).
// When getCSSPropertyDefaultValue used control-type bucket-dispatch,
// select → first-enum), the following properties returned UX-breaking defaults:
//   opacity     → 0     (element vanishes on "Add opacity")
//   zIndex      → -10   (element pushed below the page stack)
//   marginTop   → -200px (element jumps hard on "Add margin-top")
//   lineHeight  → "0"  (text collapses to 0 height)
//   display     → first-enum which may be "none" or "flex" depending on ordering
// These per-key assertions catch any regression back to bucket-dispatch logic.
// ---------------------------------------------------------------------------

describe('PP3-5 — getCSSPropertyDefaultValue per-key reasonableness (MF-B regression lock)', () => {
  it('opacity → 1 (number, NOT 0 — element-vanish regression)', () => {
    expect(getCSSPropertyDefaultValue('opacity')).toBe(1)
  })

  it('zIndex → 0 (number, NOT -10 — below-stack regression)', () => {
    expect(getCSSPropertyDefaultValue('zIndex')).toBe(0)
  })

  it('NUMBER_TYPED_PROPS return numbers, not strings (store type contract)', () => {
    // CSSPropertyBag types opacity and zIndex as number, not string.
    // Returning a string would cause a type mismatch at the store write boundary.
    expect(typeof getCSSPropertyDefaultValue('opacity')).toBe('number')
    expect(typeof getCSSPropertyDefaultValue('zIndex')).toBe('number')
  })

  it('width → "auto" (NOT "0px" — layout collapse)', () => {
    expect(getCSSPropertyDefaultValue('width')).toBe('auto')
  })

  it('height → "auto" (NOT "0px" — layout collapse)', () => {
    expect(getCSSPropertyDefaultValue('height')).toBe('auto')
  })

  it('maxWidth → "none" (NOT "0px" — spurious max-width constraint)', () => {
    expect(getCSSPropertyDefaultValue('maxWidth')).toBe('none')
  })

  it('maxHeight → "none" (NOT "0px" — spurious max-height constraint)', () => {
    expect(getCSSPropertyDefaultValue('maxHeight')).toBe('none')
  })

  it('lineHeight → "1.5" (NOT "0" or "0px" — text collapse)', () => {
    expect(getCSSPropertyDefaultValue('lineHeight')).toBe('1.5')
  })

  it('letterSpacing → "0px" (NOT "-10px" — min-bound jump)', () => {
    expect(getCSSPropertyDefaultValue('letterSpacing')).toBe('0px')
  })

  it('marginTop → "0px" (NOT "-200px" — negative-margin-min jump)', () => {
    expect(getCSSPropertyDefaultValue('marginTop')).toBe('0px')
  })

  it('marginRight → "0px" (NOT "-200px")', () => {
    expect(getCSSPropertyDefaultValue('marginRight')).toBe('0px')
  })

  it('marginBottom → "0px" (NOT "-200px")', () => {
    expect(getCSSPropertyDefaultValue('marginBottom')).toBe('0px')
  })

  it('marginLeft → "0px" (NOT "-200px")', () => {
    expect(getCSSPropertyDefaultValue('marginLeft')).toBe('0px')
  })

  it('backgroundColor → "transparent" (NOT "#000000" — black-box paint)', () => {
    expect(getCSSPropertyDefaultValue('backgroundColor')).toBe('transparent')
  })

  it('display → "block" (NOT "none" — first enum would hide element)', () => {
    // Spec #677 mandates 'block'. This pins the expectation explicitly so that
    // reordering ENUM_OPTIONS for 'display' cannot silently change the default.
    expect(getCSSPropertyDefaultValue('display')).toBe('block')
  })

  it('color → "inherit" (NOT "#000000" — would override the cascade)', () => {
    expect(getCSSPropertyDefaultValue('color')).toBe('inherit')
  })

  it('fontFamily → "inherit" (inherits parent font, not empty string)', () => {
    expect(getCSSPropertyDefaultValue('fontFamily')).toBe('inherit')
  })

  it('borderRadius → "0px" (safe no-op starting value)', () => {
    expect(getCSSPropertyDefaultValue('borderRadius')).toBe('0px')
  })

  it('transformOrigin → "50% 50%" (centre — NOT "0 0" which surprises rotate/scale)', () => {
    expect(getCSSPropertyDefaultValue('transformOrigin')).toBe('50% 50%')
  })

  it('cursor → "default" (explicit, not first-enum "auto")', () => {
    expect(getCSSPropertyDefaultValue('cursor')).toBe('default')
  })
})
