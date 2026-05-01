import { describe, expect, it } from 'bun:test'
import {
  collectEnabledAdminPages,
  parsePluginManifest,
  pluginAdminPageRoute,
  validatePluginRecordData,
} from '../../core/extensions/manifest'

describe('plugin manifest validation', () => {
  it('accepts a declarative admin-page plugin manifest', () => {
    const manifest = parsePluginManifest({
      id: 'local.map',
      name: 'Map Studio',
      version: '1.0.0',
      apiVersion: 1,
      description: 'Adds a map workspace to the admin.',
      adminPages: [
        {
          id: 'overview',
          title: 'Map',
          navLabel: 'Map',
          icon: 'map',
          content: {
            kind: 'map',
            heading: 'Store Map',
            body: 'Track important locations.',
            centerLabel: 'Prague',
            pins: [
              { label: 'HQ', detail: 'Main office', x: 42, y: 55 },
            ],
          },
        },
      ],
    })

    expect(manifest.id).toBe('local.map')
    expect(manifest.adminPages[0].route).toBe('/admin/plugins/local.map/overview')
    expect(pluginAdminPageRoute('local.map', 'overview')).toBe('/admin/plugins/local.map/overview')
  })

  it('accepts backend resources and resource-backed admin pages', () => {
    const manifest = parsePluginManifest({
      id: 'acme.books',
      name: 'Books',
      version: '1.0.0',
      apiVersion: 1,
      description: 'Adds a backend-backed books database.',
      permissions: ['storage.records'],
      resources: [
        {
          id: 'books',
          title: 'Books',
          singularLabel: 'Book',
          pluralLabel: 'Books',
          fields: [
            { id: 'title', label: 'Title', type: 'text', required: true },
            { id: 'author', label: 'Author', type: 'text' },
            { id: 'notes', label: 'Notes', type: 'longtext' },
          ],
        },
      ],
      adminPages: [
        {
          id: 'books',
          title: 'Books',
          navLabel: 'Books',
          content: {
            kind: 'resource',
            heading: 'Books',
            resource: 'books',
          },
        },
      ],
    })

    expect(manifest.resources[0].fields[0]).toMatchObject({
      id: 'title',
      label: 'Title',
      type: 'text',
      required: true,
    })
    expect(manifest.adminPages[0].content).toMatchObject({
      kind: 'resource',
      resource: 'books',
    })
  })

  it('accepts packaged JavaScript app admin pages', () => {
    const manifest = parsePluginManifest({
      id: 'acme.insights',
      name: 'Insights Dashboard',
      version: '1.0.0',
      apiVersion: 1,
      resources: [
        {
          id: 'metrics',
          title: 'Metrics',
          fields: [
            { id: 'label', label: 'Label', type: 'text', required: true },
            { id: 'value', label: 'Value', type: 'number', required: true },
          ],
        },
      ],
      adminPages: [
        {
          id: 'dashboard',
          title: 'Dashboard',
          navLabel: 'Insights',
          content: {
            kind: 'app',
            heading: 'Insights Dashboard',
            entry: 'admin/dashboard.js',
          },
        },
      ],
    })

    expect(manifest.adminPages[0].content).toMatchObject({
      kind: 'app',
      entry: 'admin/dashboard.js',
    })
  })

  it('rejects unsafe JavaScript app entry paths', () => {
    expect(() =>
      parsePluginManifest({
        id: 'acme.badapp',
        name: 'Bad App',
        version: '1.0.0',
        apiVersion: 1,
        adminPages: [{
          id: 'dashboard',
          title: 'Dashboard',
          content: { kind: 'app', heading: 'Dashboard', entry: '../secrets.js' },
        }],
      }),
    ).toThrow('Invalid plugin manifest')
  })

  it('rejects unsafe plugin IDs and page IDs', () => {
    expect(() =>
      parsePluginManifest({
        id: 'local/map',
        name: 'Bad',
        version: '1.0.0',
        apiVersion: 1,
        adminPages: [],
      }),
    ).toThrow('Invalid plugin manifest')

    expect(() =>
      parsePluginManifest({
        id: 'local.good',
        name: 'Bad Page',
        version: '1.0.0',
        apiVersion: 1,
        adminPages: [{ id: '../bad', title: 'Bad', content: { kind: 'markdown', body: 'Nope' } }],
      }),
    ).toThrow('Invalid plugin manifest')
  })

  it('collects admin pages only from enabled plugins', () => {
    const enabled = parsePluginManifest({
      id: 'local.enabled',
      name: 'Enabled',
      version: '1.0.0',
      apiVersion: 1,
      adminPages: [{ id: 'dashboard', title: 'Enabled', content: { kind: 'markdown', body: 'Visible' } }],
    })
    const disabled = parsePluginManifest({
      id: 'local.disabled',
      name: 'Disabled',
      version: '1.0.0',
      apiVersion: 1,
      adminPages: [{ id: 'dashboard', title: 'Disabled', content: { kind: 'markdown', body: 'Hidden' } }],
    })

    expect(
      collectEnabledAdminPages([
        { manifest: enabled, enabled: true },
        { manifest: disabled, enabled: false },
      ]).map((page) => page.pluginId),
    ).toEqual(['local.enabled'])
  })

  it('does not collect admin pages from plugins with lifecycle errors', () => {
    const manifest = parsePluginManifest({
      id: 'local.error',
      name: 'Broken',
      version: '1.0.0',
      apiVersion: 1,
      adminPages: [{ id: 'dashboard', title: 'Broken', content: { kind: 'markdown', body: 'Hidden' } }],
    })

    expect(
      collectEnabledAdminPages([
        { manifest, enabled: true, lifecycleStatus: 'error' },
      ]),
    ).toEqual([])
  })

  it('validates plugin record input against a declared resource schema', () => {
    const manifest = parsePluginManifest({
      id: 'acme.books',
      name: 'Books',
      version: '1.0.0',
      apiVersion: 1,
      resources: [
        {
          id: 'books',
          title: 'Books',
          fields: [
            { id: 'title', label: 'Title', type: 'text', required: true },
            { id: 'pages', label: 'Pages', type: 'number' },
            { id: 'featured', label: 'Featured', type: 'boolean' },
          ],
        },
      ],
      adminPages: [],
    })

    const data = validatePluginRecordData(manifest.resources[0], {
      title: 'Invisible Cities',
      pages: 165,
      featured: true,
      ignored: 'not stored',
    })

    expect(data).toEqual({
      title: 'Invisible Cities',
      pages: 165,
      featured: true,
    })
    expect(() => validatePluginRecordData(manifest.resources[0], { pages: 'many' }))
      .toThrow('Missing required field "Title"')
  })
})
