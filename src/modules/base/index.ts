/**
 * Base module registration — imports all base modules so they self-register
 * with the global registry singleton on import.
 *
 * Imported once inside `src/admin/AdminEntry.tsx` (the lazy admin chunk) so
 * the base modules + their dependencies (publisher, sanitize, page-tree
 * schemas) stay out of the eager entry bundle and don't ship to the login /
 * setup screens. Server uses the same module via `server/cms/publicRenderer.ts`.
 *
 * Order matters only for module IDs that reference each other — keep alphabetical.
 */

// Invisible page root (required — every new page starts with one)
import './root'

// Layout modules
import './container'

// Typography modules
import './text'
import './list'
import './content'

// Media modules
import './image'

// Interactive modules
import './button'
import './link'

// Media modules (extended)
import './video'

// Component system modules
import './slotOutlet'
import './visualComponentRef'
