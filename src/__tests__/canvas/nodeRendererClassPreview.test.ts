import { describe, it, expect } from 'bun:test'
import { getCanvasNodeClassName } from '../../editor/components/Canvas/canvasNodeClassName'
import type { CSSClass } from '../../core/page-tree/types'

function makeClass(id: string, name: string): CSSClass {
  return {
    id,
    name,
    styles: {},
    breakpointStyles: {},
    createdAt: 0,
    updatedAt: 0,
  }
}

const classes = {
  assigned: makeClass('assigned', 'assigned_name'),
  preview: makeClass('preview', 'preview_name'),
}

describe('NodeRenderer class hover preview', () => {
  it('adds a hovered class preview to the matching canvas node className', () => {
    expect(
      getCanvasNodeClassName(
        ['assigned'],
        { nodeId: 'node-1', classId: 'preview' },
        'node-1',
        classes,
      ),
    ).toBe('assigned_name preview_name')
  })

  it('does not add a preview class to other nodes', () => {
    expect(
      getCanvasNodeClassName(
        ['assigned'],
        { nodeId: 'node-2', classId: 'preview' },
        'node-1',
        classes,
      ),
    ).toBe('assigned_name')
  })

  it('does not duplicate a class already assigned to the node', () => {
    expect(
      getCanvasNodeClassName(
        ['assigned', 'preview'],
        { nodeId: 'node-1', classId: 'preview' },
        'node-1',
        classes,
      ),
    ).toBe('assigned_name preview_name')
  })
})
