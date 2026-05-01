# Selectors Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated left-rail Selectors panel for reusable editor-created classes and make class mutations undoable.

**Architecture:** Reuse the existing global class registry in `site.classes`, filter with `isUserVisibleClass`, and keep element assignment in the Properties panel. Add a focused `SelectorsPanel` that reuses `ClassComposer` in global mode, and update `classSlice` so all site-changing class mutations push undo history before mutation.

**Tech Stack:** React 19, Zustand with Immer, Bun test, CSS Modules, existing editor UI primitives.

---

### Task 1: Undoable Class Store Mutations

**Files:**
- Modify: `src/core/editor-store/slices/classSlice.ts`
- Test: `src/__tests__/editor-store/classSlice.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that assert `createClass`, `renameClass`, `duplicateClass`, `deleteClass`, `updateClassStyles`, `setClassBreakpointStyles`, `addNodeClass`, and `removeNodeClass` can be undone and redone. Add no-op tests for same-name rename, empty style patch, and removing an unassigned class.

```ts
it('createClass is undoable and redoable', () => {
  setupSite()
  const cls = getStore().createClass('undoable')
  expect(useEditorStore.getState().site!.classes[cls.id]).toBeDefined()
  useEditorStore.getState().undo()
  expect(useEditorStore.getState().site!.classes[cls.id]).toBeUndefined()
  useEditorStore.getState().redo()
  expect(useEditorStore.getState().site!.classes[cls.id]).toBeDefined()
})
```

- [ ] **Step 2: Run red tests**

Run: `bun test src/__tests__/editor-store/classSlice.test.ts`

Expected: FAIL because class mutations currently do not enter undo history and `duplicateClass` does not exist.

- [ ] **Step 3: Implement store changes**

Add `duplicateClass(classId: string): CSSClass | null`, unique copy-name generation, clone helpers, no-op guards, `get().pushHistory()` before every class mutation that changes `site`, and `state.hasUnsavedChanges = true` inside those mutations.

- [ ] **Step 4: Run green tests**

Run: `bun test src/__tests__/editor-store/classSlice.test.ts`

Expected: PASS.

### Task 2: Selectors Panel Usage Helpers

**Files:**
- Create: `src/editor/components/SelectorsPanel/selectorUsage.ts`
- Test: `src/__tests__/panels/selectorsPanel.test.tsx`

- [ ] **Step 1: Write failing usage tests**

Add tests for reusable-class filtering, page-node usage counts, and style summary labels.

```ts
expect(getSelectorUsage(site, 'hero')).toBe(2)
expect(formatSelectorUsage(0)).toBe('Unused')
expect(getSelectorStyleSummary(cls)).toBe('3 props · 1 breakpoint')
```

- [ ] **Step 2: Run red tests**

Run: `bun test src/__tests__/panels/selectorsPanel.test.tsx`

Expected: FAIL because the helper and panel test file do not exist yet.

- [ ] **Step 3: Implement helper**

Create pure helper functions:

```ts
export function getReusableClasses(classes: Record<string, CSSClass>): CSSClass[]
export function getSelectorUsage(site: SiteDocument | null, classId: string): number
export function formatSelectorUsage(count: number): string
export function getSelectorStyleSummary(cls: CSSClass): string
```

- [ ] **Step 4: Run green helper tests**

Run: `bun test src/__tests__/panels/selectorsPanel.test.tsx`

Expected: helper tests PASS; component tests added later may still fail until Task 3.

### Task 3: Left Rail UI State And Panel Wiring

**Files:**
- Modify: `src/core/editor-store/slices/uiSlice.ts`
- Modify: `src/editor/components/PanelRail/PanelRail.tsx`
- Modify: `src/editor/components/LeftSidebar/LeftSidebar.tsx`
- Create: `src/editor/components/SelectorsPanel/index.ts`

- [ ] **Step 1: Write failing panel wiring tests**

Add tests or static assertions that `LeftSidebarPanelId` supports `selectors`, `PanelRail` renders a selectors button, and `LeftSidebar` mounts `SelectorsPanel`.

- [ ] **Step 2: Run red tests**

Run: `bun test src/__tests__/panels/selectorsPanel.test.tsx`

Expected: FAIL because UI state and panel wiring are absent.

- [ ] **Step 3: Implement UI state**

Add:

```ts
selectorsPanelOpen: boolean
selectedSelectorClassId: string | null
setSelectorsPanelOpen(open: boolean): void
setSelectedSelectorClassId(classId: string | null): void
```

Extend `LeftSidebarPanelId`, `getActiveLeftSidebarPanel`, `setLeftSidebarPanel`, `toggleLeftSidebarPanel`, `PanelRail`, and `LeftSidebar`.

- [ ] **Step 4: Run green wiring tests**

Run: `bun test src/__tests__/panels/selectorsPanel.test.tsx`

Expected: PASS for wiring tests.

### Task 4: Selectors Panel Component

**Files:**
- Create: `src/editor/components/SelectorsPanel/SelectorsPanel.tsx`
- Create: `src/editor/components/SelectorsPanel/SelectorsPanel.module.css`
- Modify: `src/editor/components/PropertiesPanel/ClassComposer.tsx`
- Test: `src/__tests__/panels/selectorsPanel.test.tsx`

- [ ] **Step 1: Write failing component tests**

Add tests for:

- listing only reusable classes
- hiding node-scoped classes
- empty state
- search filtering
- selecting a row opens detail editor
- detail editor has class style search and no `ClassPicker`
- right-click context menu
- keyboard context menu
- duplicate copies styles but not assignments
- apply/remove selected element
- delete confirmation

- [ ] **Step 2: Run red tests**

Run: `bun test src/__tests__/panels/selectorsPanel.test.tsx`

Expected: FAIL because the component is absent or incomplete.

- [ ] **Step 3: Implement component**

Build `SelectorsPanel` with shared `PanelHeader`, `Button`, `Input`, `SearchBar`, `ContextMenu`, and `ClassComposer mode="global"`. Use CSS Modules only.

- [ ] **Step 4: Run green component tests**

Run: `bun test src/__tests__/panels/selectorsPanel.test.tsx`

Expected: PASS.

### Task 5: Regression Verification

**Files:**
- Test only

- [ ] **Step 1: Run class store tests**

Run: `bun test src/__tests__/editor-store/classSlice.test.ts`

Expected: PASS.

- [ ] **Step 2: Run selectors panel tests**

Run: `bun test src/__tests__/panels/selectorsPanel.test.tsx`

Expected: PASS.

- [ ] **Step 3: Run properties panel regression tests**

Run: `bun test src/__tests__/panels/propertiesPanel-redesign.test.tsx`

Expected: PASS.

- [ ] **Step 4: Run build verification**

Run: `bun run build`

Expected: PASS.
