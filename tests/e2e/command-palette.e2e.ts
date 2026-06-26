import { expect, test, type Page } from '@playwright/test'
import { createPage, insertNotchModule, openSiteEditor } from './helpers'

/**
 * SPOT-001 through SPOT-013 — open and close the ⌘K command palette, navigate
 * to a workspace from it, switch viewport through a nested scope, run a
 * destructive two-Enter confirm, verify that confirm times out, verify
 * selected-layer context ranking, open from the AI panel, observe async
 * provider skeletons, complete a keyboard-only command run, respect
 * reduced-motion media preferences, keep contrast affordances visible, and see
 * the empty state for a no-match query.
 *
 * Read-only/draft mutations, so these run on the shared owner state.
 */
const OPEN_KEY = process.platform === 'darwin' ? 'Meta+k' : 'Control+k'
test.describe('command palette', () => {
  test('opens with the shortcut and closes with Esc (SPOT-001)', async ({
    page,
  }) => {
    await page.goto('/admin/dashboard')

    const palette = await openPalette(page)
    await expect(input(page)).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(palette).toBeHidden()

    // Reopening yields a fresh palette with an empty query.
    await openPalette(page)
    await expect(input(page)).toHaveValue('')
  })

  test('navigates to a workspace from a query (SPOT-002)', async ({ page }) => {
    await page.goto('/admin/dashboard')

    await openPalette(page)
    await input(page).fill('go to content')

    // Run the workspace navigation command (not a content-entry deep link).
    await page.getByRole('option', { name: 'Go to Content', exact: true }).click()

    // The content workspace may auto-select an entry, appending a row query.
    await expect(page).toHaveURL(/\/admin\/content(\?|$)/)
    await expect(palette(page)).toBeHidden()
  })

  test('requires a two-Enter confirm for a destructive command (SPOT-004)', async ({
    page,
  }) => {
    const name = `Palette Delete ${Date.now().toString(36)}`

    // Create a throwaway page so "Delete current page" has a safe target that is
    // not the homepage; creating it makes it the active page.
    await openSiteEditor(page)
    await createPage(page, name, `palette-del-${Date.now().toString(36)}`)
    await page.getByRole('treeitem', { name: `Open page ${name}` }).click()

    await openPalette(page)
    await input(page).fill('delete current page')
    const deleteCommand = page.getByRole('option', {
      name: /Delete current page/,
    })
    await expect(deleteCommand).toBeVisible()

    // First Enter arms the confirm; it does not delete yet.
    await page.keyboard.press('Enter')
    await expect(palette(page).getByRole('alert')).toHaveText(/again to confirm/)
    await expect(
      page.getByRole('treeitem', { name: `Open page ${name}` }),
    ).toBeVisible()

    // Second Enter runs it: the palette closes and the page is gone.
    await page.keyboard.press('Enter')
    await expect(palette(page)).toBeHidden()
    await expect(
      page.getByRole('treeitem', { name: `Open page ${name}` }),
    ).toHaveCount(0)
  })

  test('clears destructive confirmation after the timeout (SPOT-005)', async ({
    page,
  }) => {
    const name = `Palette Timeout ${Date.now().toString(36)}`

    await openSiteEditor(page)
    await createPage(page, name, `palette-timeout-${Date.now().toString(36)}`)
    await page.getByRole('treeitem', { name: `Open page ${name}` }).click()

    await openPalette(page)
    await input(page).fill('delete current page')
    const deleteCommand = page.getByRole('option', {
      name: /Delete current page/,
    })
    await expect(deleteCommand).toBeVisible()

    await page.keyboard.press('Enter')
    await expect(palette(page).getByRole('alert')).toHaveText(/again to confirm/)
    await expect(deleteCommand).toContainText('Press ↵ again to confirm')

    await expect(palette(page).getByRole('alert')).toHaveText('', {
      timeout: 6_500,
    })
    await expect(deleteCommand).not.toContainText('Press ↵ again to confirm')
    await expect(
      page.getByRole('treeitem', { name: `Open page ${name}` }),
    ).toBeVisible()
  })

  test('shows an empty state for a no-match query (SPOT-006)', async ({
    page,
  }) => {
    await page.goto('/admin/dashboard')

    await openPalette(page)
    await input(page).fill('zzz-no-match-xkq')

    await expect(palette(page).getByText(/no results/i)).toBeVisible()
    await expect(page.getByRole('option')).toHaveCount(0)
  })

  test('switches viewport through the nested scope (SPOT-003)', async ({ page }) => {
    await openSiteEditor(page)

    await expect(
      page.getByRole('button', { name: /Switch to Desktop breakpoint/, pressed: true }),
    ).toBeVisible()

    await openPalette(page)
    await input(page).fill('switch viewport')
    await page.getByRole('option', { name: /Switch viewport/ }).click()
    await page.getByRole('option', { name: 'Mobile' }).click()

    await expect(palette(page)).toBeHidden()
    await expect(
      page.getByRole('button', { name: /Switch to Mobile breakpoint/, pressed: true }),
    ).toBeVisible()
  })

  test('boosts selected-layer commands near the top (SPOT-007)', async ({
    page,
  }) => {
    await page.goto('/admin/dashboard')
    await openPalette(page)
    await expect(page.getByRole('option', { name: /Duplicate layer/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(palette(page)).toBeHidden()

    await openSiteEditor(page)
    await insertNotchModule(page, 'text')
    await expect(
      page.getByRole('button', { name: 'Duplicate selected layers' }),
    ).toBeVisible()

    await openPalette(page)
    const options = palette(page).getByRole('option')
    await expect.poll(async () => {
      const visibleOptions = await options.allTextContents()
      return visibleOptions.slice(0, 5).join('\n')
    }).toContain('Duplicate layer')
  })

  test('opens over the AI assistant panel and restores panel focus (SPOT-009)', async ({
    page,
  }) => {
    await openSiteEditor(page)
    await page.getByRole('button', { name: 'Open AI assistant panel' }).click()

    const assistantPanel = page.getByRole('complementary', { name: 'AI Assistant' })
    await expect(assistantPanel).toBeVisible()
    const newChatButton = assistantPanel.getByRole('button', { name: 'New chat' })
    await newChatButton.focus()
    await expect(newChatButton).toBeFocused()

    const dialog = await openPalette(page)
    await expect(input(page)).toBeFocused()
    await expect(assistantPanel).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(newChatButton).toBeFocused()
  })

  test('runs a command with the keyboard only (SPOT-011)', async ({ page }) => {
    await page.goto('/admin/dashboard')
    const focusOrigin = page.getByTestId('account-menu-trigger')
    await focusOrigin.focus()
    await expect(focusOrigin).toBeFocused()

    await openPalette(page)
    await input(page).fill('go to content')
    const contentCommand = page.getByRole('option', {
      name: 'Go to Content',
      exact: true,
    })
    await expect(contentCommand).toBeVisible()
    const contentCommandRowId = await contentCommand.getAttribute('id')
    if (!contentCommandRowId) throw new Error('Go to Content command row has no id')
    await expect(input(page)).toHaveAttribute('aria-activedescendant', contentCommandRowId)

    await page.keyboard.press('ArrowDown')
    await expect(input(page)).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(input(page)).toHaveAttribute('aria-activedescendant', contentCommandRowId)

    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/admin\/content(\?|$)/)
    await expect(palette(page)).toBeHidden()
  })

  test('shows async provider skeletons until results resolve (SPOT-010)', async ({
    page,
  }) => {
    let releaseContentSearch: () => void = () => {}
    const contentSearchReleased = new Promise<void>((resolve) => {
      releaseContentSearch = resolve
    })

    await page.route('**/admin/api/cms/data/search?**', async (route) => {
      await contentSearchReleased
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entries: [
            {
              id: 'spot-010-content-row',
              tableId: 'posts',
              tableSlug: 'posts',
              tableName: 'Posts',
              slug: 'async-skeleton-probe',
              status: 'draft',
              updatedAt: new Date('2026-06-22T00:00:00.000Z').toISOString(),
            },
          ],
        }),
      })
    })

    await page.goto('/admin/dashboard')
    await openPalette(page)
    await input(page).fill('async skeleton probe')

    const contentSkeleton = page.getByRole('group', {
      name: 'Content',
    }).and(page.locator('[aria-busy="true"]'))
    await expect(contentSkeleton).toBeVisible({ timeout: 2_000 })

    releaseContentSearch()

    await expect(contentSkeleton).toHaveCount(0)
    await expect(
      page.getByRole('option', { name: 'Async Skeleton Probe', exact: true }),
    ).toBeVisible()
  })

  test('respects reduced-motion media settings (SPOT-012)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openSiteEditor(page)

    const dialog = await openPalette(page)
    const panelMotion = await dialog.evaluate((el) => {
      const style = getComputedStyle(el)
      return {
        animationName: style.animationName,
        transform: style.transform,
      }
    })
    expect(panelMotion).toEqual({
      animationName: 'none',
      transform: 'none',
    })

    await input(page).fill('switch viewport')
    await page.getByRole('option', { name: /Switch viewport/ }).click()
    const results = page.getByRole('listbox', { name: 'Command results' })
    await expect(page.getByRole('option', { name: 'Mobile' })).toBeVisible()

    const scopeMotion = await results.evaluate((el) => {
      const style = getComputedStyle(el)
      return {
        animationName: style.animationName,
        transform: style.transform,
      }
    })
    expect(scopeMotion.animationName).not.toContain('scopeSlide')
    expect(scopeMotion.transform).toBe('none')
  })

  test('keeps highlighted rows and match marks visible in high contrast (SPOT-013)', async ({
    page,
  }) => {
    await page.emulateMedia({ contrast: 'more', forcedColors: 'active' })
    await page.goto('/admin/dashboard')

    await openPalette(page)
    await input(page).fill('go to content')
    const contentCommand = page.getByRole('option', {
      name: 'Go to Content',
      exact: true,
    })
    await expect(contentCommand).toHaveAttribute('aria-selected', 'true')

    const rowContrast = await contentCommand.evaluate((el) => {
      const style = getComputedStyle(el)
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      }
    })
    expect(rowContrast.outlineStyle).not.toBe('none')
    expect(Number.parseFloat(rowContrast.outlineWidth)).toBeGreaterThanOrEqual(2)

    const mark = contentCommand.locator('mark').first()
    await expect(mark).toBeVisible()
    const markContrast = await mark.evaluate((el) => {
      const style = getComputedStyle(el)
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      }
    })
    expect(markContrast.outlineStyle).not.toBe('none')
    expect(Number.parseFloat(markContrast.outlineWidth)).toBeGreaterThanOrEqual(1)
  })

  test('boosts a recently run command to the top on reopen (SPOT-008)', async ({
    page,
  }) => {
    await page.goto('/admin/dashboard')

    await openPalette(page)
    await input(page).fill('go to content')
    await page.getByRole('option', { name: 'Go to Content', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/content(\?|$)/)

    // Reopen with an empty query: recency boosts the just-run command to the top
    // of the list (it outranks the default first nav command, "Go to Site editor").
    await page.goto('/admin/dashboard')
    await openPalette(page)
    await expect(palette(page).getByRole('option').first()).toContainText(
      'Go to Content',
    )
  })
})

function palette(page: Page) {
  return page.getByRole('dialog', { name: 'Command palette' })
}

function input(page: Page) {
  return page.getByRole('combobox', { name: 'Search commands' })
}

async function openPalette(page: Page) {
  // Wait for the admin shell so the global ⌘K keydown listener has mounted
  // before pressing the shortcut.
  await expect(page.getByTestId('account-menu-trigger')).toBeVisible()
  const dialog = palette(page)
  await expect(async () => {
    await page.keyboard.press(OPEN_KEY)
    await expect(dialog).toBeVisible({ timeout: 1_000 })
  }).toPass()
  return dialog
}
