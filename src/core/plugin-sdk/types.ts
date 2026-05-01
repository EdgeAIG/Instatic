import type { EditorStore } from '../editor-store/store'

export const PLUGIN_API_VERSION = 1
export type PluginApiVersion = typeof PLUGIN_API_VERSION

export const PLUGIN_PERMISSION_VALUES = [
  'storage.records',
  'cms.storage',
  'cms.routes',
  'admin.navigation',
  'editor.toolbar',
  'editor.commands',
  'editor.canvas',
  'editor.panels',
  'editor.store.read',
  'editor.store.write',
  'modules.register',
  'hooks.register',
  'unstable.internals',
] as const

export type PluginPermission = typeof PLUGIN_PERMISSION_VALUES[number]

export type ServerPluginLifecycleHook = 'install' | 'activate' | 'deactivate' | 'uninstall'

export const SERVER_PLUGIN_LIFECYCLE_HOOKS: ServerPluginLifecycleHook[] = [
  'install',
  'activate',
  'deactivate',
  'uninstall',
]

export interface PluginPin {
  label: string
  detail?: string
  x: number
  y: number
}

export interface PluginEntrypoints {
  server?: string
  editor?: string
  admin?: string
}

export type PluginResourceFieldType = 'text' | 'longtext' | 'number' | 'date' | 'boolean'

export interface PluginResourceField {
  id: string
  label: string
  type: PluginResourceFieldType
  required?: boolean
}

export interface PluginResource {
  id: string
  title: string
  singularLabel?: string
  pluralLabel?: string
  fields: PluginResourceField[]
}

export interface PluginRecord {
  id: string
  pluginId: string
  resourceId: string
  data: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type PluginLifecycleStatus = 'installed' | 'active' | 'disabled' | 'error'

export type PluginPageContent =
  | {
    kind: 'markdown'
    heading?: string
    body: string
  }
  | {
    kind: 'map'
    heading: string
    body?: string
    centerLabel?: string
    pins: PluginPin[]
  }
  | {
    kind: 'resource'
    heading: string
    resource: string
  }
  | {
    kind: 'app'
    heading: string
    entry: string
    assetPath?: string
  }

export interface PluginAdminPage {
  id: string
  title: string
  navLabel?: string
  icon?: string
  route: string
  content: PluginPageContent
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  apiVersion: PluginApiVersion
  description?: string
  permissions: PluginPermission[]
  grantedPermissions?: PluginPermission[]
  entrypoints?: PluginEntrypoints
  assetBasePath?: string
  resources: PluginResource[]
  adminPages: PluginAdminPage[]
}

export interface InstalledPlugin {
  id: string
  name: string
  version: string
  enabled: boolean
  lifecycleStatus: PluginLifecycleStatus
  lastError: string | null
  grantedPermissions: PluginPermission[]
  manifest: PluginManifest
  installedAt: string
  updatedAt: string
}

export interface PluginAdminPageRoute extends PluginAdminPage {
  pluginId: string
  pluginName: string
}

export interface CmsPluginsPayload {
  plugins: InstalledPlugin[]
  adminPages: PluginAdminPageRoute[]
}

export type PluginCommandResult = void | {
  message?: string
}

export interface PluginCommand {
  id: string
  label: string
  run: () => PluginCommandResult | Promise<PluginCommandResult>
}

export interface PluginToolbarButton {
  id: string
  label: string
  command: string
}

export interface RegisteredPluginToolbarButton extends PluginToolbarButton {
  pluginId: string
}

export interface EditorPluginApi {
  editor: {
    commands: {
      register: (command: PluginCommand) => void
    }
    toolbar: {
      addButton: (button: PluginToolbarButton) => void
    }
    store: {
      read: () => EditorStore
      transaction: (mutate: (store: EditorStore) => void) => void
    }
  }
  cms: {
    storage: {
      collection: (resourceId: string) => {
        list: () => Promise<PluginRecord[]>
        create: (data: Record<string, unknown>) => Promise<PluginRecord>
        update: (recordId: string, data: Record<string, unknown>) => Promise<PluginRecord>
        delete: (recordId: string) => Promise<void>
      }
    }
  }
}

export interface EditorPluginModule {
  activate: (api: EditorPluginApi) => void | Promise<void>
}

export interface PluginAdminAppApi {
  cms: {
    routes: {
      fetch: (path: string, init?: RequestInit) => Promise<Response>
      json: <T = unknown>(path: string, init?: RequestInit) => Promise<T>
    }
    storage: {
      collection: (resourceId: string) => {
        list: () => Promise<PluginRecord[]>
        create: (data: Record<string, unknown>) => Promise<PluginRecord>
        update: (recordId: string, data: Record<string, unknown>) => Promise<PluginRecord>
        delete: (recordId: string) => Promise<void>
      }
    }
  }
}

export interface PluginAdminAppContext {
  root: HTMLElement
  page: PluginAdminPageRoute
  api: PluginAdminAppApi
}

export interface PluginAdminAppModule {
  render: (context: PluginAdminAppContext) => void | Promise<void>
  cleanup?: (context: PluginAdminAppContext) => void | Promise<void>
}

export type RouteMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export interface ServerPluginRouteContext {
  req: Request
  db: unknown
  body: Record<string, unknown>
}

export type ServerPluginRouteHandler = (
  context: ServerPluginRouteContext,
) => unknown | Promise<unknown>

export interface ServerPluginApi {
  plugin: {
    id: string
    version: string
    permissions: PluginPermission[]
    log: (...args: unknown[]) => void
  }
  cms: {
    routes: {
      get: (path: string, handler: ServerPluginRouteHandler) => void
      post: (path: string, handler: ServerPluginRouteHandler) => void
      patch: (path: string, handler: ServerPluginRouteHandler) => void
      delete: (path: string, handler: ServerPluginRouteHandler) => void
    }
    storage: {
      collection: (resourceId: string) => {
        list: () => Promise<PluginRecord[]>
        create: (data: Record<string, unknown>) => Promise<PluginRecord>
        update: (recordId: string, data: Record<string, unknown>) => Promise<PluginRecord | null>
        delete: (recordId: string) => Promise<boolean>
      }
    }
  }
}

export interface ServerPluginModule {
  install?: (api: ServerPluginApi) => void | Promise<void>
  activate?: (api: ServerPluginApi) => void | Promise<void>
  deactivate?: (api: ServerPluginApi) => void | Promise<void>
  uninstall?: (api: ServerPluginApi) => void | Promise<void>
}
