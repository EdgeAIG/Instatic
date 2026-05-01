# Public Plugin SDK and Capability Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the plugin platform for growth by turning the current internal plugin APIs into a stable internal-public SDK contract with a central capability matrix, reusable permission guards, authoring docs, and plugin templates.

**Architecture:** Keep the SDK inside this repo for now under `src/core/plugin-sdk`, but design it as the future `@cms/plugin-sdk` package boundary. Existing runtime files continue to power installed plugins, while the SDK package becomes the single source for public types, permission metadata, host-side permission guards, and author-facing examples. Runtime modules expose runtime functions only; shared plugin contracts are imported from the SDK boundary.

**Tech Stack:** Bun, TypeScript, React admin, existing CMS plugin runtime, existing zip plugin package format, existing permission approval UI.

---

## Current Status

**Finished before this plan:**
- JSON and zip plugin install.
- Permission approval before install.
- Installed plugin admin page with enable, disable, remove.
- Plugin admin navigation pages.
- Plugin-owned CMS records.
- Backend runtime routes.
- Server lifecycle hooks: `install`, `activate`, `deactivate`, `uninstall`.
- Lifecycle status and error diagnostics.
- Workflow Tools example plugin with admin UI, editor toolbar command, backend routes, storage, and lifecycle hooks.

**Half finished and strengthened by this plan:**
- Permission model.
- Public SDK contract.
- SDK documentation.
- Example plugin authoring path.
- Agent-friendly plugin generation surface.

**Explicitly not built by this plan:**
- Marketplace or community registry.
- Plugin updates and dependency resolution.
- Cryptographic package signing.
- Sandboxed backend execution.
- Plugin-owned database migrations.
- Full CMS hook/filter system.
- Agent implementation that writes plugins automatically.

---

## File Structure

Create:
- `src/core/plugin-sdk/types.ts`: public SDK type contract for manifests, permissions, lifecycle hooks, plugin APIs, commands, toolbar buttons, resources, records, and installed plugin state.
- `src/core/plugin-sdk/capabilities.ts`: central permission and capability registry used by manifest parsing, install UI, docs, and runtime guards.
- `src/core/plugin-sdk/guards.ts`: host-side helpers for checking and asserting granted permissions.
- `src/core/plugin-sdk/index.ts`: public SDK barrel export.
- `src/__tests__/plugin-sdk/capabilities.test.ts`: capability registry behavior.
- `src/__tests__/plugin-sdk/publicSdkExports.test.ts`: export boundary checks.
- `examples/plugins/plugin-sdk.d.ts`: checked-in type declarations plugin authors and agents can copy or reference before this is published.
- `examples/plugins/template/plugin.json`: minimal package manifest template.
- `examples/plugins/template/server/index.js`: server lifecycle template.
- `examples/plugins/template/admin/dashboard.js`: admin app template.
- `examples/plugins/template/editor/index.js`: editor entrypoint template.
- `docs/plugins/authoring.md`: how to build and package a plugin.
- `docs/plugins/permissions.md`: permission model and capability matrix.

Modify:
- `src/core/extensions/manifest.ts`: use the central capability registry for permission validation and labels.
- `src/core/extensions/runtime.ts`: import SDK types and permission guards.
- `src/core/extensions/adminRuntime.ts`: import SDK types and centralize runtime route/storage API names.
- `src/core/extensions/editorPluginLoader.ts`: skip plugins in lifecycle error state.
- `server/cms/serverPluginRuntime.ts`: import SDK types and permission guards.
- `server/cms/handlers.ts`: keep install permission checks routed through the SDK capability helpers.
- `src/plugins/PluginsAdmin.tsx`: display permission descriptions from the capability registry.
- `examples/plugins/workflow-tools/*`: align example code with the public SDK names and docs.
- `docs/plugins/sdk-lifecycle.md`: link lifecycle docs to the broader authoring and permissions docs.

---

### Task 1: Create the SDK Type Boundary

**Files:**
- Create: `src/core/plugin-sdk/types.ts`
- Create: `src/core/plugin-sdk/index.ts`
- Modify: all existing plugin type imports to use `src/core/plugin-sdk` or `@core/plugin-sdk`
- Test: `src/__tests__/plugin-sdk/publicSdkExports.test.ts`

- [ ] **Step 1: Write the export boundary test**

Create `src/__tests__/plugin-sdk/publicSdkExports.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import * as sdk from '../../core/plugin-sdk'

describe('public plugin SDK exports', () => {
  it('exports stable runtime constants and helper functions', () => {
    expect(sdk.PLUGIN_API_VERSION).toBe(1)
    expect(typeof sdk.permissionLabel).toBe('function')
    expect(typeof sdk.assertPluginPermission).toBe('function')
  })

  it('exports lifecycle hook names in execution order', () => {
    expect(sdk.SERVER_PLUGIN_LIFECYCLE_HOOKS).toEqual([
      'install',
      'activate',
      'deactivate',
      'uninstall',
    ])
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
bun test src/__tests__/plugin-sdk/publicSdkExports.test.ts
```

Expected: fail because `src/core/plugin-sdk` does not exist.

- [ ] **Step 3: Create SDK types**

Create `src/core/plugin-sdk/types.ts` as the single public plugin type contract. Include these exports:

```ts
export const PLUGIN_API_VERSION = 1
export type PluginApiVersion = typeof PLUGIN_API_VERSION

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

export type ServerPluginLifecycleHook = 'install' | 'activate' | 'deactivate' | 'uninstall'

export const SERVER_PLUGIN_LIFECYCLE_HOOKS: ServerPluginLifecycleHook[] = [
  'install',
  'activate',
  'deactivate',
  'uninstall',
]
```

Keep the existing interfaces for `PluginManifest`, `InstalledPlugin`, `PluginRecord`, `PluginResource`, `PluginAdminPage`, `PluginPageContent`, editor command types, admin app context types, and server API types in this SDK file.

- [ ] **Step 4: Create the SDK barrel**

Create `src/core/plugin-sdk/index.ts`:

```ts
export * from './types'
export * from './capabilities'
export * from './guards'
```

- [ ] **Step 5: Move all plugin type imports to the SDK boundary**

Delete the previous plugin type module and update every plugin type import to read from `src/core/plugin-sdk` or `@core/plugin-sdk`. Runtime modules should expose runtime functions only.

- [ ] **Step 6: Run the focused test**

Run:

```bash
bun test src/__tests__/plugin-sdk/publicSdkExports.test.ts
```

Expected: still fail because `capabilities` and `guards` are not implemented yet.

---

### Task 2: Add the Central Capability Matrix

**Files:**
- Create: `src/core/plugin-sdk/capabilities.ts`
- Modify: `src/core/extensions/manifest.ts`
- Test: `src/__tests__/plugin-sdk/capabilities.test.ts`
- Test: `src/__tests__/extensions/pluginManifest.test.ts`

- [ ] **Step 1: Write capability tests**

Create `src/__tests__/plugin-sdk/capabilities.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import {
  PLUGIN_CAPABILITIES,
  isPluginPermission,
  permissionDescription,
  permissionLabel,
  permissionsForSurface,
} from '../../core/plugin-sdk'

describe('plugin capability registry', () => {
  it('contains author-facing metadata for every permission', () => {
    for (const capability of PLUGIN_CAPABILITIES) {
      expect(capability.permission).toBeString()
      expect(capability.label.length).toBeGreaterThan(0)
      expect(capability.description.length).toBeGreaterThan(0)
      expect(['low', 'medium', 'high', 'dangerous']).toContain(capability.risk)
      expect(capability.surfaces.length).toBeGreaterThan(0)
    }
  })

  it('looks up labels and descriptions by permission', () => {
    expect(permissionLabel('cms.routes')).toBe('Register backend CMS routes')
    expect(permissionDescription('cms.routes')).toContain('backend')
  })

  it('validates known permissions and rejects unknown values', () => {
    expect(isPluginPermission('cms.storage')).toBe(true)
    expect(isPluginPermission('cms.database.drop')).toBe(false)
  })

  it('lists permissions by surface', () => {
    expect(permissionsForSurface('server')).toContain('cms.routes')
    expect(permissionsForSurface('editor')).toContain('editor.toolbar')
    expect(permissionsForSurface('admin')).toContain('admin.navigation')
  })
})
```

- [ ] **Step 2: Run the capability test and verify it fails**

Run:

```bash
bun test src/__tests__/plugin-sdk/capabilities.test.ts
```

Expected: fail because `capabilities.ts` is missing.

- [ ] **Step 3: Implement the capability registry**

Create `src/core/plugin-sdk/capabilities.ts`:

```ts
import type { PluginPermission } from './types'

export type PluginCapabilitySurface = 'manifest' | 'admin' | 'editor' | 'server' | 'cms'
export type PluginCapabilityRisk = 'low' | 'medium' | 'high' | 'dangerous'

export interface PluginCapability {
  permission: PluginPermission
  label: string
  description: string
  risk: PluginCapabilityRisk
  surfaces: PluginCapabilitySurface[]
}

export const PLUGIN_CAPABILITIES: PluginCapability[] = [
  {
    permission: 'admin.navigation',
    label: 'Add pages to the admin navigation',
    description: 'Allows the plugin to add pages to the CMS admin sidebar and plugin page router.',
    risk: 'low',
    surfaces: ['manifest', 'admin'],
  },
  {
    permission: 'cms.storage',
    label: 'Read and write plugin backend storage',
    description: 'Allows the plugin to read and write records in resources declared by its manifest.',
    risk: 'medium',
    surfaces: ['admin', 'editor', 'server', 'cms'],
  },
  {
    permission: 'cms.routes',
    label: 'Register backend CMS routes',
    description: 'Allows the plugin server entrypoint to register authenticated backend routes.',
    risk: 'high',
    surfaces: ['server', 'cms'],
  },
  {
    permission: 'editor.toolbar',
    label: 'Add controls to the editor toolbar',
    description: 'Allows the plugin editor entrypoint to add toolbar buttons.',
    risk: 'medium',
    surfaces: ['editor'],
  },
  {
    permission: 'editor.commands',
    label: 'Register editor commands',
    description: 'Allows the plugin editor entrypoint to register commands that can be invoked by editor UI.',
    risk: 'medium',
    surfaces: ['editor'],
  },
  {
    permission: 'editor.store.read',
    label: 'Read editor state',
    description: 'Allows the plugin to inspect the current editor store state.',
    risk: 'medium',
    surfaces: ['editor'],
  },
  {
    permission: 'editor.store.write',
    label: 'Modify editor state',
    description: 'Allows the plugin to mutate editor store state through a host transaction.',
    risk: 'high',
    surfaces: ['editor'],
  },
  {
    permission: 'editor.canvas',
    label: 'Read and modify the editor canvas',
    description: 'Reserved for canvas-level plugin APIs.',
    risk: 'high',
    surfaces: ['editor'],
  },
  {
    permission: 'editor.panels',
    label: 'Add editor panels',
    description: 'Reserved for plugins that add panels to the editor workspace.',
    risk: 'medium',
    surfaces: ['editor'],
  },
  {
    permission: 'modules.register',
    label: 'Register page builder modules',
    description: 'Reserved for plugin-provided page builder modules.',
    risk: 'medium',
    surfaces: ['editor', 'manifest'],
  },
  {
    permission: 'hooks.register',
    label: 'Register CMS hooks and filters',
    description: 'Reserved for future CMS hook and filter APIs.',
    risk: 'high',
    surfaces: ['server', 'cms'],
  },
  {
    permission: 'storage.records',
    label: 'Store plugin-owned records',
    description: 'Compatibility alias for plugin-owned storage. Prefer cms.storage for new plugins.',
    risk: 'medium',
    surfaces: ['admin', 'editor', 'server', 'cms'],
  },
  {
    permission: 'unstable.internals',
    label: 'Use unstable internal APIs',
    description: 'Reserved for trusted first-party plugins that need unstable host internals.',
    risk: 'dangerous',
    surfaces: ['admin', 'editor', 'server', 'cms'],
  },
]

const capabilityByPermission = new Map(
  PLUGIN_CAPABILITIES.map((capability) => [capability.permission, capability]),
)

export function isPluginPermission(value: unknown): value is PluginPermission {
  return typeof value === 'string' && capabilityByPermission.has(value as PluginPermission)
}

export function permissionLabel(permission: PluginPermission): string {
  return capabilityByPermission.get(permission)?.label ?? permission
}

export function permissionDescription(permission: PluginPermission): string {
  return capabilityByPermission.get(permission)?.description ?? ''
}

export function permissionsForSurface(surface: PluginCapabilitySurface): PluginPermission[] {
  return PLUGIN_CAPABILITIES
    .filter((capability) => capability.surfaces.includes(surface))
    .map((capability) => capability.permission)
}
```

- [ ] **Step 4: Update manifest parsing to use the registry**

In `src/core/extensions/manifest.ts`:
- Import `isPluginPermission`, `permissionLabel`, and `PLUGIN_CAPABILITIES` from `../plugin-sdk`.
- Build the `z.enum` permission list from `PLUGIN_CAPABILITIES.map((capability) => capability.permission)` with the current explicit tuple kept as the TypeScript fallback if needed.
- Remove the local `PLUGIN_PERMISSION_LABELS` map.
- Keep exporting `permissionLabel` from this module as a compatibility export.

- [ ] **Step 5: Run focused tests**

Run:

```bash
bun test src/__tests__/plugin-sdk/capabilities.test.ts src/__tests__/extensions/pluginManifest.test.ts
```

Expected: pass.

---

### Task 3: Add Shared Permission Guards

**Files:**
- Create: `src/core/plugin-sdk/guards.ts`
- Modify: `src/core/extensions/runtime.ts`
- Modify: `server/cms/serverPluginRuntime.ts`
- Test: `src/__tests__/server/pluginServerRuntime.test.ts`
- Test: `src/__tests__/plugins/pluginToolbarRuntime.test.tsx`

- [ ] **Step 1: Add guard tests to existing runtime tests**

In `src/__tests__/server/pluginServerRuntime.test.ts`, add:

```ts
it('uses the shared permission guard error format', async () => {
  await expect(activateServerPlugin({
    ...workflowManifest,
    grantedPermissions: [],
  }, {
    activate(api) {
      api.cms.routes.get('/blocked', () => ({ ok: true }))
    },
  }, new RuntimeFakeDb())).rejects.toThrow('Plugin "acme.workflow" requires permission "cms.routes"')
})
```

- [ ] **Step 2: Create shared guards**

Create `src/core/plugin-sdk/guards.ts`:

```ts
import type { PluginManifest, PluginPermission } from './types'

export function hasPluginPermission(
  manifest: Pick<PluginManifest, 'grantedPermissions'>,
  permission: PluginPermission,
): boolean {
  return new Set(manifest.grantedPermissions ?? []).has(permission)
}

export function assertPluginPermission(
  manifest: Pick<PluginManifest, 'id' | 'grantedPermissions'>,
  permission: PluginPermission,
): void {
  if (!hasPluginPermission(manifest, permission)) {
    throw new Error(`Plugin "${manifest.id}" requires permission "${permission}"`)
  }
}
```

- [ ] **Step 3: Replace duplicated guards**

In `src/core/extensions/runtime.ts` and `server/cms/serverPluginRuntime.ts`:
- Remove local `requirePermission`.
- Import `assertPluginPermission` from `../plugin-sdk` or `../../src/core/plugin-sdk`.
- Replace calls with `assertPluginPermission(manifest, 'cms.routes')`, `assertPluginPermission(manifest, 'cms.storage')`, and editor permission equivalents.

- [ ] **Step 4: Run focused runtime tests**

Run:

```bash
bun test src/__tests__/server/pluginServerRuntime.test.ts src/__tests__/plugins/pluginToolbarRuntime.test.tsx
```

Expected: pass.

---

### Task 4: Make Lifecycle Error State a First-Class Loader Boundary

**Files:**
- Modify: `src/core/extensions/editorPluginLoader.ts`
- Modify: `src/core/extensions/manifest.ts`
- Test: `src/__tests__/extensions/editorPluginLoader.test.ts`
- Test: `src/__tests__/extensions/pluginManifest.test.ts`

- [ ] **Step 1: Add editor loader regression test**

In `src/__tests__/extensions/editorPluginLoader.test.ts`, add a test that returns one enabled plugin with `lifecycleStatus: 'error'` and an editor entrypoint. Assert that the import function is not called and `activated` remains empty.

- [ ] **Step 2: Update the loader**

In `src/core/extensions/editorPluginLoader.ts`, change the activation filter:

```ts
if (
  !plugin.enabled ||
  plugin.lifecycleStatus === 'error' ||
  !manifest.assetBasePath ||
  !manifest.entrypoints?.editor
) {
  continue
}
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
bun test src/__tests__/extensions/editorPluginLoader.test.ts src/__tests__/extensions/pluginManifest.test.ts
```

Expected: pass.

---

### Task 5: Improve Install Permission Review with Capability Details

**Files:**
- Modify: `src/plugins/PluginsAdmin.tsx`
- Modify: `src/plugins/PluginsAdmin.module.css`
- Test: `src/__tests__/plugins/pluginsAdmin.test.tsx`

- [ ] **Step 1: Add admin UI test**

In `src/__tests__/plugins/pluginsAdmin.test.tsx`, extend the privileged plugin approval test:

```ts
expect(screen.getByText('Allows the plugin server entrypoint to register authenticated backend routes.')).toBeDefined()
```

- [ ] **Step 2: Render permission descriptions**

In `src/plugins/PluginsAdmin.tsx`, import `permissionDescription` from `@core/plugin-sdk` and render each permission approval item as:

```tsx
<li key={permission}>
  <strong>{permissionLabel(permission)}</strong>
  <span>{permissionDescription(permission)}</span>
</li>
```

- [ ] **Step 3: Style the two-line permission item**

In `src/plugins/PluginsAdmin.module.css`, add:

```css
.permissionReview li {
    display: grid;
    gap: 3px;
}

.permissionReview li span {
    color: var(--editor-text-muted);
    font-size: 11px;
    font-weight: 600;
    line-height: 1.4;
}
```

- [ ] **Step 4: Run the admin test**

Run:

```bash
bun test src/__tests__/plugins/pluginsAdmin.test.tsx
```

Expected: pass.

---

### Task 6: Add Plugin Author Type Declarations and Template

**Files:**
- Create: `examples/plugins/plugin-sdk.d.ts`
- Create: `examples/plugins/template/plugin.json`
- Create: `examples/plugins/template/server/index.js`
- Create: `examples/plugins/template/admin/dashboard.js`
- Create: `examples/plugins/template/editor/index.js`
- Test: `src/__tests__/plugins/pluginTemplateExample.test.ts`

- [ ] **Step 1: Add template test**

Create `src/__tests__/plugins/pluginTemplateExample.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { parsePluginManifest } from '../../core/extensions/manifest'

describe('plugin author template', () => {
  it('ships a valid plugin manifest template', async () => {
    const manifest = parsePluginManifest(JSON.parse(
      await readFile('examples/plugins/template/plugin.json', 'utf-8'),
    ))
    expect(manifest.id).toBe('acme.template')
    expect(manifest.entrypoints?.server).toBe('server/index.js')
    expect(manifest.entrypoints?.editor).toBe('editor/index.js')
  })

  it('ships SDK declaration examples for all runtime surfaces', async () => {
    const declarations = await readFile('examples/plugins/plugin-sdk.d.ts', 'utf-8')
    expect(declarations).toContain('interface ServerPluginApi')
    expect(declarations).toContain('interface EditorPluginApi')
    expect(declarations).toContain('interface PluginAdminAppApi')
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
bun test src/__tests__/plugins/pluginTemplateExample.test.ts
```

Expected: fail because template files do not exist.

- [ ] **Step 3: Create `examples/plugins/plugin-sdk.d.ts`**

Write declarations that mirror `src/core/plugin-sdk/types.ts` for plugin authors. Include:
- `PluginManifest`
- `PluginPermission`
- `PluginRecord`
- `ServerPluginApi`
- `EditorPluginApi`
- `PluginAdminAppApi`
- `PluginAdminAppContext`

- [ ] **Step 4: Create package template files**

Create `examples/plugins/template/plugin.json`:

```json
{
  "id": "acme.template",
  "name": "Template Plugin",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "Starter plugin showing admin, editor, backend, and lifecycle APIs.",
  "permissions": [
    "admin.navigation",
    "cms.storage",
    "cms.routes",
    "editor.toolbar",
    "editor.commands"
  ],
  "entrypoints": {
    "server": "server/index.js",
    "editor": "editor/index.js"
  },
  "resources": [
    {
      "id": "items",
      "title": "Items",
      "fields": [
        { "id": "title", "label": "Title", "type": "text", "required": true },
        { "id": "status", "label": "Status", "type": "text" }
      ]
    }
  ],
  "adminPages": [
    {
      "id": "dashboard",
      "title": "Template",
      "navLabel": "Template",
      "content": {
        "kind": "app",
        "heading": "Template Plugin",
        "entry": "admin/dashboard.js"
      }
    }
  ]
}
```

Create minimal JS files:
- `server/index.js`: exports all lifecycle hooks, registers `GET /status`, uses `api.cms.storage.collection('items')`.
- `admin/dashboard.js`: exports `render({ root, api })`, fetches route JSON and lists storage records.
- `editor/index.js`: exports `activate(api)`, registers one command and one toolbar button.

- [ ] **Step 5: Run the template test**

Run:

```bash
bun test src/__tests__/plugins/pluginTemplateExample.test.ts
```

Expected: pass.

---

### Task 7: Documentation Pass

**Files:**
- Create: `docs/plugins/authoring.md`
- Create: `docs/plugins/permissions.md`
- Modify: `docs/plugins/sdk-lifecycle.md`

- [ ] **Step 1: Write `docs/plugins/permissions.md`**

Document:
- Permission approval model.
- Risk levels.
- Capability matrix grouped by `admin`, `editor`, `server`, and `cms`.
- Rule: no API surface should exist without a matching permission.

- [ ] **Step 2: Write `docs/plugins/authoring.md`**

Document:
- Package zip shape.
- `plugin.json` manifest fields.
- Entrypoints.
- Lifecycle hook behavior.
- Admin app `render` and `cleanup`.
- Editor `activate`.
- Backend route registration.
- Storage resources.
- Local test command:

```bash
cd examples/plugins/template
zip -qr ../template.plugin.zip .
```

- [ ] **Step 3: Update lifecycle docs**

In `docs/plugins/sdk-lifecycle.md`, add links to:
- `docs/plugins/authoring.md`
- `docs/plugins/permissions.md`
- `examples/plugins/plugin-sdk.d.ts`
- `examples/plugins/template`

---

### Task 8: Verification

**Files:**
- No source changes.

- [ ] **Step 1: Run focused plugin SDK tests**

Run:

```bash
bun test src/__tests__/plugin-sdk src/__tests__/extensions/pluginManifest.test.ts src/__tests__/extensions/editorPluginLoader.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run focused plugin runtime tests**

Run:

```bash
bun test src/__tests__/server/pluginServerRuntime.test.ts src/__tests__/server/cmsPlugins.test.ts src/__tests__/plugins/pluginsAdmin.test.tsx src/__tests__/plugins/workflowToolsExample.test.ts src/__tests__/plugins/pluginTemplateExample.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Run production build**

Run:

```bash
bun run build
```

Expected: exit code 0. Existing Vite chunk-size warning may remain.

- [ ] **Step 4: Run full test suite**

Run:

```bash
bun test
```

Expected: all tests pass.

---

## Recommended Execution Order

1. SDK type boundary.
2. Capability matrix.
3. Shared permission guards.
4. Lifecycle error loader boundary.
5. Permission approval UI details.
6. Template and declarations.
7. Docs.
8. Full verification.

This order keeps the public contract stable before touching runtime behavior, then uses that contract to tighten server, editor, admin, and docs.
