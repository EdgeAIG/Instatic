import { expect, type Browser } from '@playwright/test'
import { PUBLIC_BASE_URL } from './constants'

/**
 * Visit a published route as an anonymous visitor in a fresh browser context
 * (no admin cookies), then run assertions against the visitor-facing output.
 *
 * Using a separate context is what makes the draft-isolation checks meaningful:
 * the visitor must only ever see published HTML, never editor chrome or
 * unpublished drafts.
 */
export async function visitPublicPage(
  browser: Browser,
  options: {
    /** Route to open, relative to the public origin. Defaults to the homepage. */
    path?: string
    /** Optional visitor viewport to apply before the public page is loaded. */
    viewport?: { width: number; height: number }
    /** Text that must be present in the published page. */
    visibleText?: string | string[]
    /** Text that must NOT appear (e.g. an unpublished draft edit). */
    hiddenText?: string | string[]
    /** Extra assertions with the visitor page, after the built-in checks. */
    assert?: (page: import('@playwright/test').Page) => Promise<void>
  },
): Promise<void> {
  const context = await browser.newContext(
    options.viewport ? { viewport: options.viewport } : {},
  )
  const visitor = await context.newPage()
  try {
    await visitor.goto(`${PUBLIC_BASE_URL}${options.path ?? '/'}`)

    for (const text of toArray(options.visibleText)) {
      await expect(visitor.getByText(text)).toBeVisible()
    }
    for (const text of toArray(options.hiddenText)) {
      await expect(visitor.getByText(text)).toHaveCount(0)
    }
    // The public page is plain published HTML — never the editor canvas.
    await expect(visitor.locator('[data-testid="canvas-root"]')).toHaveCount(0)

    await options.assert?.(visitor)
  } finally {
    await context.close()
  }
}

function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}
