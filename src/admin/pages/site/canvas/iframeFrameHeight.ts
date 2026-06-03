interface CanvasFrameHeightMetrics {
  bodyScrollHeight: number
  documentScrollHeight: number
  currentFrameHeight: number
}

export function resolveCanvasFrameHeight({
  bodyScrollHeight,
  documentScrollHeight,
  currentFrameHeight,
}: CanvasFrameHeightMetrics): number {
  // `documentElement.scrollHeight` is floored to the iframe viewport height in
  // browsers. After switching from a long page to a short one, that viewport is
  // still the old tall iframe height, so taking max(body, html) preserves the
  // stale frame forever. When html's value is just that viewport floor, trust
  // the body content height so the canvas can shrink.
  if (
    currentFrameHeight > bodyScrollHeight &&
    Math.abs(documentScrollHeight - currentFrameHeight) <= 0.5
  ) {
    return bodyScrollHeight
  }

  // Otherwise keep the larger document measurement; some content only
  // contributes to the html scroll height.
  return Math.max(bodyScrollHeight, documentScrollHeight)
}
