import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('admin CMS route wiring', () => {
  it('routes admin sections to the CMS entry and does not expose local site routes', () => {
    const router = readFileSync(join(root, 'src/admin/router.tsx'), 'utf8')

    expect(router).toContain('path="/admin"')
    // Admin home redirects to the dashboard (the new admin-home section).
    expect(router).toContain('to="/admin/dashboard"')
    expect(router).toContain('path="/admin/dashboard"')
    expect(router).toContain('path="/admin/site"')
    expect(router).toContain('path="/admin/content"')
    expect(router).toContain('AdminEntry')
    // The OLD multi-project editor URLs that came with the static ZIP export
    // workflow must stay gone.
    expect(router).not.toContain('/editor/:projectId')
    expect(router).not.toContain('/editor/:siteId')
  })

  it('uses the server CMS adapter without local site mode branching', () => {
    const editor = readFileSync(join(root, 'src/admin/layouts/AdminCanvasLayout/AdminCanvasLayout.tsx'), 'utf8')

    expect(editor).toContain('cmsAdapter')
    expect(editor).not.toContain('localAdapter')
    expect(editor).not.toContain('persistenceMode')
    expect(editor).not.toContain('mediaMode')
  })

  it('gates the CMS editor behind setup and login checks', () => {
    // AdminEntry is the orchestrator: it consumes the boot hook (which
    // resolves setup status + current user) and dispatches to the pre-auth
    // form or the authenticated shell.
    const admin = readFileSync(join(root, 'src/admin/AdminEntry.tsx'), 'utf8')
    const boot = readFileSync(join(root, 'src/admin/preauth/useAdminBoot.ts'), 'utf8')
    const preAuth = readFileSync(join(root, 'src/admin/preauth/AdminPreAuthForm.tsx'), 'utf8')

    // Boot hook is the only place that runs the unauthenticated probes.
    expect(boot).toContain('getCmsSetupStatus')
    expect(boot).toContain('getCurrentCmsUser')

    // Pre-auth form is the only place that submits credentials.
    expect(preAuth).toContain('setupCms')
    expect(preAuth).toContain('loginCms')

    // Orchestrator still owns the session provider and page dispatch.
    expect(admin).toContain('AdminSessionProvider')
    expect(admin).toContain('<SitePage />')
    expect(admin).toContain('<ContentPage />')
  })

  it('uses a submit button for setup and login forms', () => {
    const preAuth = readFileSync(join(root, 'src/admin/preauth/AdminPreAuthForm.tsx'), 'utf8')

    expect(preAuth).toContain('type="submit"')
  })
})
