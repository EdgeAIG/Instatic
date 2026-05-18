import { describe, expect, it } from 'bun:test'
import { makeSite } from '../fixtures'
import { normalizeRouteBase, selectEntryTemplate } from '@core/templates/templateMatching'

describe('template matching', () => {
  it('normalizes collection route bases', () => {
    expect(normalizeRouteBase('posts')).toBe('/posts')
    expect(normalizeRouteBase('/blog/')).toBe('/blog')
    expect(normalizeRouteBase('')).toBe('/')
  })

  it('selects the highest priority matching entry template', () => {
    const site = makeSite()
    const firstPage = site.pages[0]
    firstPage.id = 'low-priority-page'
    firstPage.template = {
      enabled: true,
      context: 'entry',
      tableSlug: 'posts',
      priority: 10,
      conditions: [],
    }

    site.pages.push({
      ...structuredClone(firstPage),
      id: 'high-priority-page',
      title: 'Post Template',
      slug: 'post-template',
      template: {
        enabled: true,
        context: 'entry',
        tableSlug: 'posts',
        priority: 100,
        conditions: [],
      },
    })

    expect(selectEntryTemplate(site, 'posts')?.id).toBe('high-priority-page')
  })

  it('uses page order as the tie-breaker for equal priority templates', () => {
    const site = makeSite()
    site.pages[0].id = 'first-template'
    site.pages[0].template = {
      enabled: true,
      context: 'entry',
      tableSlug: 'posts',
      priority: 50,
      conditions: [],
    }

    site.pages.push({
      ...structuredClone(site.pages[0]),
      id: 'second-template',
      slug: 'second-template',
    })

    expect(selectEntryTemplate(site, 'posts')?.id).toBe('first-template')
  })
})
