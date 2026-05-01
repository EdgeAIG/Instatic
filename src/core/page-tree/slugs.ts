import type { Page } from './types'

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
