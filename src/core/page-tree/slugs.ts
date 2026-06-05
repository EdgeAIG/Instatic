import type { Page } from './page'

const RESERVED_PUBLIC_SLUGS = new Set(['admin', 'api', 'assets', 'health'])

export function normalizePageSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function pageSlugError(slug: string): string | null {
  if (!slug) return 'Page slug is required.'
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return 'Page slug must use lowercase letters, numbers, and single hyphens.'
  }
  if (RESERVED_PUBLIC_SLUGS.has(slug)) {
    return `Page slug "${slug}" is reserved.`
  }
  return null
}

export function pageSlugDuplicateError(
  slug: string,
  pages: Page[],
  currentPageId?: string,
): string | null {
  const duplicate = pages.find((page) =>
    page.slug === slug && page.id !== currentPageId
  )
  return duplicate ? `Duplicate page slug "/${slug}".` : null
}

/**
 * Make a desired slug unique within `pages` by auto-suffixing (`-2`, `-3`, …).
 * Used by the page-creation mutations (addPage / duplicatePage) and by
 * renamePage so two pages can never collide on a slug — a collision makes the
 * whole site fail `validateSite` on save. `excludePageId` skips the page being
 * renamed so re-saving its own slug is a no-op rather than a self-collision.
 */
export function uniquePageSlug(
  desired: string,
  pages: Page[],
  excludePageId?: string,
): string {
  const base = normalizePageSlug(desired) || 'page'
  let candidate = base
  let suffix = 2
  while (pages.some((page) => page.slug === candidate && page.id !== excludePageId)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

export function createUniquePageSlug(title: string, pages: Page[]): string {
  const normalized = normalizePageSlug(title)
  const base = !normalized
    ? 'page'
    : pageSlugError(normalized)
      ? `${normalized}-page`
      : normalized
  let candidate = base
  let suffix = 2
  while (pageSlugError(candidate) || pages.some((page) => page.slug === candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

export function pagePublicPath(slug: string): string {
  return slug === 'index' ? '/' : `/${slug}`
}

/** The home page is the one published at the site root (`/`) — slug `index`. */
export function isHomePage(page: Page): boolean {
  return page.slug === 'index'
}

/**
 * Resolve the site's home page (slug `index`). Used as the default selection
 * when the editor opens without an explicit page in the URL, and to pin the
 * home page to the top of the site explorer's page list.
 */
export function findHomePage(pages: Page[]): Page | undefined {
  return pages.find(isHomePage)
}
