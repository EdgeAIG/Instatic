/**
 * siteImportCommands.test.ts
 *
 * Unit tests for the `getSiteImportCommands()` Spotlight command factory.
 *
 * Covers the command contract and the run() side effect without splitting
 * every static field into a separate test case.
 *
 * See also the parallel `getImportHtmlCommands` implementation in
 * `src/admin/spotlight/commands/importHtml.ts` — both follow the same pattern.
 */

import { describe, it, expect } from 'bun:test'
import { getSiteImportCommands } from '@admin/spotlight/commands/siteImport'
import { useAdminUi } from '@admin/state/adminUi'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal spotlight context — mirrors the SpotlightContext shape. */
function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    closeSpotlight: () => {},
    // Placeholders for other ctx members the command doesn't use
    ...overrides,
  }
}

describe('getSiteImportCommands', () => {
  it('returns the Site Import spotlight command contract', () => {
    const [command] = getSiteImportCommands()
    expect(command).toMatchObject({
      id: 'editor.importSite',
      title: 'Import Site',
      group: 'editor',
      workspaces: ['any'],
    })
    expect(getSiteImportCommands()).toHaveLength(1)
    expect(command.subtitle?.toLowerCase()).toMatch(/folder|zip|file|page|archive|bundle/)
    expect(command.capability).toEqual([
      'site.structure.edit',
      'site.content.edit',
      'site.style.edit',
    ])
    expect(command.iconName).toBeTruthy()
    expect(command.keywords).toEqual(
      expect.arrayContaining(['import', 'site', 'zip', 'folder', 'bundle', 'json', 'cms', 'html', 'css']),
    )
  })

  it('closes Spotlight before opening the Site Import modal', async () => {
    useAdminUi.setState({ siteImportOpen: false } as Parameters<typeof useAdminUi.setState>[0])

    const callOrder: string[] = []
    const ctx = makeCtx({
      closeSpotlight: () => callOrder.push('closeSpotlight'),
    })
    const origOpen = useAdminUi.getState().openSiteImport
    useAdminUi.setState({
      openSiteImport: () => {
        callOrder.push('openModal')
        origOpen()
      },
    } as Parameters<typeof useAdminUi.setState>[0])

    await commands()[0].run(ctx as never)

    expect(callOrder).toEqual(['closeSpotlight', 'openModal'])
    expect(useAdminUi.getState().siteImportOpen).toBe(true)

    useAdminUi.setState({ openSiteImport: origOpen } as Parameters<typeof useAdminUi.setState>[0])
    useAdminUi.getState().closeSiteImport()
  })
})

function commands() {
  return getSiteImportCommands()
}
