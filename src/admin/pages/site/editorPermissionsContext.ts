/**
 * EditorPermissionsContext — the editor's three site-editing permission flags
 * surfaced as a single React context so every editor surface (canvas, panels,
 * trees, controls) can read them without prop-drilling.
 *
 * Split into a .ts (this file — context + hook) and a sibling .tsx
 * (`EditorPermissionsProvider.tsx`) because React Fast Refresh requires a
 * file to export only components OR only non-components. The `.tsx` provider
 * file is what consumers wrap the editor body in; the hook here is what
 * every other surface reads.
 *
 * `useEditorPermissions()` always returns a value — the default is "full
 * access" so any consumer that renders outside a Provider (legacy callers,
 * Storybook stories, unit tests of leaf components) gets the historical
 * behaviour without needing to wire anything up.
 *
 * The values flow from `AdminCanvasLayout` which computes them from the
 * authenticated user's capabilities (via `src/admin/access.ts`).
 */
import { createContext, useContext } from 'react'

export interface EditorPermissions {
  /** Caller can perform structural edits (DnD, add/remove/move nodes, pages). */
  canEditStructure: boolean
  /** Caller can modify content-typed props on existing nodes. */
  canEditContent: boolean
  /** Caller can modify CSS classes, style overrides, breakpoints, tokens. */
  canEditStyle: boolean
}

/**
 * `canSave` is true when the caller can make at least one kind of change.
 * Use it to gate the Save button.
 */
export function canSaveDraft(permissions: EditorPermissions): boolean {
  return permissions.canEditStructure || permissions.canEditContent || permissions.canEditStyle
}

export const FULL_EDITOR_PERMISSIONS: EditorPermissions = {
  canEditStructure: true,
  canEditContent: true,
  canEditStyle: true,
}

export const EditorPermissionsContext = createContext<EditorPermissions>(FULL_EDITOR_PERMISSIONS)

export function useEditorPermissions(): EditorPermissions {
  return useContext(EditorPermissionsContext)
}
