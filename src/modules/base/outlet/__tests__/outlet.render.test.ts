import { describe, expect, it } from 'bun:test'
import { OutletModule } from '../index'

describe('base.outlet render', () => {
  it('emits an empty content region in the default tag when no body is bound', () => {
    expect(OutletModule.render({ tag: 'main', customTag: '', html: '' } as never).html).toBe('<main data-instatic-content-region></main>')
  })
  it('wraps bound body html in a content region', () => {
    expect(OutletModule.render({ tag: 'main', customTag: '', html: '<p>hi</p>' } as never).html).toBe('<main data-instatic-content-region><p>hi</p></main>')
  })
  it('honours a built-in tag override', () => {
    expect(OutletModule.render({ tag: 'section', customTag: '', html: '' } as never).html).toBe('<section data-instatic-content-region></section>')
  })
  it('honours a custom tag', () => {
    expect(OutletModule.render({ tag: 'custom', customTag: 'aside', html: '' } as never).html).toBe('<aside data-instatic-content-region></aside>')
  })
  it('falls back to div for an unknown tag', () => {
    expect(OutletModule.render({ tag: 'bogus', customTag: '', html: '' } as never).html).toBe('<div data-instatic-content-region></div>')
  })
})
