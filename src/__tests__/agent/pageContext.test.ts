import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { useEditorStore } from '@core/editor-store/store'
import { buildPageContext } from '@core/agent/agentSlice'
import { registry } from '@core/module-engine/registry'
import type { AnyModuleDefinition } from '@core/module-engine/types'
import { SquareIcon } from 'pixel-art-icons/icons/square'
import '../../modules/base'

const DYNAMIC_MODULE_ID = 'custom.dynamicHero'

const dynamicModule: AnyModuleDefinition = {
  id: DYNAMIC_MODULE_ID,
  name: 'Dynamic Hero',
  description: 'Runtime registered hero module',
  category: 'Marketing',
  version: '1.0.0',
  icon: SquareIcon,
  trusted: true,
  canHaveChildren: true,
  schema: {
    eyebrow: { type: 'text', label: 'Eyebrow' },
    tone: {
      type: 'select',
      label: 'Tone',
      options: [
        { label: 'Calm', value: 'calm' },
        { label: 'Bold', value: 'bold' },
      ],
    },
  },
  defaults: {
    eyebrow: 'Featured',
    tone: 'bold',
  },
  component: () => null,
  render: () => ({ html: '' }),
}

function freshSite() {
  useEditorStore.setState({
    site: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    hasUnsavedChanges: false,
  })
  const state = useEditorStore.getState()
  const site = state.createSite('Agent Context')
  return site.pages[0]
}

beforeEach(() => {
  registry.registerOrReplace(dynamicModule)
})

afterEach(() => {
  registry.unregister(DYNAMIC_MODULE_ID)
  // One of these tests calls setActiveBreakpoint('mobile'); reset to the
  // default so the next test file doesn't inherit a non-desktop breakpoint
  // (PropertiesPanel routes prop writes to breakpointOverrides at non-desktop).
  useEditorStore.setState({ activeBreakpointId: 'desktop' })
})

describe('buildPageContext — dynamic module registry', () => {
  it('includes runtime-registered modules with defaults and schema metadata', () => {
    const page = freshSite()
    const context = buildPageContext(useEditorStore.getState(), page)

    const moduleContext = context.availableModules.find((mod) => mod.id === DYNAMIC_MODULE_ID)
    expect(moduleContext).toBeDefined()
    expect(moduleContext?.name).toBe('Dynamic Hero')
    expect(moduleContext?.canHaveChildren).toBe(true)
    expect(moduleContext?.defaults).toEqual({ eyebrow: 'Featured', tone: 'bold' })
    expect(moduleContext?.props.some((prop) => prop.key === 'eyebrow' && prop.type === 'text')).toBe(true)
    expect(moduleContext?.props.some((prop) =>
      prop.key === 'tone' &&
      prop.options?.some((option) => option.label === 'Bold' && option.value === 'bold'),
    )).toBe(true)
    // No classStyleBindings system — styles array is empty for non-typography modules
    expect(moduleContext?.styles).toEqual([])
  })

  it('adds typography style hints for text modules', () => {
    const page = freshSite()
    const context = buildPageContext(useEditorStore.getState(), page)

    const textContext = context.availableModules.find((mod) => mod.id === 'base.text')
    expect(textContext).toBeDefined()
    expect(textContext?.styles.some((style) =>
      style.key === 'fontSize' &&
      style.cssProperties.includes('fontSize'),
    )).toBe(true)
    expect(textContext?.styles.some((style) =>
      style.key === 'color' &&
      style.cssProperties.includes('color'),
    )).toBe(true)
  })

  it('includes existing class styles so the agent can inspect what reusable styles actually do', () => {
    const page = freshSite()
    const created = useEditorStore.getState().createClass('hero-dark', {
      backgroundColor: '#111827',
      color: '#ffffff',
      paddingTop: '80px',
    })

    const context = buildPageContext(useEditorStore.getState(), page)
    const classContext = context.classes.find((cls) => cls.id === created.id)

    expect(classContext).toBeDefined()
    expect(classContext?.name).toBe('hero-dark')
    expect(classContext?.styles).toEqual({
      backgroundColor: '#111827',
      color: '#ffffff',
      paddingTop: '80px',
    })
  })

  it('includes configured breakpoints and the active breakpoint', () => {
    const page = freshSite()
    useEditorStore.getState().setActiveBreakpoint('mobile')

    const context = buildPageContext(useEditorStore.getState(), page)

    expect(context.activeBreakpointId).toBe('mobile')
    expect(context.breakpoints.map((breakpoint) => breakpoint.id)).toEqual(['mobile', 'tablet', 'desktop'])
    expect(context.breakpoints.find((breakpoint) => breakpoint.id === 'mobile')).toEqual({
      id: 'mobile',
      label: 'Mobile',
      width: 375,
      icon: 'smartphone',
    })
  })

  it('includes the full page list with active + isHomepage flags', () => {
    const page = freshSite()
    // Add a second page so the list isn't trivial.
    useEditorStore.getState().addPage('About', 'about')
    // Re-activate the original home page so we can assert `active`.
    useEditorStore.setState({ activePageId: page.id })

    const context = buildPageContext(useEditorStore.getState(), page)

    expect(context.pageId).toBe(page.id)
    expect(context.pages).toHaveLength(2)
    const home = context.pages.find((p) => p.id === page.id)
    const about = context.pages.find((p) => p.title === 'About')
    expect(home).toBeDefined()
    expect(home?.active).toBe(true)
    expect(home?.isHomepage).toBe(true) // freshSite's home gets slug 'index'
    expect(about?.active).toBe(false)
    expect(about?.isHomepage).toBe(false)
  })
})
