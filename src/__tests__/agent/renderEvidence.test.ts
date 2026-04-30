import { describe, expect, it, beforeEach } from 'bun:test'
import { collectAgentRenderSnapshots } from '../../core/agent/renderEvidence'

beforeEach(() => {
  document.body.innerHTML = ''
})

function setRect(el: Element, rect: Partial<DOMRectReadOnly>) {
  const full = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: rect.y ?? 0,
    left: rect.x ?? 0,
    right: (rect.x ?? 0) + (rect.width ?? 0),
    bottom: (rect.y ?? 0) + (rect.height ?? 0),
    toJSON: () => ({}),
    ...rect,
  } as DOMRect
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => full,
  })
}

describe('collectAgentRenderSnapshots', () => {
  it('captures breakpoint layout, node boxes, and overflow warnings from the canvas DOM', async () => {
    const viewport = document.createElement('div')
    viewport.dataset.breakpointId = 'mobile'
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 375 },
      clientHeight: { configurable: true, value: 600 },
      scrollWidth: { configurable: true, value: 420 },
      scrollHeight: { configurable: true, value: 600 },
    })
    setRect(viewport, { x: 0, y: 0, width: 375, height: 600 })

    const wrapper = document.createElement('div')
    wrapper.dataset.nodeId = 'title'
    wrapper.dataset.moduleId = 'base.text'
    wrapper.textContent = 'Overflowing headline'
    setRect(wrapper, { x: 8, y: 16, width: 420, height: 64 })
    viewport.appendChild(wrapper)
    document.body.appendChild(viewport)

    const snapshots = await collectAgentRenderSnapshots({
      breakpoints: [{ id: 'mobile', label: 'Mobile', width: 375, icon: 'smartphone' }],
      captureScreenshots: false,
    })

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].layout.viewport.scrollWidth).toBe(420)
    expect(snapshots[0].layout.nodes[0].nodeId).toBe('title')
    expect(snapshots[0].layout.warnings.some((warning) =>
      warning.type === 'horizontal-overflow' && warning.nodeId === 'title',
    )).toBe(true)
  })
})
