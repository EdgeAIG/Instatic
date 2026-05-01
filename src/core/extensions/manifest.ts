import { z } from 'zod'
import type {
  InstalledPlugin,
  PluginAdminPage,
  PluginAdminPageRoute,
  PluginManifest,
  PluginPermission,
  PluginPageContent,
  PluginResource,
} from '../plugin-sdk'
import {
  PLUGIN_PERMISSION_VALUES,
  permissionLabel as sdkPermissionLabel,
} from '../plugin-sdk'

const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/
const PAGE_ID_PATTERN = /^[a-z][a-z0-9-]*$/
const SEMVERISH_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9a-zA-Z.-]+)?$/
const SAFE_ASSET_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[a-zA-Z0-9._/-]+$/

const permissionSchema = z.enum(PLUGIN_PERMISSION_VALUES)

const pinSchema = z.object({
  label: z.string().trim().min(1).max(80),
  detail: z.string().trim().max(160).optional(),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
})

const contentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('markdown'),
    heading: z.string().trim().min(1).max(120).optional(),
    body: z.string().max(20_000),
  }),
  z.object({
    kind: z.literal('map'),
    heading: z.string().trim().min(1).max(120),
    body: z.string().trim().max(500).optional(),
    centerLabel: z.string().trim().max(80).optional(),
    pins: z.array(pinSchema).max(40).default([]),
  }),
  z.object({
    kind: z.literal('resource'),
    heading: z.string().trim().min(1).max(120),
    resource: z.string().trim().regex(PAGE_ID_PATTERN),
  }),
  z.object({
    kind: z.literal('app'),
    heading: z.string().trim().min(1).max(120),
    entry: z.string().trim().regex(SAFE_ASSET_PATH_PATTERN),
    assetPath: z.string().trim().optional(),
  }),
])

const resourceFieldSchema = z.object({
  id: z.string().trim().regex(PAGE_ID_PATTERN),
  label: z.string().trim().min(1).max(80),
  type: z.enum(['text', 'longtext', 'number', 'date', 'boolean']),
  required: z.boolean().optional(),
})

const resourceSchema = z.object({
  id: z.string().trim().regex(PAGE_ID_PATTERN),
  title: z.string().trim().min(1).max(80),
  singularLabel: z.string().trim().min(1).max(80).optional(),
  pluralLabel: z.string().trim().min(1).max(80).optional(),
  fields: z.array(resourceFieldSchema).min(1).max(50),
})

const adminPageSchema = z.object({
  id: z.string().trim().regex(PAGE_ID_PATTERN),
  title: z.string().trim().min(1).max(80),
  navLabel: z.string().trim().min(1).max(30).optional(),
  icon: z.string().trim().min(1).max(30).optional(),
  route: z.string().optional(),
  content: contentSchema,
})

const manifestSchema = z.object({
  id: z.string().trim().regex(PLUGIN_ID_PATTERN),
  name: z.string().trim().min(1).max(80),
  version: z.string().trim().regex(SEMVERISH_PATTERN),
  apiVersion: z.literal(1),
  description: z.string().trim().max(500).optional(),
  permissions: z.array(permissionSchema).default([]),
  grantedPermissions: z.array(permissionSchema).optional(),
  entrypoints: z.object({
    server: z.string().trim().regex(SAFE_ASSET_PATH_PATTERN).optional(),
    editor: z.string().trim().regex(SAFE_ASSET_PATH_PATTERN).optional(),
    admin: z.string().trim().regex(SAFE_ASSET_PATH_PATTERN).optional(),
  }).optional(),
  assetBasePath: z.string().trim().optional(),
  resources: z.array(resourceSchema).max(20).default([]),
  adminPages: z.array(adminPageSchema).max(20).default([]),
})

export function pluginAdminPageRoute(pluginId: string, pageId: string): string {
  return `/admin/plugins/${pluginId}/${pageId}`
}

export function parsePluginManifest(input: unknown): PluginManifest {
  const result = manifestSchema.safeParse(input)
  if (!result.success) {
    throw new Error(`Invalid plugin manifest: ${result.error.issues[0]?.message ?? 'manifest is malformed'}`)
  }

  const duplicateResources = new Set<string>()
  const resources: PluginResource[] = result.data.resources.map((resource) => {
    if (duplicateResources.has(resource.id)) {
      throw new Error(`Invalid plugin manifest: duplicate resource "${resource.id}"`)
    }
    duplicateResources.add(resource.id)

    const duplicateFields = new Set<string>()
    for (const field of resource.fields) {
      if (duplicateFields.has(field.id)) {
        throw new Error(`Invalid plugin manifest: duplicate field "${field.id}"`)
      }
      duplicateFields.add(field.id)
    }

    return resource as PluginResource
  })

  const duplicatePages = new Set<string>()
  const adminPages: PluginAdminPage[] = result.data.adminPages.map((page) => {
    if (duplicatePages.has(page.id)) {
      throw new Error(`Invalid plugin manifest: duplicate admin page "${page.id}"`)
    }
    duplicatePages.add(page.id)
    if (page.content.kind === 'resource' && !duplicateResources.has(page.content.resource)) {
      throw new Error(`Invalid plugin manifest: resource page "${page.id}" references unknown resource "${page.content.resource}"`)
    }

    return {
      id: page.id,
      title: page.title,
      navLabel: page.navLabel,
      icon: page.icon,
      route: pluginAdminPageRoute(result.data.id, page.id),
      content: page.content as PluginPageContent,
    }
  })

  return {
    id: result.data.id,
    name: result.data.name,
    version: result.data.version,
    apiVersion: result.data.apiVersion,
    description: result.data.description,
    permissions: result.data.permissions,
    grantedPermissions: result.data.grantedPermissions,
    entrypoints: result.data.entrypoints,
    assetBasePath: result.data.assetBasePath,
    resources,
    adminPages,
  }
}

export function missingPluginPermissionGrants(
  manifest: Pick<PluginManifest, 'permissions'>,
  grantedPermissions: PluginPermission[],
): PluginPermission[] {
  const granted = new Set(grantedPermissions)
  return manifest.permissions.filter((permission) => !granted.has(permission))
}

export function permissionLabel(permission: PluginPermission): string {
  return sdkPermissionLabel(permission)
}

export function findPluginResource(
  manifest: Pick<PluginManifest, 'resources'>,
  resourceId: string,
): PluginResource | null {
  return manifest.resources.find((resource) => resource.id === resourceId) ?? null
}

export function validatePluginRecordData(
  resource: PluginResource,
  input: unknown,
  options: { partial?: boolean } = {},
): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Plugin record data must be an object')
  }

  const raw = input as Record<string, unknown>
  const data: Record<string, unknown> = {}

  for (const field of resource.fields) {
    const value = raw[field.id]
    const missing = value === undefined || value === null || value === ''

    if (missing) {
      if (field.required && !options.partial) {
        throw new Error(`Missing required field "${field.label}"`)
      }
      continue
    }

    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Field "${field.label}" must be a number`)
      }
      data[field.id] = value
      continue
    }

    if (field.type === 'boolean') {
      if (typeof value !== 'boolean') {
        throw new Error(`Field "${field.label}" must be a boolean`)
      }
      data[field.id] = value
      continue
    }

    if (typeof value !== 'string') {
      throw new Error(`Field "${field.label}" must be text`)
    }
    data[field.id] = value.trim()
  }

  return data
}

export function collectEnabledAdminPages(
  plugins: Array<Pick<InstalledPlugin, 'enabled' | 'manifest'> & Partial<Pick<InstalledPlugin, 'lifecycleStatus'>>>,
): PluginAdminPageRoute[] {
  return plugins
    .filter((plugin) => plugin.enabled && plugin.lifecycleStatus !== 'error')
    .flatMap((plugin) =>
      plugin.manifest.adminPages.map((page) => {
        const content: PluginPageContent = page.content.kind === 'app'
          ? {
              ...page.content,
              assetPath: page.content.assetPath ?? plugin.manifest.assetBasePath,
            }
          : page.content

        return {
          pluginId: plugin.manifest.id,
          pluginName: plugin.manifest.name,
          ...page,
          content,
        }
      }),
    )
}
