# Plugin Permissions

Plugins declare requested permissions in `plugin.json`. The CMS shows those permissions before installation and stores the owner-approved grants with the installed plugin. Runtime APIs must check granted permissions before exposing host capabilities.

## Permission Model

- `permissions` in `plugin.json` is the plugin request.
- `grantedPermissions` is the site owner approval stored by the CMS.
- Runtime APIs check `grantedPermissions`, not only the manifest request.
- No SDK surface should exist without a matching permission.
- Reserved permissions can exist before their APIs are implemented, but using them should not unlock private internals.

## Risk Levels

- `low`: visible UI additions with limited data access.
- `medium`: reads or writes plugin-owned data, or changes editor UI.
- `high`: mutates editor state or registers backend behavior.
- `dangerous`: internal APIs reserved for trusted first-party plugins.

## Capability Matrix

| Permission | Surface | Risk | Meaning |
| --- | --- | --- | --- |
| `admin.navigation` | Admin | Low | Add pages to the CMS admin navigation and plugin router. |
| `cms.storage` | Admin, editor, server | Medium | Read and write records for resources declared by the plugin. |
| `cms.routes` | Server | High | Register authenticated backend routes under the plugin runtime URL. |
| `editor.toolbar` | Editor | Medium | Add toolbar buttons to the editor UI. |
| `editor.commands` | Editor | Medium | Register commands callable from editor UI. |
| `editor.store.read` | Editor | Medium | Read current editor store state. |
| `editor.store.write` | Editor | High | Mutate editor store state through a host transaction. |
| `editor.canvas` | Editor | High | Reserved for canvas-level APIs. |
| `editor.panels` | Editor | Medium | Reserved for plugin-provided editor panels. |
| `modules.register` | Editor, manifest | Medium | Reserved for plugin-provided page builder modules. |
| `hooks.register` | Server | High | Reserved for CMS hooks and filters. |
| `storage.records` | Admin, editor, server | Medium | Compatibility alias for plugin-owned storage. Prefer `cms.storage`. |
| `unstable.internals` | Admin, editor, server | Dangerous | Reserved for trusted first-party internal API access. |

The source of truth for labels, descriptions, risks, and surfaces is `src/core/plugin-sdk/capabilities.ts`.
