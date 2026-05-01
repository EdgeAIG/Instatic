# Plugin SDK Lifecycle Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal, typed Plugin SDK lifecycle foundation for install, activate, deactivate, and uninstall hooks.

**Architecture:** Keep the SDK contract inside the repo for now. Server plugins continue exporting JavaScript modules, but may now export lifecycle hooks; the CMS handler invokes those hooks at package install, enable/disable, and removal boundaries while persisting lifecycle status and last error for admin diagnostics.

**Tech Stack:** Bun, TypeScript, React admin, Postgres-compatible SQL, existing CMS plugin runtime.

---

### Task 1: Persist Lifecycle Status

**Files:**
- Modify: `src/core/plugin-sdk/types.ts`
- Modify: `server/cms/migrations.ts`
- Modify: `server/cms/pluginRepository.ts`
- Test: `src/__tests__/server/cmsPlugins.test.ts`

- [ ] Add `PluginLifecycleStatus = 'installed' | 'active' | 'disabled' | 'error'`.
- [ ] Add `lifecycleStatus` and `lastError` to `InstalledPlugin`.
- [ ] Add migration columns `lifecycle_status text not null default 'installed'` and `last_error text`.
- [ ] Map the new columns in repository reads and writes.
- [ ] Add repository helpers to update lifecycle status and error.

### Task 2: Server SDK Lifecycle API

**Files:**
- Modify: `server/cms/serverPluginRuntime.ts`
- Test: `src/__tests__/server/pluginServerRuntime.test.ts`

- [ ] Define server module lifecycle hooks: `install`, `activate`, `deactivate`, `uninstall`.
- [ ] Expose `api.plugin.id`, `api.plugin.version`, `api.plugin.permissions`, and `api.plugin.log`.
- [ ] Keep permission enforcement on `cms.routes` and `cms.storage`.
- [ ] Add a helper to load a packaged server plugin module from its asset path.
- [ ] Add a helper to invoke a named lifecycle hook when present.

### Task 3: Handler Lifecycle Boundaries

**Files:**
- Modify: `server/cms/handlers.ts`
- Modify: `server/cms/pluginRepository.ts`
- Test: `src/__tests__/server/cmsPlugins.test.ts`

- [ ] On package install, write files, persist plugin, run `install`, run `activate`, then refresh runtime routes.
- [ ] On enable, run `activate` and set status `active`.
- [ ] On disable, run `deactivate` and set status `disabled`.
- [ ] On delete, run `uninstall`, then remove the plugin row and files.
- [ ] If a lifecycle hook throws, persist `lifecycleStatus: 'error'` and `lastError`.

### Task 4: Admin Diagnostics

**Files:**
- Modify: `src/plugins/PluginsAdmin.tsx`
- Test: `src/__tests__/plugins/pluginsAdmin.test.tsx`

- [ ] Show lifecycle status on plugin cards.
- [ ] Show last lifecycle error when present.
- [ ] Keep enable/disable/remove behavior unchanged from the user perspective.

### Task 5: Example Plugin

**Files:**
- Modify: `examples/plugins/workflow-tools/server/index.js`
- Update: `examples/plugins/workflow-tools.plugin.zip`
- Test: `src/__tests__/plugins/workflowToolsExample.test.ts`

- [ ] Add lifecycle hooks to the Workflow Tools server entrypoint.
- [ ] Use `api.plugin.log` inside hooks to demonstrate diagnostics-safe SDK usage.
- [ ] Rebuild the example zip and sync the installed upload copy.

### Verification

- [ ] `bun test src/__tests__/server/pluginServerRuntime.test.ts src/__tests__/server/cmsPlugins.test.ts src/__tests__/plugins/pluginsAdmin.test.tsx src/__tests__/plugins/workflowToolsExample.test.ts`
- [ ] `bun test`
- [ ] `bun run build`
