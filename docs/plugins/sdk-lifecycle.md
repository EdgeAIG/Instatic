# Plugin SDK Lifecycle

The v1 plugin package contract is a zip archive with a `plugin.json` manifest and optional JavaScript entrypoints. Backend entrypoints are trusted server-side code loaded from the installed plugin package after the site owner approves the manifest permissions.

Related references:

- `docs/plugins/authoring.md`
- `docs/plugins/permissions.md`
- `examples/plugins/plugin-sdk.d.ts`
- `examples/plugins/template`

## Backend Entrypoint

Set `entrypoints.server` in `plugin.json` to a package-relative JavaScript module path:

```json
{
  "id": "acme.workflow",
  "version": "1.0.0",
  "permissions": ["cms.routes", "cms.storage"],
  "entrypoints": {
    "server": "server/index.js"
  }
}
```

The server module may export any of these lifecycle hooks:

```js
export function install(api) {}
export function activate(api) {}
export function deactivate(api) {}
export function uninstall(api) {}
```

Hooks can be synchronous or async. Install runs once after the package is stored. Activate runs when a plugin is installed or enabled and is where backend routes should be registered. Deactivate runs when a plugin is disabled. Uninstall runs before the plugin row and uploaded package files are removed.

## Backend API

Every hook receives the same `api` object:

```js
api.plugin.id
api.plugin.version
api.plugin.permissions
api.plugin.log('message')

api.cms.routes.get('/status', handler)
api.cms.routes.post('/action', handler)
api.cms.routes.patch('/item', handler)
api.cms.routes.delete('/item', handler)

const collection = api.cms.storage.collection('resource-id')
await collection.list()
await collection.create({ title: 'Draft', status: 'pending' })
await collection.update(recordId, { status: 'approved' })
await collection.delete(recordId)
```

Route handlers are mounted under `/api/cms/plugins/:pluginId/runtime/*` and run behind the admin session check. A plugin must have `cms.routes` granted before registering routes and `cms.storage` granted before using plugin-owned records.

## Lifecycle State

Installed plugins persist `lifecycleStatus` and `lastError`:

- `installed`: package stored, install hook succeeded, activation has not completed.
- `active`: plugin is enabled and activation succeeded.
- `disabled`: plugin is disabled and deactivation succeeded or no deactivation hook exists.
- `error`: a lifecycle hook or server module import failed. `lastError` is shown in the Plugins admin page.

Plugins with lifecycle errors stay installed for diagnostics, but their admin pages are not collected into navigation until activation succeeds again.
