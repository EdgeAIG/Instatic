/**
 * Base module registration — imports all base modules so they self-register
 * with the global registry singleton on import.
 *
 * Import this file once in src/app/main.tsx before the app mounts.
 * Order matters only for module IDs that reference each other — keep alphabetical.
 */

// Invisible page root (required — every new page starts with one)
import './root'

// Layout modules
import './container'
import './spacer'
import './divider'

// Typography modules
import './text'
import './list'

// Media modules
import './image'

// Interactive modules
import './button'
import './link'

// Media modules (extended)
import './video'

// Grid/column layout
import './columns'
