import { describe, expect, it } from 'bun:test'
import {
  buildPageBuilderToolContext,
  inspectPageClass,
  inspectLayoutSnapshot,
  inspectPageNode,
  searchPageNodes,
} from '../../../server/agentTools'
import type { PageContext } from '../../core/agent/types'

function makeContext(): PageContext {
  return {
    pageTitle: 'Home',
    rootNodeId: 'root',
    selectedNodeId: null,
    activeBreakpointId: 'mobile',
    breakpoints: [
      { id: 'mobile', label: 'Mobile', width: 375, icon: 'smartphone' },
      { id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' },
    ],
    nodes: [
      {
        id: 'root',
        moduleId: 'base.container',
        parentId: null,
        children: ['title'],
        props: { tag: 'main' },
        breakpointOverrides: {},
        classIds: ['cls-hero'],
      },
      {
        id: 'title',
        moduleId: 'base.text',
        parentId: 'root',
        children: [],
        props: { tag: 'h1', text: 'Design tools' },
        breakpointOverrides: {
          mobile: { text: 'Design tools for mobile' },
        },
        classIds: ['cls-title'],
      },
    ],
    availableModules: [
      {
        id: 'base.text',
        name: 'Text',
        category: 'Typography',
        canHaveChildren: false,
        defaults: { tag: 'p', text: 'Text' },
        props: [{ key: 'text', type: 'text', label: 'Text' }],
        styles: [{ key: 'fontSize', type: 'text', label: 'Font size', cssProperties: ['fontSize'] }],
      },
    ],
    classes: [
      {
        id: 'cls-hero',
        name: 'hero-dark',
        styles: { backgroundColor: '#111827', color: '#ffffff' },
      },
      {
        id: 'cls-title',
        name: 'hero-title',
        styles: { fontSize: '56px', lineHeight: '1.05' },
        breakpointStyles: {
          mobile: { fontSize: '36px' },
        },
      },
    ],
    renderSnapshots: [
      {
        breakpointId: 'mobile',
        label: 'Mobile',
        width: 375,
        capturedAt: 123,
        screenshot: {
          status: 'ok',
          mimeType: 'image/png',
          data: 'abc123',
          width: 375,
          height: 600,
        },
        layout: {
          breakpointId: 'mobile',
          viewport: {
            width: 375,
            height: 600,
            scrollWidth: 390,
            scrollHeight: 600,
          },
          nodes: [
            {
              nodeId: 'title',
              moduleId: 'base.text',
              label: undefined,
              text: 'Design tools',
              rect: { x: 8, y: 16, width: 420, height: 64 },
              visible: true,
              computed: {
                display: 'block',
                position: 'static',
                overflow: 'visible',
                color: 'rgb(17, 24, 39)',
                backgroundColor: 'rgba(0, 0, 0, 0)',
                fontSize: '36px',
                lineHeight: '38px',
              },
            },
          ],
          images: [],
          warnings: [
            {
              type: 'horizontal-overflow',
              severity: 'warning',
              message: 'Node extends beyond the breakpoint viewport.',
              nodeId: 'title',
            },
          ],
        },
      },
    ],
  }
}

describe('page-builder agent tools', () => {
  it('builds a dynamic module, class, and page snapshot for MCP discovery tools', () => {
    const snapshot = buildPageBuilderToolContext(makeContext())

    expect(snapshot.modules).toHaveLength(1)
    expect(snapshot.modules[0].id).toBe('base.text')
    expect(snapshot.modules[0].styles[0].cssProperties).toEqual(['fontSize'])

    expect(snapshot.classes).toHaveLength(2)
    expect(snapshot.classes[0]).toEqual({
      id: 'cls-hero',
      name: 'hero-dark',
      styles: { backgroundColor: '#111827', color: '#ffffff' },
    })

    expect(snapshot.activeBreakpointId).toBe('mobile')
    expect(snapshot.breakpoints).toEqual([
      { id: 'mobile', label: 'Mobile', width: 375, icon: 'smartphone' },
      { id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' },
    ])
    expect(snapshot.page.activeBreakpointId).toBe('mobile')
    expect(snapshot.page.breakpoints.map((breakpoint) => breakpoint.id)).toEqual(['mobile', 'desktop'])
    expect(snapshot.page.nodes.map((node) => node.id)).toEqual(['root', 'title'])
    expect(snapshot.renderSnapshots.map((item) => item.breakpointId)).toEqual(['mobile'])
  })

  it('searches existing nodes by text, module, and assigned class name', () => {
    const snapshot = buildPageBuilderToolContext(makeContext())

    const byText = searchPageNodes(snapshot, { query: 'design tools' })
    expect(byText.nodes.map((node) => node.id)).toEqual(['title'])

    const byModuleAndClass = searchPageNodes(snapshot, {
      moduleId: 'base.text',
      className: 'hero-title',
    })
    expect(byModuleAndClass.nodes.map((node) => node.id)).toEqual(['title'])
  })

  it('inspects one node with resolved props and resolved breakpoint class styles', () => {
    const snapshot = buildPageBuilderToolContext(makeContext())

    const inspected = inspectPageNode(snapshot, {
      nodeId: 'title',
      breakpointId: 'mobile',
    })

    expect(inspected.node?.resolvedProps).toEqual({
      tag: 'h1',
      text: 'Design tools for mobile',
    })
    expect(inspected.node?.resolvedClassStyles).toEqual({
      fontSize: '36px',
      lineHeight: '1.05',
    })
    expect(inspected.node?.classes[0].breakpointStyles).toEqual({ fontSize: '36px' })
  })

  it('inspects one class with resolved breakpoint styles and assigned nodes', () => {
    const snapshot = buildPageBuilderToolContext(makeContext())

    const inspected = inspectPageClass(snapshot, {
      classId: 'cls-title',
      breakpointId: 'mobile',
    })

    expect(inspected.class?.resolvedStyles).toEqual({
      fontSize: '36px',
      lineHeight: '1.05',
    })
    expect(inspected.class?.assignedNodes.map((node) => node.id)).toEqual(['title'])
  })

  it('returns captured layout warnings for a breakpoint', () => {
    const snapshot = buildPageBuilderToolContext(makeContext())

    const layout = inspectLayoutSnapshot(snapshot, { breakpointId: 'mobile' })

    expect(layout.layout?.viewport.scrollWidth).toBe(390)
    expect(layout.layout?.warnings[0]).toEqual({
      type: 'horizontal-overflow',
      severity: 'warning',
      message: 'Node extends beyond the breakpoint viewport.',
      nodeId: 'title',
    })
  })
})
