/**
 * AdminWorkspace — top-level admin section identifier.
 *
 * Defined here (not in AdminCanvasLayout.tsx) so editor chrome (e.g.
 * Toolbar) can reference the type without creating a cycle through
 * AdminCanvasLayout, which itself imports the editor chrome.
 */
/**
 * `'account'` is the user's own settings page (profile, devices, security,
 * activity). Self-targeted — no capability gate; every authenticated user
 * can access their own. The avatar dropdown in the toolbar is the primary
 * entry point.
 */
export type AdminWorkspace =
  | 'site'
  | 'content'
  | 'data'
  | 'media'
  | 'plugins'
  | 'users'
  | 'pluginPage'
  | 'account'
