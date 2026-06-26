import { expect, test } from '@playwright/test'
import { openSiteEditor, openSitePanel } from './helpers'

/**
 * REL-002 — intentional validation errors should be specific, field-local, and
 * recoverable. This covers the stable page-slug validation path in the Site
 * Explorer; broader form/error sweeps stay in the agent-run protocol.
 */
test.describe('error handling', () => {
  test('shows recoverable field-level page slug validation errors (REL-002)', async ({
    page,
  }) => {
    const suffix = Date.now().toString(36)
    const pageName = `Validation Recovery ${suffix}`
    const validSlug = `validation-recovery-${suffix}`

    await openSiteEditor(page)
    await openSitePanel(page)
    await page.getByRole('button', { name: 'New page', exact: true }).click()

    const dialog = page.getByRole('dialog', { name: 'New page' })
    await expect(dialog).toBeVisible()

    const nameInput = dialog.getByLabel('Name')
    const slugInput = dialog.getByLabel('Slug')
    const createButton = dialog.getByRole('button', { name: 'Create' })

    await nameInput.fill(pageName)
    await expect(createButton).toBeEnabled()

    await slugInput.fill('')
    await expect(dialog.getByRole('alert')).toHaveText('Page slug is required.')
    await expect(slugInput).toHaveAttribute('aria-describedby', 'site-create-slug-error')
    await expect(createButton).toBeDisabled()

    await slugInput.fill('admin')
    await expect(dialog.getByRole('alert')).toHaveText('Page slug "admin" is reserved.')
    await expect(createButton).toBeDisabled()

    await slugInput.fill(validSlug)
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(createButton).toBeEnabled()
    await createButton.click()

    await expect(dialog).toBeHidden()
    await expect(
      page.getByRole('treeitem', { name: `Open page ${pageName}` }),
    ).toBeVisible()
  })
})
