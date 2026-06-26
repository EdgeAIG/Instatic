/**
 * canvasOverlayGeometry — pure-function tests for the overlay coordinate
 * helpers. `unionCanvasOverlayRects` is fully deterministic and directly
 * testable; `measureCanvasElementRect`'s null/zero-size guards are too. The
 * scaled-measurement path needs a live, transformed iframe (covered by the
 * canvas integration paths), so only the guards are asserted here.
 */
import { describe, it, expect } from 'bun:test'
import {
  measureCanvasElementRect,
  unionCanvasOverlayRects,
  type CanvasOverlayRect,
} from '@site/canvas/canvasOverlayGeometry'

describe('unionCanvasOverlayRects', () => {
  const a: CanvasOverlayRect = { x: 0, y: 0, width: 10, height: 10 }

  it('returns b unchanged when a is null', () => {
    const b: CanvasOverlayRect = { x: 5, y: 5, width: 4, height: 4 }
    expect(unionCanvasOverlayRects(null, b)).toEqual(b)
  })

  it('produces the smallest rect containing both inputs', () => {
    const b: CanvasOverlayRect = { x: 20, y: 30, width: 10, height: 10 }
    expect(unionCanvasOverlayRects(a, b)).toEqual({ x: 0, y: 0, width: 30, height: 40 })
  })

  it('handles a fully-contained rect (union equals the outer rect)', () => {
    const inner: CanvasOverlayRect = { x: 2, y: 2, width: 4, height: 4 }
    expect(unionCanvasOverlayRects(a, inner)).toEqual(a)
  })

  it('handles negative origins', () => {
    const neg: CanvasOverlayRect = { x: -5, y: -5, width: 2, height: 2 }
    expect(unionCanvasOverlayRects(a, neg)).toEqual({ x: -5, y: -5, width: 15, height: 15 })
  })
})

describe('measureCanvasElementRect', () => {
  it('returns null for a null target without touching the iframe', () => {
    // iframe is never read on the null-target fast path, so a bare object is fine.
    const fakeIframe = {} as unknown as HTMLIFrameElement
    expect(measureCanvasElementRect(null, fakeIframe, null)).toBeNull()
  })

  it('adds canvas root scroll offsets for absolute overlay positioning', () => {
    const fakeIframe = {
      offsetWidth: 200,
      getBoundingClientRect: () => testRect({ left: 50, top: 20, width: 100, height: 100 }),
    } as unknown as HTMLIFrameElement
    const fakeCanvasRoot = {
      scrollLeft: 30,
      scrollTop: 5,
      getBoundingClientRect: () => testRect({ left: 10, top: 10, width: 500, height: 400 }),
    } as unknown as HTMLElement
    const fakeTarget = {
      getBoundingClientRect: () => testRect({ left: 20, top: 40, width: 60, height: 80 }),
    } as unknown as HTMLElement

    expect(measureCanvasElementRect(fakeTarget, fakeIframe, fakeCanvasRoot)).toEqual({
      x: 80,
      y: 35,
      width: 30,
      height: 40,
    })
  })
})

function testRect(rect: {
  left: number
  top: number
  width: number
  height: number
}): DOMRect {
  return {
    ...rect,
    x: rect.left,
    y: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    toJSON: () => ({}),
  } as DOMRect
}
