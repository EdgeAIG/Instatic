import { describe, expect, it } from 'bun:test'
import { resolveCanvasFrameHeight } from '@site/canvas/iframeFrameHeight'

describe('resolveCanvasFrameHeight', () => {
  it('shrinks to body content when document scroll height is the previous tall iframe viewport floor', () => {
    expect(resolveCanvasFrameHeight({
      bodyScrollHeight: 320,
      documentScrollHeight: 1200,
      currentFrameHeight: 1200,
    })).toBe(320)
  })

  it('keeps document-only overflow when it is not the current iframe viewport floor', () => {
    expect(resolveCanvasFrameHeight({
      bodyScrollHeight: 320,
      documentScrollHeight: 900,
      currentFrameHeight: 1200,
    })).toBe(900)
  })
})
