import { describe, expect, it } from 'bun:test'
import { composeTemplateChain } from '../templateCompose'
import type { Page } from '@core/page-tree'

// Minimal tree builders -----------------------------------------------------
const body = (id: string, children: string[]) => ({ id, moduleId: 'base.body', props: {}, breakpointOverrides: {}, children })
const node = (id: string, moduleId: string, children: string[] = []) => ({ id, moduleId, props: {}, breakpointOverrides: {}, children })

// Layout: body > [header, outlet, footer]
const layout = (): Page => ({
  id: 'layout', slug: 'layout', title: 'Layout', rootNodeId: 'L_body',
  template: { enabled: true, target: { kind: 'everywhere' }, priority: 0 },
  nodes: {
    L_body: body('L_body', ['L_header', 'L_outlet', 'L_footer']),
    L_header: node('L_header', 'base.text'),
    L_outlet: node('L_outlet', 'base.outlet'),
    L_footer: node('L_footer', 'base.text'),
  },
} as unknown as Page)

// Page: body > [p_heading]
const aboutPage = (): Page => ({
  id: 'about', slug: 'about', title: 'About', rootNodeId: 'A_body',
  nodes: { A_body: body('A_body', ['A_heading']), A_heading: node('A_heading', 'base.text') },
} as unknown as Page)

describe('composeTemplateChain', () => {
  it('returns the page unchanged when the chain is empty', () => {
    const merged = composeTemplateChain([], { kind: 'page', page: aboutPage() })
    expect(merged.rootNodeId).toBe('A_body')
    expect(Object.keys(merged.nodes)).toEqual(['A_body', 'A_heading'])
  })

  it('splices a page into the everywhere layout outlet, dropping the page body wrapper', () => {
    const merged = composeTemplateChain([layout()], { kind: 'page', page: aboutPage() })
    expect(merged.rootNodeId).toBe('L_body')
    const root = merged.nodes[merged.rootNodeId]
    // outlet replaced by the page's heading (its base.body wrapper dropped)
    expect(root.children).toHaveLength(3)
    const middleId = root.children[1]
    expect(merged.nodes[middleId].moduleId).toBe('base.text') // the spliced heading
    expect(Object.values(merged.nodes).some((n) => n.moduleId === 'base.outlet')).toBe(false)
  })

  it('migrates a styled page body onto a container instead of dropping its props', () => {
    const styled = aboutPage()
    styled.nodes.A_body = { ...styled.nodes.A_body, props: { background: 'navy' } } as never
    const merged = composeTemplateChain([layout()], { kind: 'page', page: styled })
    const root = merged.nodes[merged.rootNodeId]
    const middle = merged.nodes[root.children[1]]
    // body props preserved on a wrapping container, NOT silently lost
    expect(middle.moduleId).toBe('base.container')
    expect(middle.props).toEqual({ background: 'navy' })
    expect(merged.nodes[middle.children[0]].moduleId).toBe('base.text') // original heading underneath
  })

  it('throws when a template has zero or two outlets', () => {
    const noOutlet = layout()
    noOutlet.nodes.L_body = body('L_body', ['L_header', 'L_footer'])
    delete (noOutlet.nodes as Record<string, unknown>).L_outlet
    expect(() => composeTemplateChain([noOutlet], { kind: 'page', page: aboutPage() })).toThrow()
    const twoOutlets = layout()
    twoOutlets.nodes.L_body = body('L_body', ['L_header', 'L_outlet', 'L_outlet2'])
    twoOutlets.nodes.L_outlet2 = node('L_outlet2', 'base.outlet')
    expect(() => composeTemplateChain([twoOutlets], { kind: 'page', page: aboutPage() })).toThrow()
  })

  it('keeps the innermost outlet for an entry terminal', () => {
    const merged = composeTemplateChain([layout()], { kind: 'entry' })
    // layout is BOTH outer and innermost here; its outlet stays to render the body
    expect(Object.values(merged.nodes).some((n) => n.moduleId === 'base.outlet')).toBe(true)
  })

  it('re-keys inner ids so two chained templates never collide', () => {
    const inner = layout()
    inner.id = 'inner'
    const merged = composeTemplateChain([layout(), inner], { kind: 'entry' })
    const ids = Object.keys(merged.nodes)
    expect(new Set(ids).size).toBe(ids.length) // all unique
  })
})
