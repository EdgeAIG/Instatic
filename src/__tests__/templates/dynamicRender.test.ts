import { describe, expect, it } from 'bun:test'
import { makeModule, makePage, makeRegistry, makeSite } from '../publisher/helpers'
import { publishPage } from '../../core/publisher/render'
import { resolveDynamicProps } from '../../core/templates/dynamicBindings'
import { ContentModule } from '../../modules/base/content'

const currentEntry = {
  id: 'version_1',
  entryId: 'entry_1',
  collectionId: 'posts',
  collectionSlug: 'posts',
  collectionRouteBase: '/posts',
  versionNumber: 1,
  title: 'Dynamic Post',
  slug: 'dynamic-post',
  bodyMarkdown: '## Heading\n\nBody text',
  featuredMediaId: 'media_1',
  featuredMediaPath: '/uploads/cover.jpg',
  firstImagePath: null,
  seoTitle: 'SEO title',
  seoDescription: 'SEO description',
  publishedAt: '2026-05-01T10:00:00.000Z',
  createdAt: '2026-05-01T10:00:00.000Z',
}

describe('dynamic template rendering', () => {
  it('overlays current entry fields over static props', () => {
    const props = resolveDynamicProps(
      { text: 'Static fallback' },
      { text: { source: 'currentEntry', field: 'title' } },
      { currentEntry },
    )

    expect(props.text).toBe('Dynamic Post')
  })

  it('keeps the static fallback when a binding cannot resolve', () => {
    const props = resolveDynamicProps(
      { text: 'Static fallback' },
      { text: { source: 'currentEntry', field: 'missing' } },
      { currentEntry },
    )

    expect(props.text).toBe('Static fallback')
  })

  it('resolves featured media paths for media bindings', () => {
    const props = resolveDynamicProps(
      { src: '' },
      { src: { source: 'currentEntry', field: 'featuredMedia', format: 'media' } },
      { currentEntry },
    )

    expect(props.src).toBe('/uploads/cover.jpg')
  })

  it('resolves the first inline body image for media bindings', () => {
    const props = resolveDynamicProps(
      { src: '' },
      { src: { source: 'currentEntry', field: 'firstImage', format: 'media' } },
      {
        currentEntry: {
          ...currentEntry,
          bodyMarkdown: 'Intro\n\n![Hero](/uploads/body-hero.jpg)\n\n![Other](/uploads/other.jpg)',
        },
      },
    )

    expect(props.src).toBe('/uploads/body-hero.jpg')
  })

  it('renders dynamic values through publishPage while static pages stay unchanged', () => {
    const textModule = makeModule('base.text', {
      render: (props) => ({
        html: `<p>${String((props as { text: string }).text)}</p>`,
      }),
    })
    const registry = makeRegistry({
      'base.root': makeModule('base.root', {
        canHaveChildren: true,
        render: (_props, children) => ({ html: `<main>${children.join('')}</main>` }),
      }),
      'base.text': textModule,
      'base.content': ContentModule,
    })
    const site = makeSite()
    const page = makePage({
      root: { moduleId: 'base.root', props: {}, children: ['title', 'body'] },
      title: {
        moduleId: 'base.text',
        props: { text: 'Static title' },
        dynamicBindings: { text: { source: 'currentEntry', field: 'title' } },
      },
      body: {
        moduleId: 'base.content',
        props: { html: '<p>Static body</p>' },
        dynamicBindings: { html: { source: 'currentEntry', field: 'body', format: 'html' } },
      },
    })

    const dynamicHtml = publishPage(page, site, registry, undefined, { currentEntry }).html
    const staticHtml = publishPage(page, site, registry).html

    expect(dynamicHtml).toContain('<p>Dynamic Post</p>')
    expect(dynamicHtml).toContain('<h2>Heading</h2>')
    expect(dynamicHtml).toContain('<p>Body text</p>')
    expect(staticHtml).toContain('<p>Static title</p>')
    expect(staticHtml).toContain('<p>Static body</p>')
  })
})
