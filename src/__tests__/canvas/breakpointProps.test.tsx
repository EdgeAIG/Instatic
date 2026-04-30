import { describe, expect, it, beforeEach } from 'bun:test'
import { render, screen, cleanup } from '@testing-library/react'
import { useEditorStore } from '../../core/editor-store/store'
import { BreakpointFrame } from '../../editor/components/Canvas/BreakpointFrame'
import '../../modules/base'

beforeEach(() => {
  cleanup()
  useEditorStore.setState({
    project: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    selectedNodeId: null,
    hoveredNodeId: null,
    activeDocument: null,
    activePageId: null,
    hasUnsavedChanges: false,
  })
})

describe('canvas breakpoint rendering', () => {
  it('renders node breakpoint prop overrides inside the matching breakpoint frame', () => {
    const project = useEditorStore.getState().createProject('Breakpoint Props')
    const page = project.pages[0]
    const rootId = page.rootNodeId
    const textId = useEditorStore.getState().insertNode('base.text', {
      text: 'Desktop headline',
      tag: 'h1',
    }, rootId)
    useEditorStore.getState().setBreakpointOverride(textId, 'mobile', {
      text: 'Mobile headline',
    })

    render(
      <BreakpointFrame
        page={useEditorStore.getState().project!.pages[0]}
        breakpoint={{ id: 'mobile', label: 'Mobile', width: 375, icon: 'smartphone' }}
        isActive
        onActivate={() => {}}
      />,
    )

    expect(screen.getByText('Mobile headline')).toBeTruthy()
    expect(screen.queryByText('Desktop headline')).toBeNull()
  })
})
