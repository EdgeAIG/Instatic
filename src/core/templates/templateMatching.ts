import type { Page, SiteDocument } from '@core/page-tree'

export function normalizeRouteBase(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return '/'

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/g, '')
  return withoutTrailingSlash || '/'
}

export function selectEntryTemplate(site: SiteDocument, tableSlug: string): Page | null {
  const matching = site.pages
    .map((page, index) => ({ page, index }))
    .filter(({ page }) =>
      page.template?.enabled === true &&
      page.template.context === 'entry' &&
      page.template.tableSlug === tableSlug
    )
    .sort((a, b) => {
      const priorityDelta = (b.page.template?.priority ?? 0) - (a.page.template?.priority ?? 0)
      return priorityDelta || a.index - b.index
    })

  return matching[0]?.page ?? null
}
