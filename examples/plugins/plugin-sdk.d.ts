export type PluginPermission =
  | 'storage.records'
  | 'cms.storage'
  | 'cms.routes'
  | 'admin.navigation'
  | 'editor.toolbar'
  | 'editor.commands'
  | 'editor.canvas'
  | 'editor.panels'
  | 'editor.store.read'
  | 'editor.store.write'
  | 'modules.register'
  | 'hooks.register'
  | 'unstable.internals'

export interface PluginManifest {
  id: string
  name: string
  version: string
  apiVersion: 1
  description?: string
  permissions: PluginPermission[]
  entrypoints?: {
    server?: string
    editor?: string
    admin?: string
  }
  resources: PluginResource[]
  adminPages: PluginAdminPage[]
}

export interface PluginResource {
  id: string
  title: string
  singularLabel?: string
  pluralLabel?: string
  fields: Array<{
    id: string
    label: string
    type: 'text' | 'longtext' | 'number' | 'date' | 'boolean'
    required?: boolean
  }>
}

export interface PluginAdminPage {
  id: string
  title: string
  navLabel?: string
  icon?: string
  content: PluginPageContent
}

export type PluginPageContent =
  | { kind: 'markdown'; heading?: string; body: string }
  | { kind: 'resource'; heading: string; resource: string }
  | { kind: 'app'; heading: string; entry: string }

export interface PluginRecord {
  id: string
  pluginId: string
  resourceId: string
  data: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

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
      collection: (resourceId: string) => PluginStorageCollection<boolean>
    }
  }
}

export interface ServerPluginRouteContext {
  req: Request
  body: Record<string, unknown>
}

export type ServerPluginRouteHandler = (
  context: ServerPluginRouteContext,
) => unknown | Promise<unknown>

export interface EditorPluginApi {
  editor: {
    commands: {
      register: (command: {
        id: string
        label: string
        run: () => void | { message?: string } | Promise<void | { message?: string }>
      }) => void
    }
    toolbar: {
      addButton: (button: {
        id: string
        label: string
        command: string
      }) => void
    }
    store: {
      read: () => unknown
      transaction: (mutate: (store: unknown) => void) => void
    }
  }
  cms: {
    storage: {
      collection: (resourceId: string) => PluginStorageCollection<void>
    }
  }
}

export interface PluginAdminAppApi {
  cms: {
    routes: {
      fetch: (path: string, init?: RequestInit) => Promise<Response>
      json: <T = unknown>(path: string, init?: RequestInit) => Promise<T>
    }
    storage: {
      collection: (resourceId: string) => PluginStorageCollection<void>
    }
  }
}

export interface PluginAdminAppContext {
  root: HTMLElement
  page: {
    pluginId: string
    pluginName: string
    id: string
    title: string
  }
  api: PluginAdminAppApi
}

export interface PluginStorageCollection<DeleteResult> {
  list: () => Promise<PluginRecord[]>
  create: (data: Record<string, unknown>) => Promise<PluginRecord>
  update: (recordId: string, data: Record<string, unknown>) => Promise<PluginRecord | null>
  delete: (recordId: string) => Promise<DeleteResult>
}

export interface ServerPluginModule {
  install?: (api: ServerPluginApi) => void | Promise<void>
  activate?: (api: ServerPluginApi) => void | Promise<void>
  deactivate?: (api: ServerPluginApi) => void | Promise<void>
  uninstall?: (api: ServerPluginApi) => void | Promise<void>
}

export interface EditorPluginModule {
  activate: (api: EditorPluginApi) => void | Promise<void>
}

export interface PluginAdminAppModule {
  render: (context: PluginAdminAppContext) => void | Promise<void>
  cleanup?: (context: PluginAdminAppContext) => void | Promise<void>
}
