# Plugin Authoring

Plugins are zip packages that contain a `plugin.json` manifest and optional JavaScript entrypoints. The current SDK is kept inside this repo, but the contract is structured as the future `@cms/plugin-sdk` package.

## Package Shape

```text
plugin.json
server/index.js
admin/dashboard.js
editor/index.js
```

Create a package with:

```bash
cd examples/plugins/template
zip -qr ../template.plugin.zip .
```

Upload the resulting zip from the Plugins admin page.

## Manifest

`plugin.json` declares identity, permissions, resources, admin pages, and entrypoints:

```json
{
  "id": "acme.template",
  "name": "Template Plugin",
  "version": "1.0.0",
  "apiVersion": 1,
  "permissions": ["admin.navigation", "cms.storage", "cms.routes"],
  "entrypoints": {
    "server": "server/index.js",
    "editor": "editor/index.js"
  },
  "resources": [],
  "adminPages": []
}
```

Plugin IDs must be namespaced, such as `acme.workflow`. Versions must be semver-like, such as `1.0.0`.

## Server Entrypoint

Server entrypoints may export lifecycle hooks:

```js
export function install(api) {}
export function activate(api) {}
export function deactivate(api) {}
export function uninstall(api) {}
```

Use `activate` to register backend routes:

```js
export function activate(api) {
  api.cms.routes.get('/status', () => ({ ok: true }))
}
```

Routes are mounted under:

```text
/api/cms/plugins/:pluginId/runtime/*
```

## Plugin Storage

Declare resources in the manifest, then use `cms.storage`:

```js
const items = api.cms.storage.collection('items')
await items.create({ title: 'Draft', status: 'pending' })
const records = await items.list()
```

Server `delete()` returns a boolean. Admin and editor `delete()` resolves when the CMS accepts deletion.

## Admin Apps

Admin app pages use manifest content kind `app` and export `render`:

```js
export async function render({ root, api }) {
  root.textContent = 'Plugin dashboard'
  const status = await api.cms.routes.json('status')
  console.log(status)
}

export function cleanup() {}
```

The host owns the page shell. The plugin owns only the app root passed to `render`.

## Editor Entrypoint

Editor entrypoints export `activate`:

```js
export function activate(api) {
  api.editor.commands.register({
    id: 'plugin.action',
    label: 'Run Action',
    run: () => ({ message: 'Action complete' }),
  })

  api.editor.toolbar.addButton({
    id: 'plugin.action',
    label: 'Action',
    command: 'plugin.action',
  })
}
```

## Type Declarations

Until the SDK is published, use:

```text
examples/plugins/plugin-sdk.d.ts
```

The starter package lives at:

```text
examples/plugins/template
```
