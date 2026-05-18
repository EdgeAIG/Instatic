/**
 * EditorPermissionsProvider — JSX wrapper around `EditorPermissionsContext`.
 *
 * Lives in a separate `.tsx` from `editorPermissionsContext.ts` so the file
 * exporting the hook + constants stays component-free. React Fast Refresh
 * fails when a single file mixes component and non-component exports
 * (`react-refresh/only-export-components`), so the project enforces this
 * split convention everywhere.
 */
import type { ReactNode } from 'react'
import {
  EditorPermissionsContext,
  type EditorPermissions,
} from './editorPermissionsContext'

export function EditorPermissionsProvider({
  value,
  children,
}: {
  value: EditorPermissions
  children: ReactNode
}) {
  return (
    <EditorPermissionsContext.Provider value={value}>
      {children}
    </EditorPermissionsContext.Provider>
  )
}
