/**
 * Smoke tests for the hole runtime JavaScript string.
 *
 * The test environment preloads `happy-dom` (via `bunfig.toml` → `setup.ts`),
 * which provides `IntersectionObserver`, `document`, and `fetch` globals.
 *
 * These tests verify:
 *   1. The runtime source contains the expected IntersectionObserver API calls.
 *   2. The runtime function compiles (no SyntaxError).
 *   3. The runtime registers an observer for every `<pb-hole[data-pb-hole]>` element.
 *   4. When an IntersectionObserver callback fires with isIntersecting=true,
 *      the runtime calls `fetch` with the correct URL and swaps `el.outerHTML`.
 *
 * We drive the `IntersectionObserver` callbacks manually since happy-dom does
 * not fire them based on real viewport layout.
 */

import { describe, it, expect } from 'bun:test'
import { HOLE_RUNTIME_JS } from '../../../server/publish/holeRuntime'

describe('HOLE_RUNTIME_JS — static source content', () => {
  it('compiles and keeps the non-behavioral runtime constants wired', () => {
    expect(() => new Function(HOLE_RUNTIME_JS)).not.toThrow()
    expect(HOLE_RUNTIME_JS).toContain('IntersectionObserver')
    expect(HOLE_RUNTIME_JS).toContain('200px')
    expect(HOLE_RUNTIME_JS).toContain('encodeURIComponent')
    expect(HOLE_RUNTIME_JS).toContain('pbHole')
    expect(HOLE_RUNTIME_JS).toContain('pbVersion')
    expect(HOLE_RUNTIME_JS).toContain('/_pb/hole/')
    expect(HOLE_RUNTIME_JS).not.toMatch(/\.innerHTML\s*=/)
    expect(HOLE_RUNTIME_JS).toContain('.catch(')
  })
})

// ---------------------------------------------------------------------------
// Runtime behaviour — DOM-driven
//
// A `<pb-hole>` is `display:contents` and has NO layout box, so the runtime
// observes its placeholder CHILD (which does have a box) and swaps the whole
// hole when the child intersects. Holes with no placeholder child are fetched
// eagerly on load (nothing to lazily reveal).
// ---------------------------------------------------------------------------

describe('HOLE_RUNTIME_JS — runtime behaviour with mock IntersectionObserver', () => {
  it('observes each hole\'s placeholder child (not the boxless pb-hole)', () => {
    document.body.innerHTML = `
      <pb-hole id="hole-a" data-pb-hole="node-a" data-pb-version="1" style="display:contents"><div class="sk">a</div></pb-hole>
      <pb-hole id="hole-b" data-pb-hole="node-b" data-pb-version="1" style="display:contents"><div class="sk">b</div></pb-hole>
    `

    const observedElements: Element[] = []
    let capturedCallback: ((entries: IntersectionObserverEntry[]) => void) | null = null

    const originalIO = globalThis.IntersectionObserver
    ;(globalThis as Record<string, unknown>).IntersectionObserver = class MockIO {
      constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
        capturedCallback = callback
      }
      observe(el: Element) {
        observedElements.push(el)
      }
      unobserve(_el: Element) {}
      disconnect() {}
      takeRecords() { return [] }
    } as unknown as typeof IntersectionObserver

    try {
      new Function(HOLE_RUNTIME_JS)()

      // Two placeholder children observed — NOT the pb-hole elements themselves.
      expect(observedElements.length).toBe(2)
      expect(observedElements.every((el) => el.tagName === 'DIV')).toBe(true)
      expect(capturedCallback).not.toBeNull()
    } finally {
      ;(globalThis as Record<string, unknown>).IntersectionObserver = originalIO
      document.body.innerHTML = ''
    }
  })

  it('fetches the correct URL and swaps the whole hole when the child intersects', async () => {
    document.body.innerHTML = `
      <pb-hole id="hole-c" data-pb-hole="node-c" data-pb-version="42" style="display:contents"><div class="sk">skeleton</div></pb-hole>
    `

    const fetchedUrls: string[] = []
    const unobservedElements: Element[] = []
    let capturedCallback: ((entries: IntersectionObserverEntry[]) => void) | null = null

    const originalFetch = globalThis.fetch
    const originalIO = globalThis.IntersectionObserver

    ;(globalThis as Record<string, unknown>).fetch = (url: string) => {
      fetchedUrls.push(url)
      return Promise.resolve({ text: () => Promise.resolve('<span>Loaded content</span>') })
    }

    ;(globalThis as Record<string, unknown>).IntersectionObserver = class MockIO {
      constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
        capturedCallback = callback
      }
      observe(_el: Element) {}
      unobserve(el: Element) {
        unobservedElements.push(el)
      }
      disconnect() {}
      takeRecords() { return [] }
    } as unknown as typeof IntersectionObserver

    try {
      new Function(HOLE_RUNTIME_JS)()

      const child = document.querySelector('#hole-c .sk')!

      // The observer fires for the CHILD; the runtime resolves the enclosing
      // <pb-hole> via closest() and swaps it.
      capturedCallback?.([{ isIntersecting: true, target: child } as IntersectionObserverEntry])

      // Flush the fetch → text() → outerHTML promise chain (macrotask).
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(fetchedUrls.length).toBeGreaterThanOrEqual(1)
      const fetchedUrl = fetchedUrls[0]
      expect(fetchedUrl).toContain('/_pb/hole/')
      expect(fetchedUrl).toContain('node-c')
      expect(fetchedUrl).toContain('v=')
      expect(fetchedUrl).toContain('42')
      // The child (the observed target) is unobserved — single-flight.
      expect(unobservedElements.length).toBe(1)
      // The <pb-hole> is replaced by the fetched fragment (skeleton gone,
      // loaded content present).
      expect(document.body.innerHTML).toContain('Loaded content')
      expect(document.body.innerHTML).not.toContain('skeleton')
    } finally {
      ;(globalThis as Record<string, unknown>).fetch = originalFetch
      ;(globalThis as Record<string, unknown>).IntersectionObserver = originalIO
      document.body.innerHTML = ''
    }
  })

  it('eager-fetches a hole that has no placeholder child', async () => {
    document.body.innerHTML = `
      <pb-hole id="hole-e" data-pb-hole="node-e" data-pb-version="7" style="display:contents"></pb-hole>
    `

    const fetchedUrls: string[] = []
    const observedElements: Element[] = []

    const originalFetch = globalThis.fetch
    const originalIO = globalThis.IntersectionObserver

    ;(globalThis as Record<string, unknown>).fetch = (url: string) => {
      fetchedUrls.push(url)
      return Promise.resolve({ text: () => Promise.resolve('<span>x</span>') })
    }
    ;(globalThis as Record<string, unknown>).IntersectionObserver = class MockIO {
      constructor(_callback: (entries: IntersectionObserverEntry[]) => void) {}
      observe(el: Element) {
        observedElements.push(el)
      }
      unobserve(_el: Element) {}
      disconnect() {}
      takeRecords() { return [] }
    } as unknown as typeof IntersectionObserver

    try {
      new Function(HOLE_RUNTIME_JS)()
      await Promise.resolve()
      await Promise.resolve()

      // Nothing observed (no child box); fetched eagerly on load instead.
      expect(observedElements.length).toBe(0)
      expect(fetchedUrls.length).toBe(1)
      expect(fetchedUrls[0]).toContain('node-e')
    } finally {
      ;(globalThis as Record<string, unknown>).fetch = originalFetch
      ;(globalThis as Record<string, unknown>).IntersectionObserver = originalIO
      document.body.innerHTML = ''
    }
  })

  it('does NOT fetch when the observed child is not intersecting', () => {
    document.body.innerHTML = `
      <pb-hole id="hole-d" data-pb-hole="node-d" data-pb-version="1" style="display:contents"><div class="sk">d</div></pb-hole>
    `

    const fetchedUrls: string[] = []
    let capturedCallback: ((entries: IntersectionObserverEntry[]) => void) | null = null

    const originalFetch = globalThis.fetch
    const originalIO = globalThis.IntersectionObserver

    ;(globalThis as Record<string, unknown>).fetch = (url: string) => {
      fetchedUrls.push(url)
      return Promise.resolve({ text: () => Promise.resolve('') })
    }
    ;(globalThis as Record<string, unknown>).IntersectionObserver = class MockIO {
      constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
        capturedCallback = callback
      }
      observe(_el: Element) {}
      unobserve(_el: Element) {}
      disconnect() {}
      takeRecords() { return [] }
    } as unknown as typeof IntersectionObserver

    try {
      new Function(HOLE_RUNTIME_JS)()

      const child = document.querySelector('#hole-d .sk')!
      capturedCallback?.([{ isIntersecting: false, target: child } as IntersectionObserverEntry])

      expect(fetchedUrls.length).toBe(0)
    } finally {
      ;(globalThis as Record<string, unknown>).fetch = originalFetch
      ;(globalThis as Record<string, unknown>).IntersectionObserver = originalIO
      document.body.innerHTML = ''
    }
  })
})
