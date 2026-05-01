import { useEditorStore } from '../editor-store/store'
import {
  createCmsPluginResourceRecord,
  deleteCmsPluginResourceRecord,
  listCmsPluginResourceRecords,
  updateCmsPluginResourceRecord,
} from '../persistence/cmsPluginRecords'
import type {
  EditorPluginApi,
  EditorPluginModule,
  PluginCommand,
  PluginCommandResult,
  PluginManifest,
  PluginToolbarButton,
  RegisteredPluginToolbarButton,
} from '../plugin-sdk'
import { assertPluginPermission } from '../plugin-sdk'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type RuntimeListener = () => void

class PluginRuntime {
  private commands = new Map<string, PluginCommand & { pluginId: string }>()
  private toolbarButtons = new Map<string, RegisteredPluginToolbarButton>()
  private listeners = new Set<RuntimeListener>()

  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  reset(): void {
    this.commands.clear()
    this.toolbarButtons.clear()
    this.emit()
  }

  registerCommand(pluginId: string, command: PluginCommand): void {
    this.commands.set(command.id, { ...command, pluginId })
    this.emit()
  }

  registerToolbarButton(pluginId: string, button: PluginToolbarButton): void {
    this.toolbarButtons.set(button.id, { ...button, pluginId })
    this.emit()
  }

  getToolbarButtons(): RegisteredPluginToolbarButton[] {
    return [...this.toolbarButtons.values()]
  }

  async runCommand(commandId: string): Promise<PluginCommandResult> {
    const command = this.commands.get(commandId)
    if (!command) throw new Error(`Plugin command "${commandId}" is not registered`)
    return await command.run()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

export const pluginRuntime = new PluginRuntime()

function createEditorPluginApi(
  manifest: PluginManifest,
  fetchImpl: FetchLike,
): EditorPluginApi {
  return {
    editor: {
      commands: {
        register(command) {
          assertPluginPermission(manifest, 'editor.commands')
          pluginRuntime.registerCommand(manifest.id, command)
        },
      },
      toolbar: {
        addButton(button) {
          assertPluginPermission(manifest, 'editor.toolbar')
          pluginRuntime.registerToolbarButton(manifest.id, button)
        },
      },
      store: {
        read() {
          assertPluginPermission(manifest, 'editor.store.read')
          return useEditorStore.getState()
        },
        transaction(mutate) {
          assertPluginPermission(manifest, 'editor.store.write')
          useEditorStore.setState((state) => {
            mutate(state)
          })
        },
      },
    },
    cms: {
      storage: {
        collection(resourceId) {
          assertPluginPermission(manifest, 'cms.storage')
          return {
            list: () => listCmsPluginResourceRecords(manifest.id, resourceId, fetchImpl),
            create: (data) => createCmsPluginResourceRecord(manifest.id, resourceId, data, fetchImpl),
            update: (recordId, data) => updateCmsPluginResourceRecord(manifest.id, resourceId, recordId, data, fetchImpl),
            delete: (recordId) => deleteCmsPluginResourceRecord(manifest.id, resourceId, recordId, fetchImpl),
          }
        },
      },
    },
  }
}

export async function activateEditorPlugin(
  manifest: PluginManifest,
  mod: EditorPluginModule,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<void> {
  await mod.activate(createEditorPluginApi(manifest, fetchImpl))
}
