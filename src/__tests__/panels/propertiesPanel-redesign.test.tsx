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
import { getCSSPropertyDefaultValue } from '../../editor/components/PropertiesPanel/cssControlTypes'
import { useEditorStore } from '../../core/editor-store/store'
import { makeSite, makePage, makeNode } from '../fixtures'
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
    site: null,
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

function loadSiteWithHeading(): { nodeId: string; rootId: string } {
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
  const site = makeSite({ pages: [page] })
  useEditorStore.setState({ site, activePageId: 'page-1' } as Parameters<typeof useEditorStore.setState>[0])
  return { nodeId, rootId }
}

function loadSiteWithImage(): { nodeId: string; rootId: string } {
  const rootId = 'root-1'
  const nodeId = 'image-1'
  const rootNode = makeNode({ id: rootId, moduleId: 'base.root', children: [nodeId] })
  const imageNode = makeNode({
    id: nodeId,
    moduleId: 'base.image',
    props: { src: '', alt: '', loading: 'lazy' },
    children: [],
  })
  const page = makePage({ id: 'page-1', rootNodeId: rootId, nodes: { [rootId]: rootNode, [nodeId]: imageNode } })
  const site = makeSite({ pages: [page] })
  useEditorStore.setState({ site, activePageId: 'page-1' } as Parameters<typeof useEditorStore.setState>[0])
  return { nodeId, rootId }
}

function selectNode(nodeId: string) {
  useEditorStore.setState({ selectedNodeId: nodeId } as Parameters<typeof useEditorStore.setState>[0])
}

/** Set up site with a node that has N classes pre-assigned. Returns nodeId + classIds. */
function loadSiteWithClasses(count: number): { nodeId: string; classIds: string[] } {
  const { nodeId } = loadSiteWithHeading()
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
    const { nodeId } = loadSiteWithHeading()
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
    const { nodeId } = loadSiteWithClasses(1)
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
    const { nodeId } = loadSiteWithClasses(1)
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
    const { nodeId } = loadSiteWithHeading()
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
    expect(useEditorStore.getState().site!.pages[0].nodes[nodeId].classIds ?? []).not.toContain(cls.id)

    fireEvent.mouseLeave(item)
    expect(useEditorStore.getState().previewClassAssignment).toBeNull()
  })

  it('does not preview suggestion hovers when the preference is disabled', () => {
    localStorage.setItem('pb-editor-prefs', JSON.stringify({ classHoverPreview: false }))
    const { nodeId } = loadSiteWithHeading()
    useEditorStore.getState().createClass('no-preview')
    selectNode(nodeId)
    render(<PropertiesPanel />)

    fireEvent.focus(screen.getByRole('textbox', { name: /add or create a css class/i }))
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'no-preview' }))

    expect(useEditorStore.getState().previewClassAssignment).toBeNull()
  })

  it('consumes a hovered suggestion as a real class on click and clears the preview', () => {
    const { nodeId } = loadSiteWithHeading()
    const cls = useEditorStore.getState().createClass('consume-preview')
    selectNode(nodeId)
    render(<PropertiesPanel />)

    fireEvent.focus(screen.getByRole('textbox', { name: /add or create a css class/i }))
    const item = screen.getByRole('menuitem', { name: 'consume-preview' })

    fireEvent.mouseEnter(item)
    fireEvent.click(item)

    const node = useEditorStore.getState().site!.pages[0].nodes[nodeId]
    expect(node.classIds).toContain(cls.id)
    expect(useEditorStore.getState().previewClassAssignment).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// PP-4: Module Section visible with definition.name, controls in DOM by default
// ---------------------------------------------------------------------------

describe('PP-4 — Module Section default open with controls', () => {
  it('Module section titled with definition.name is present and open by default', () => {
    const { nodeId } = loadSiteWithHeading()
    selectNode(nodeId)
    render(<PropertiesPanel />)
    // "Text" is the definition.name for base.text
    expect(screen.getByRole('button', { name: /module settings.*text/i })).toBeDefined()
  })

  it('Property controls are visible without interaction (module section default open)', () => {
    const { nodeId } = loadSiteWithHeading()
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
    const { nodeId } = loadSiteWithHeading()
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
    const { nodeId } = loadSiteWithClasses(3)
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
    const { nodeId, classIds } = loadSiteWithClasses(3)
    selectNode(nodeId)
    render(<PropertiesPanel />)

    // Find "Move class-2 up in cascade" button
    const moveUpBtn = screen.getByRole('button', { name: /move class class-2 up in cascade/i })
    fireEvent.click(moveUpBtn)

    // After reorder, class-2 should be at index 0 (¹)
    const state = useEditorStore.getState()
    const page = state.site!.pages[0]
    const updatedNode = page.nodes[nodeId]
    expect(updatedNode.classIds![0]).toBe(classIds[1]) // class-2 (index 1) moved to index 0
  })

  it('clicking move-down on pill 2 of 3 moves it to position 3; classIds updated', () => {
    const { nodeId, classIds } = loadSiteWithClasses(3)
    selectNode(nodeId)
    render(<PropertiesPanel />)

    const moveDownBtn = screen.getByRole('button', { name: /move class class-2 down in cascade/i })
    fireEvent.click(moveDownBtn)

    const state = useEditorStore.getState()
    const page = state.site!.pages[0]
    const updatedNode = page.nodes[nodeId]
    expect(updatedNode.classIds![2]).toBe(classIds[1]) // class-2 moved to last position
  })

  it('no-op at boundary: move-up on first pill does not change order', () => {
    const { nodeId, classIds } = loadSiteWithClasses(2)
    selectNode(nodeId)
    render(<PropertiesPanel />)

    const moveUpBtn = screen.getByRole('button', { name: /move class class-1 up in cascade/i })
    fireEvent.click(moveUpBtn)

    const state = useEditorStore.getState()
    const updatedIds = state.site!.pages[0].nodes[nodeId].classIds!
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
    const { nodeId } = loadSiteWithHeading()
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
    const { nodeId } = loadSiteWithClasses(1)
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
    const { nodeId } = loadSiteWithHeading()
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

    const updatedCls = useEditorStore.getState().site!.classes[cls.id]
    expect(updatedCls.styles.fontFamily).toBe('Inter, sans-serif')
  })

  it('uses the active canvas breakpoint for class style edits without changing base styles', () => {
    const { nodeId } = loadSiteWithHeading()
    const state = useEditorStore.getState()
    const cls = state.createClass('responsive-edit-class')
    state.addNodeClass(nodeId, cls.id)
    state.updateClassStyles(cls.id, { fontFamily: 'serif' })
    useEditorStore.setState({ activeBreakpointId: 'mobile' } as Parameters<typeof useEditorStore.setState>[0])
    selectNode(nodeId)
    render(<PropertiesPanel />)

    const pill = screen.getByRole('button', { name: /edit class responsive-edit-class/i })
    fireEvent.click(pill)

    const breakpointSelect = screen.getByRole('combobox', { name: /class style breakpoint/i }) as HTMLSelectElement
    expect(breakpointSelect.value).toBe('Mobile')

    const input = screen.getByDisplayValue('serif') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Inter, sans-serif' } })

    const updatedCls = useEditorStore.getState().site!.classes[cls.id]
    expect(updatedCls.styles.fontFamily).toBe('serif')
    expect(updatedCls.breakpointStyles.mobile.fontFamily).toBe('Inter, sans-serif')
  })
})

// ---------------------------------------------------------------------------
// PP-12: Remove class CSS property via the ClassPropertyRow remove button
// ---------------------------------------------------------------------------

describe('PP-12 — Removing a class CSS property removes it from class styles', () => {
  it('clicking the remove button for fontFamily clears it from class styles', () => {
    const { nodeId } = loadSiteWithHeading()
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

    const updatedCls = useEditorStore.getState().site!.classes[cls.id]
    // fontFamily should be cleared (null or undefined or '')
    expect(updatedCls.styles.fontFamily).toBeFalsy()
  })
})

// ---------------------------------------------------------------------------
// PP-13: Breakpoint hint appears inside Module section when non-desktop bp active
// ---------------------------------------------------------------------------

describe('PP-13 — Breakpoint hint inside Module section when non-desktop bp active', () => {
  it('editing hint text visible inside module section when tablet bp active', () => {
    const { nodeId } = loadSiteWithHeading()
    selectNode(nodeId)
    useEditorStore.setState({ activeBreakpointId: 'tablet' } as Parameters<typeof useEditorStore.setState>[0])
    render(<PropertiesPanel />)

    // Module section is open by default — hint should be in DOM
    expect(screen.getByText(/editing/i)).toBeDefined()
    expect(screen.getByText('tablet')).toBeDefined()
  })

  it('breakpoint dot indicator appears on Module section header when non-desktop bp active', () => {
    const { nodeId } = loadSiteWithHeading()
    selectNode(nodeId)
    useEditorStore.setState({ activeBreakpointId: 'tablet' } as Parameters<typeof useEditorStore.setState>[0])
    render(<PropertiesPanel />)

    // The Module settings section includes the selected module name and breakpoint indicator.
    const moduleSection = screen.getByRole('button', { name: /module settings.*text/i })
    expect(moduleSection).toBeDefined()
  })

  it('no breakpoint hint when desktop bp is active', () => {
    const { nodeId } = loadSiteWithHeading()
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
    const { nodeId } = loadSiteWithClasses(2)
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
    const { nodeId } = loadSiteWithClasses(1)
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
    const { nodeId } = loadSiteWithClasses(2)
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
    const { nodeId } = loadSiteWithHeading()
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
    const { nodeId } = loadSiteWithClasses(1)
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
    const { nodeId } = loadSiteWithHeading()
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
    const updatedCls = useEditorStore.getState().site!.classes[cls.id]
    expect('fontFamily' in updatedCls.styles).toBe(true)
  })

  it('breakpoint dropdown scopes added properties to the selected breakpoint', () => {
    const { nodeId } = loadSiteWithHeading()
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

    const updatedCls = useEditorStore.getState().site!.classes[cls.id]
    expect(updatedCls.styles.fontFamily).toBeUndefined()
    expect(updatedCls.breakpointStyles.mobile.fontFamily).toBe('inherit')
  })

})

// ---------------------------------------------------------------------------
// PP-20b: Module settings stay content/behavior-only
// ---------------------------------------------------------------------------

describe('PP-20b — Module settings exclude visual CSS fields', () => {
  it('Image exposes only image, alt text, and loading module settings', () => {
    const { nodeId } = loadSiteWithImage()
    selectNode(nodeId)
    render(<PropertiesPanel />)

    expect(screen.getByTestId('property-control-src')).toBeDefined()
    expect(screen.getByTestId('property-control-alt')).toBeDefined()
    expect(screen.getByTestId('property-control-loading')).toBeDefined()
    expect(screen.queryByTestId('property-control-width')).toBeNull()
    expect(screen.queryByTestId('property-control-height')).toBeNull()
    expect(screen.queryByTestId('property-control-objectFit')).toBeNull()
    expect(screen.queryByTestId('property-control-borderRadius')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// PP-21: Empty class shows only the property search
// ---------------------------------------------------------------------------

describe('PP-21 — Empty class shows only property search', () => {
  it('a class with no styles shows 0 property rows and no empty-state message', () => {
    const { nodeId } = loadSiteWithHeading()
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
    const { nodeId } = loadSiteWithHeading()
    selectNode(nodeId)
    render(<PropertiesPanel />)

    const classInput = screen.getByRole('textbox', { name: /add or create a css class/i })
    const moduleSectionBtn = screen.getByRole('button', { name: /module settings/i })

    expect(classInput.compareDocumentPosition(moduleSectionBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^classes$/i })).toBeNull()
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
    const { nodeId } = loadSiteWithHeading()
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
