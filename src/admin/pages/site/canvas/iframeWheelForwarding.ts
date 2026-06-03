interface TransformedIframeRect {
  left: number
  top: number
  width: number
  height: number
}

interface IframeViewportSize {
  width: number
  height: number
}

interface IframeLocalPoint {
  x: number
  y: number
}

function visualScale(visualSize: number, layoutSize: number): number {
  if (!Number.isFinite(visualSize) || !Number.isFinite(layoutSize) || layoutSize <= 0) {
    return 1
  }
  return visualSize / layoutSize
}

export function iframeWheelPointToParentClientPoint(
  rect: TransformedIframeRect,
  viewport: IframeViewportSize,
  point: IframeLocalPoint,
): IframeLocalPoint {
  return {
    x: rect.left + point.x * visualScale(rect.width, viewport.width),
    y: rect.top + point.y * visualScale(rect.height, viewport.height),
  }
}
