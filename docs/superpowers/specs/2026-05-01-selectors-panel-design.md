# Selectors Panel Design

## Goal

Add a dedicated left-rail Selectors panel for managing reusable user classes created inside the editor. The panel is a global class manager: it lists, creates, renames, duplicates, deletes, and edits reusable classes without requiring an element to be selected.

The existing Properties panel remains the element-level workflow for assigning, ordering, and removing classes on the selected node.

## Current Context

The editor already has a class system:

- `SiteDocument.classes` is the global class registry.
- `PageNode.classIds` stores ordered class references on nodes.
- Class order matters because later class IDs win in cascade order.
- Canvas rendering resolves class IDs to the stored user-facing class names and forwards them to module root elements.
- `ClassStyleInjector` injects class-name CSS into the editor document.
- Public rendering tree-shakes class CSS to only classes referenced by page nodes.
- `ClassPicker` assigns classes to the selected node in the Properties panel.
- `ClassComposer` edits the active assigned class.
- `isUserVisibleClass` hides node-scoped internal module style classes.

There is no global UI for managing all reusable classes. Store actions for `renameClass` and `deleteClass` exist, but they are not exposed in a dedicated class manager.

## Scope

In scope:

- Add a dedicated Selectors panel to the left rail.
- List only reusable user classes created in the editor.
- Hide internal node-scoped module style layers.
- Create, rename, duplicate, delete, and edit reusable classes.
- Add row right-click context menu with full class actions.
- Reuse the existing class style editing controls.
- Show usage count and compact style metadata for each class.
- Make class registry and class assignment mutations participate in undo/redo.

Out of scope:

- Showing raw CSS text editing.
- Showing or editing internal node-scoped module style layers.
- Building a full usage browser that jumps between every node using a selector.
- Supporting arbitrary CSS selectors beyond named reusable classes.

## Product Model

Selectors are reusable user classes stored in `site.classes` where `isUserVisibleClass(cls)` returns true. The user-facing class name is editable, unique within the site, and emitted as the actual DOM/CSS class name.

The panel must not expose classes with:

```ts
cls.scope?.type === 'node'
```

Those are internal module instance style layers and should remain an implementation detail.

## Panel Placement

Add `Selectors` as a dedicated left rail panel alongside Layers, Site, Media, Dependencies, and AI assistant.

The panel should use the same shell behavior as existing docked left-sidebar panels:

- mounted inside `LeftSidebar`
- opened by a new `PanelRail` item
- uses shared `PanelHeader`
- closes through panel state
- participates in left sidebar resize behavior

Use `PaintBucketIcon` from the existing icon catalog with the rail accent that best matches the current style-related Site Explorer rows. Do not add a new icon source.

## UX Layout

The Selectors panel has one scrollable surface:

1. Header row
   - Title: `Selectors`
   - Create button
   - Close button from `PanelHeader`

2. Search row
   - Search by class name.
   - Search filters only visible reusable classes.

3. Class list
   - Each row shows class name.
   - Usage count, for example `Used 3 times`.
   - Style summary, for example `4 props · 1 breakpoint`.
   - Active row state for the selected class.

4. Selected class detail
   - Opens in the same panel after selecting a class row.
   - Shows class name header with rename affordance.
   - Shows the class-name selector as read-only metadata.
   - Shows usage and style metadata.
   - Reuses `ClassComposer` for base and breakpoint style editing.
   - Does not render `ClassPicker`.

5. Empty state
   - If there are no reusable classes, show a compact empty state and create button.
   - If search has no results, show a search-specific empty state.

## Row Interactions

Clicking a class row selects it and opens the detail editor.

Keyboard behavior:

- `Enter` or `Space`: select row.
- `ContextMenu` key or `Shift+F10`: open row context menu.
- `Escape`: closes any open menu or dialog.

Right-click behavior:

- Right-clicking a row opens a context menu at the pointer position.
- Keyboard context menu opens near the focused row, matching the Site Explorer pattern.
- The menu uses the shared `ContextMenu` and `ContextMenuItem` components.

## Context Menu

Each selector row context menu includes:

- `Edit`
  - Selects the class and focuses the detail editor.

- `Rename`
  - Opens rename UI.
  - Blocks empty names.
  - Blocks duplicate class names.
  - Shows the same duplicate-name message as `classSlice.renameClass`.

- `Duplicate`
  - Creates a new reusable class with copied `styles`, `breakpointStyles`, `description`, and `tags`.
  - Uses a unique name derived from the original, such as `Button copy`, `Button copy 2`.
  - Selects the duplicated class.

- `Apply to selected element`
  - Enabled only when a node is selected and the node does not already include the class.
  - Calls `addNodeClass(selectedNodeId, classId)`.

- `Remove from selected element`
  - Enabled only when a node is selected and the node already includes the class.
  - Calls `removeNodeClass(selectedNodeId, classId)`.

- `Copy selector`
  - Copies the user-facing class-name selector to the clipboard.
  - Uses the same selector that the renderer and publisher emit.

- `Delete`
  - Opens a confirmation dialog.
  - Confirmation states the number of nodes using the class.
  - Confirming calls `deleteClass(classId)`, which removes the class from the registry and from all node `classIds`.

## Create Flow

The create button opens a compact create dialog using the existing editor dialog visual language.

Requirements:

- Name is required.
- Name must be unique among user-visible classes.
- Created class has empty base styles and empty breakpoint styles.
- Created class is selected immediately.
- The detail editor should be ready for adding styles.

The panel should create reusable classes only. It should not create node-scoped module style classes.

## Rename Flow

Rename can be opened from:

- selected class detail header
- row context menu

Requirements:

- Trim whitespace.
- Keep same name without error.
- Block duplicate names.
- Preserve class ID and all assignments.
- After rename, row, detail header, `ClassPicker` pills, and `ClassComposer` placeholder text update from the shared class registry.

## Duplicate Flow

Duplicate should be implemented as an editor action rather than direct object mutation inside the component.

The copied class should:

- get a new ID
- get a unique user-facing name
- copy base styles
- copy breakpoint styles
- copy description and tags if present
- not copy node assignments
- be selected after creation

Add this to `classSlice` as `duplicateClass(classId): CSSClass | null` so the behavior is testable and undoable.

## Delete Flow

Delete is destructive because it removes the class from all nodes. It requires confirmation.

The confirmation dialog should show:

- class name
- class-name selector
- usage count
- clear confirmation action

After deletion:

- class is removed from `site.classes`
- class ID is removed from all page nodes
- active selector selection is cleared or moved to the next available class
- `activeClassId` is cleared if it pointed to the deleted class
- Properties panel class pills update automatically from store state

## Usage Counts

MVP usage count scans all page nodes:

```ts
for each page in site.pages
  for each node in page.nodes
    count classIds containing classId
```

This mirrors the current publisher tree-shaking scope, which only scans pages. Visual component reusable trees are not counted in the MVP because the current publisher collection path is page-oriented.

The panel should show:

- `Unused` when count is zero.
- `Used 1 time` for one assignment.
- `Used N times` for multiple assignments.

## Style Metadata

Each class row should summarize styles:

- base property count: number of set entries in `cls.styles`
- breakpoint count: number of breakpoint style objects with at least one set property

Examples:

- `No styles`
- `3 props`
- `3 props · 1 breakpoint`

This helps users find empty or heavily edited classes without opening each row.

## Class Editor Reuse

`ClassComposer` should be reused rather than building a parallel style editor.

Needed adaptation:

- It must work when there is no selected node and no module definition.
- In global selectors mode, module-specific style bindings are unavailable.
- The property search still lists generic CSS properties.
- The breakpoint picker still works.
- The component should not render `ClassPicker`.

Use an explicit global mode API:

```ts
<ClassComposer
  classId={selectedClass.id}
  cls={selectedClass}
  mode="global"
/>
```

## Undo And Redo

Class mutations currently update the site but do not consistently push undo history. This feature should fix that.

Undoable actions:

- create class
- rename class
- duplicate class
- delete class
- update class base styles
- update class breakpoint styles
- apply class to selected element
- remove class from selected element
- reorder node classes
- create node-scoped module style class when module style fields are changed

Implementation requirement:

- All class mutations that change `site` should snapshot history before mutation.
- No-op guards must remain in place so unchanged writes do not create undo entries.
- Transient UI state such as `activeClassId`, selected selector row, search text, open context menu, and hover previews should not create undo history.

## Store State

Add UI state for the Selectors panel:

```ts
selectorsPanelOpen: boolean
selectedSelectorClassId: string | null
```

Actions:

```ts
setSelectorsPanelOpen(open: boolean): void
setSelectedSelectorClassId(classId: string | null): void
```

`selectedSelectorClassId` is panel-local UI state in the store because left panels already use shared store UI state. It should be kept valid when classes are deleted or the site is loaded.

## File Boundaries

New files:

- `src/editor/components/SelectorsPanel/SelectorsPanel.tsx`
- `src/editor/components/SelectorsPanel/SelectorsPanel.module.css`
- `src/editor/components/SelectorsPanel/index.ts`
- `src/editor/components/SelectorsPanel/selectorUsage.ts`

Modified files:

- `src/editor/components/LeftSidebar/LeftSidebar.tsx`
- `src/editor/components/PanelRail/PanelRail.tsx`
- `src/core/editor-store/slices/uiSlice.ts`
- `src/core/editor-store/slices/classSlice.ts`
- `src/editor/components/PropertiesPanel/ClassComposer.tsx`
- `src/__tests__/editor-store/classSlice.test.ts`
- new or existing panel tests under `src/__tests__/panels/`

`selectorUsage.ts` should be pure and testable. It should not import React.

## Testing

Store tests:

- class create is undoable and redoable
- class rename is undoable and redoable
- class duplicate is undoable and redoable
- class delete is undoable and redoable, including node assignments
- class style edit is undoable and redoable
- add/remove class assignment is undoable and redoable
- no-op class actions do not create undo entries

Panel tests:

- Selectors panel lists only reusable user classes.
- Node-scoped classes do not appear.
- Empty state appears when no reusable classes exist.
- Search filters class rows by name.
- Selecting a row opens detail editor.
- Detail editor does not render `ClassPicker`.
- Context menu opens on right-click.
- Context menu opens from keyboard.
- Rename blocks duplicate class names.
- Duplicate copies styles but not assignments.
- Apply/remove selected element menu items enable and disable correctly.
- Delete confirmation shows usage count and removes the class after confirmation.
- Copy selector writes the class-name selector.

Architecture/static tests:

- `PanelRail` includes a Selectors item.
- `LeftSidebar` mounts `SelectorsPanel`.
- New TSX/CSS files do not use Tailwind utilities, inline styles, or `!important` except approved CSS variable injection patterns already used by shared menu primitives.

Verification commands:

```bash
bun test src/__tests__/editor-store/classSlice.test.ts
bun test src/__tests__/panels/selectorsPanel.test.tsx
bun test src/__tests__/panels/propertiesPanel-redesign.test.tsx
bun run lint
bun run build
```

## Risks

The main UX risk is duplicating responsibilities with the Properties panel. The boundary should stay strict: Selectors edits global class definitions; Properties assigns classes to the selected element.

The main technical risk is history behavior. Class mutations need undo snapshots without creating history entries for transient hover or selection state.

The second technical risk is making `ClassComposer` too coupled to selected-node module context. Global mode should degrade cleanly to generic CSS properties when no module definition is supplied.
