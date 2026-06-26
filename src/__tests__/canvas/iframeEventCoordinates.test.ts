import { describe, expect, it } from 'bun:test'
import { iframeLocalPointToParentClientPoint } from '@site/canvas/iframeEventCoordinates'

describe('iframeLocalPointToParentClientPoint', () => {
  it('maps iframe-local event coordinates through the transformed iframe scale', () => {
    const point = iframeLocalPointToParentClientPoint(
      { left: 100, top: 50, width: 800, height: 1200 },
      { width: 1600, height: 2400 },
      { x: 600, y: 900 },
    )

    expect(point).toEqual({ x: 400, y: 500 })
  })

  it('preserves coordinates when the iframe is not visually scaled', () => {
    const point = iframeLocalPointToParentClientPoint(
      { left: 20, top: 30, width: 1440, height: 900 },
      { width: 1440, height: 900 },
      { x: 300, y: 200 },
    )

    expect(point).toEqual({ x: 320, y: 230 })
  })
})
