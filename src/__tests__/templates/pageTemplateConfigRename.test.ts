/**
 * Regression tests verifying that `tableSlug` is the canonical field name in
 * `PageTemplateConfig` after the collectionId → tableSlug rename.
 *
 * - Round-trips through site serialization unchanged.
 * - `selectEntryTemplate` takes a slug, not an id.
 * - `parsePageTemplate` (via validateSite) rejects payloads missing `tableSlug`.
 */

import { describe, expect, it } from 'bun:test'
import { makeSite, makePage, makeNode } from '../fixtures'
import { validateSite } from '@core/persistence/validate'
import { selectEntryTemplate } from '@core/templates/templateMatching'

describe('pageTemplateConfig tableSlug rename', () => {
  it('round-trips a template page with tableSlug through site serialization', () => {
    const site = makeSite()
    const page = site.pages[0]
    page.template = {
      enabled: true,
      context: 'entry',
      tableSlug: 'posts',
      priority: 0,
      conditions: [],
    }

    const validated = validateSite(site)

    expect(validated.pages[0].template).toEqual({
      enabled: true,
      context: 'entry',
      tableSlug: 'posts',
      priority: 0,
      conditions: [],
    })
  })

  it('selectEntryTemplate returns the matching page when given a slug', () => {
    const site = makeSite()
    site.pages[0].template = {
      enabled: true,
      context: 'entry',
      tableSlug: 'posts',
      priority: 0,
      conditions: [],
    }

    expect(selectEntryTemplate(site, 'posts')?.id).toBe(site.pages[0].id)
    expect(selectEntryTemplate(site, 'projects')).toBeNull()
  })

  it('selectEntryTemplate accepts slug, not id (documents the semantic)', () => {
    const root = makeNode({ id: 'root', moduleId: 'base.body' })
    const templatePage = makePage({
      id: 'template-page',
      title: 'Post Template',
      slug: 'post-template',
      rootNodeId: 'root',
      nodes: { root },
      template: {
        enabled: true,
        context: 'entry',
        // tableSlug stores the DATA TABLE SLUG — not the table id.
        tableSlug: 'my-posts',
        priority: 0,
        conditions: [],
      },
    })
    const site = makeSite({ pages: [templatePage] })

    // Passing the slug 'my-posts' matches.
    expect(selectEntryTemplate(site, 'my-posts')?.id).toBe('template-page')
    // Passing anything else (e.g. a numeric id) does not match.
    expect(selectEntryTemplate(site, '42')).toBeNull()
  })

  it('parsePageTemplate rejects a payload missing tableSlug', () => {
    const site = makeSite()
    const page = site.pages[0]
    // Inject invalid template data (missing tableSlug) directly into the raw
    // object before validation so we can test that parsePageTemplate drops it.
    ;(page as unknown as Record<string, unknown>).template = {
      enabled: true,
      context: 'entry',
      // tableSlug intentionally absent
      priority: 0,
      conditions: [],
    }

    const validated = validateSite(site)

    // parsePageTemplate returns null for missing tableSlug → template is dropped.
    expect(validated.pages[0].template).toBeUndefined()
  })
})
