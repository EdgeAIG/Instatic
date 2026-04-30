import type {
  AgentBreakpointContext,
  AgentLayoutImageContext,
  AgentLayoutNodeContext,
  AgentLayoutRect,
  AgentLayoutReportContext,
  AgentLayoutWarningContext,
  AgentRenderSnapshotContext,
  AgentScreenshotContext,
} from './types'

interface CollectAgentRenderSnapshotsOptions {
  breakpoints: AgentBreakpointContext[]
  captureScreenshots?: boolean
  maxScreenshotCount?: number
}

const MAX_TEXT_LENGTH = 300
const OVERFLOW_TOLERANCE_PX = 2

export async function collectAgentRenderSnapshots({
  breakpoints,
  captureScreenshots = true,
  maxScreenshotCount = 3,
}: CollectAgentRenderSnapshotsOptions): Promise<AgentRenderSnapshotContext[]> {
  if (typeof document === 'undefined') return []

  const frames = Array.from(
    document.querySelectorAll<HTMLElement>('[data-breakpoint-id]'),
  )

  const snapshots: AgentRenderSnapshotContext[] = []
  for (const frame of frames) {
    const breakpointId = frame.dataset.breakpointId
    if (!breakpointId) continue

    const breakpoint = breakpoints.find((item) => item.id === breakpointId)
    const layout = collectLayoutReport(frame, breakpointId)
    const shouldCapture = captureScreenshots && snapshots.length < maxScreenshotCount
    const screenshot = shouldCapture
      ? await captureFrameScreenshot(frame)
      : unavailableScreenshot('Screenshot capture skipped for this breakpoint.')

    snapshots.push({
      breakpointId,
      label: breakpoint?.label ?? breakpointId,
      width: breakpoint?.width ?? Math.round(frame.getBoundingClientRect().width),
      capturedAt: Date.now(),
      screenshot,
      layout,
    })
  }

  return snapshots
}

function collectLayoutReport(frame: HTMLElement, breakpointId: string): AgentLayoutReportContext {
  const frameRect = frame.getBoundingClientRect()
  const viewport = {
    width: Math.round(frameRect.width || frame.clientWidth),
    height: Math.round(frameRect.height || frame.clientHeight),
    scrollWidth: frame.scrollWidth,
    scrollHeight: frame.scrollHeight,
  }

  const warnings: AgentLayoutWarningContext[] = []
  if (frame.scrollWidth > frame.clientWidth + OVERFLOW_TOLERANCE_PX) {
    warnings.push({
      type: 'horizontal-overflow',
      severity: 'warning',
      message: 'The breakpoint viewport has horizontal overflow.',
    })
  }
  if (frame.scrollHeight > frame.clientHeight + OVERFLOW_TOLERANCE_PX) {
    warnings.push({
      type: 'vertical-overflow',
      severity: 'info',
      message: 'The breakpoint viewport has vertical overflow.',
    })
  }

  const nodes = Array.from(frame.querySelectorAll<HTMLElement>('[data-node-id]'))
    .map((nodeEl) => collectNodeLayout(frameRect, viewport, nodeEl, warnings))

  const images = Array.from(frame.querySelectorAll<HTMLImageElement>('img'))
    .map((img) => collectImageLayout(frameRect, img, warnings))

  return {
    breakpointId,
    viewport,
    nodes,
    images,
    warnings,
  }
}

function collectNodeLayout(
  frameRect: DOMRect,
  viewport: AgentLayoutReportContext['viewport'],
  nodeEl: HTMLElement,
  warnings: AgentLayoutWarningContext[],
): AgentLayoutNodeContext {
  const rect = relativeRect(frameRect, nodeEl.getBoundingClientRect())
  const contentEl = nodeEl.firstElementChild instanceof HTMLElement
    ? nodeEl.firstElementChild
    : nodeEl
  const computed = getComputedStyle(contentEl)
  const text = trimText(nodeEl.textContent ?? '')
  const visible = rect.width > 0 && rect.height > 0 && computed.display !== 'none' && computed.visibility !== 'hidden'
  const nodeId = nodeEl.dataset.nodeId ?? ''

  if (!visible && text) {
    warnings.push({
      type: 'invisible-node',
      severity: 'warning',
      message: 'Node has text content but no visible layout box.',
      nodeId,
    })
  }

  if (rect.x < -OVERFLOW_TOLERANCE_PX || rect.x + rect.width > viewport.width + OVERFLOW_TOLERANCE_PX) {
    warnings.push({
      type: 'horizontal-overflow',
      severity: 'warning',
      message: 'Node extends beyond the breakpoint viewport.',
      nodeId,
    })
  }

  if (
    (computed.overflow === 'hidden' || computed.overflowX === 'hidden' || computed.overflowY === 'hidden') &&
    (contentEl.scrollWidth > contentEl.clientWidth + OVERFLOW_TOLERANCE_PX ||
      contentEl.scrollHeight > contentEl.clientHeight + OVERFLOW_TOLERANCE_PX)
  ) {
    warnings.push({
      type: 'hidden-overflow',
      severity: 'warning',
      message: 'Node content appears clipped by hidden overflow.',
      nodeId,
    })
  }

  return {
    nodeId,
    moduleId: nodeEl.dataset.moduleId,
    label: nodeEl.getAttribute('aria-label') ?? undefined,
    text,
    rect,
    visible,
    computed: {
      display: computed.display,
      position: computed.position,
      overflow: computed.overflow,
      color: computed.color,
      backgroundColor: computed.backgroundColor,
      fontSize: computed.fontSize,
      lineHeight: computed.lineHeight,
    },
  }
}

function collectImageLayout(
  frameRect: DOMRect,
  img: HTMLImageElement,
  warnings: AgentLayoutWarningContext[],
): AgentLayoutImageContext {
  const wrapper = img.closest<HTMLElement>('[data-node-id]')
  const nodeId = wrapper?.dataset.nodeId
  const image: AgentLayoutImageContext = {
    nodeId,
    src: img.currentSrc || img.src,
    alt: img.alt || undefined,
    complete: img.complete,
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    rect: relativeRect(frameRect, img.getBoundingClientRect()),
  }

  if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) {
    warnings.push({
      type: 'broken-image',
      severity: 'warning',
      message: 'Image is not loaded or has no natural dimensions.',
      nodeId,
    })
  }

  return image
}

async function captureFrameScreenshot(frame: HTMLElement): Promise<AgentScreenshotContext> {
  try {
    const { toPng } = await import('html-to-image')
    const rect = frame.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      return unavailableScreenshot('Frame has no visible size.')
    }

    const pixelRatio = Math.min(1, 900 / Math.max(1, rect.width))
    const dataUrl = await toPng(frame, {
      cacheBust: true,
      pixelRatio,
      backgroundColor: '#ffffff',
      imagePlaceholder: '',
    })
    const marker = 'base64,'
    const markerIndex = dataUrl.indexOf(marker)
    return {
      status: 'ok',
      mimeType: 'image/png',
      data: markerIndex >= 0 ? dataUrl.slice(markerIndex + marker.length) : dataUrl,
      width: Math.round(rect.width * pixelRatio),
      height: Math.round(rect.height * pixelRatio),
    }
  } catch (err) {
    return {
      status: 'error',
      error: err instanceof Error ? err.message : 'Screenshot capture failed.',
    }
  }
}

function unavailableScreenshot(error: string): AgentScreenshotContext {
  return {
    status: 'unavailable',
    error,
  }
}

function relativeRect(frameRect: DOMRectReadOnly, rect: DOMRectReadOnly): AgentLayoutRect {
  return {
    x: round(rect.left - frameRect.left),
    y: round(rect.top - frameRect.top),
    width: round(rect.width),
    height: round(rect.height),
  }
}

function trimText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > MAX_TEXT_LENGTH
    ? `${normalized.slice(0, MAX_TEXT_LENGTH - 1)}...`
    : normalized
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
