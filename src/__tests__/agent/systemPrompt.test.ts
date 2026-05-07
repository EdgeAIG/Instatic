/**
 * System prompt builder tests.
 *
 * The system prompt is intentionally minimal: identity + tool family + a
 * tiny per-request page-state suffix. Tool shapes, module registries, class
 * lists, page trees, and render warnings are NOT in the prompt — Claude
 * discovers them via MCP tools (list_modules, inspect_page, list_classes,
 * etc.). This is the canonical Anthropic agent pattern: progressive
 * disclosure via tools, not bulk dumping into context.
 *
 * The prompt is built as a `string[]` with the SDK's
 * `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` marker so the static prefix gets prompt
 * caching while the dynamic suffix changes per turn.
 *
 * Constraint #283/#286: no Anthropic SDK imports.
 */

import { describe, it, expect } from 'bun:test'
import { buildSystemPrompt, SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '@core/agent/systemPrompt'
import type { PageContext } from '@core/agent/types'

function makeContext(overrides: Partial<PageContext> = {}): PageContext {
  return {
    pageTitle: 'Home',
    rootNodeId: 'root-abc',
    activeBreakpointId: 'desktop',
    breakpoints: [],
    nodes: [],
    availableModules: [],
    selectedNodeId: null,
    selectedNodeIds: [],
    classes: [],
    ...overrides,
  }
}

describe('buildSystemPrompt — array shape with cache boundary', () => {
  it('returns a 3-element array [staticPrefix, BOUNDARY, dynamicSuffix]', () => {
    const prompt = buildSystemPrompt(makeContext())
    expect(Array.isArray(prompt)).toBe(true)
    expect(prompt).toHaveLength(3)
    expect(prompt[1]).toBe(SYSTEM_PROMPT_DYNAMIC_BOUNDARY)
  })

  it('exports SYSTEM_PROMPT_DYNAMIC_BOUNDARY as the SDK constant value', () => {
    // Value mirrors the SDK's exported constant. Embedding the literal
    // here keeps src/ free of the Anthropic SDK (Constraint #283).
    expect(SYSTEM_PROMPT_DYNAMIC_BOUNDARY).toBe('__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__')
  })
})

describe('buildSystemPrompt — static prefix (cacheable)', () => {
  it('is byte-identical regardless of page context (cache hits across turns)', () => {
    const a = buildSystemPrompt(makeContext({ pageTitle: 'Home' }))
    const b = buildSystemPrompt(makeContext({ pageTitle: 'Pricing' }))
    expect(a[0]).toBe(b[0])
  })

  it('is byte-identical regardless of selected node, breakpoint, or root id', () => {
    const a = buildSystemPrompt(makeContext({
      rootNodeId: 'r-1', selectedNodeId: 'n-1', activeBreakpointId: 'desktop',
    }))
    const b = buildSystemPrompt(makeContext({
      rootNodeId: 'r-2', selectedNodeId: 'n-2', activeBreakpointId: 'mobile',
    }))
    expect(a[0]).toBe(b[0])
  })

  it('is byte-identical regardless of which classes / modules / nodes the site has', () => {
    // Discovery tools serve module/class/node detail. The prompt prefix MUST
    // NOT vary with these or the cache misses on every site.
    const a = buildSystemPrompt(makeContext({
      classes: [{ id: 'a', name: 'foo' }],
      availableModules: [],
    }))
    const b = buildSystemPrompt(makeContext({
      classes: [{ id: 'b', name: 'bar' }, { id: 'c', name: 'baz' }],
      availableModules: [],
    }))
    expect(a[0]).toBe(b[0])
  })

  it('describes the agent identity and the available tool families', () => {
    const prefix = buildSystemPrompt(makeContext())[0]
    expect(prefix).toContain('visual page builder')
    expect(prefix).toContain('page_builder MCP')
    expect(prefix).toContain('WebFetch')
  })

  it('lists every read tool by name', () => {
    const prefix = buildSystemPrompt(makeContext())[0]
    for (const name of [
      'list_modules', 'list_classes', 'list_breakpoints', 'list_pages',
      'inspect_page', 'search_nodes', 'inspect_node', 'inspect_class',
      'render_snapshot',
    ]) {
      expect(prefix).toContain(name)
    }
  })

  it('lists every write tool by name', () => {
    const prefix = buildSystemPrompt(makeContext())[0]
    for (const name of [
      // Node mutations
      'insertNode', 'insertTree', 'duplicateNode',
      'deleteNode', 'updateNodeProps',
      'moveNode', 'renameNode',
      // Class mutations
      'createClass', 'updateClassStyles', 'assignClass', 'removeClass',
      // Page mutations
      'addPage', 'duplicatePage', 'renamePage', 'deletePage',
    ]) {
      expect(prefix).toContain(name)
    }
  })

  it('declares the filesystem/shell sandbox so Claude does not advertise tools it lacks', () => {
    const prefix = buildSystemPrompt(makeContext())[0]
    expect(prefix).toMatch(/no filesystem or shell access|do NOT have filesystem/i)
  })

  it('does NOT contain the legacy <pb:actions> DSL or per-tool JSON examples', () => {
    const prefix = buildSystemPrompt(makeContext())[0]
    expect(prefix).not.toContain('<pb:actions>')
    expect(prefix).not.toContain('parentRef')
    expect(prefix).not.toContain('nodeRef')
  })

  it('does NOT inline the module / class / breakpoint / page-tree dumps', () => {
    // The whole point of the slim prompt: Claude pulls those via MCP tools.
    const prefix = buildSystemPrompt(makeContext({
      classes: [{ id: 'should-not-appear', name: 'should-not-appear' }],
      availableModules: [{
        id: 'plugin.should-not-appear',
        name: 'Should not appear',
        category: 'X',
        canHaveChildren: false,
        defaults: {},
        props: [],
        styles: [],
      }],
      nodes: [{
        id: 'n-x', moduleId: 'base.text', parentId: null,
        children: [], props: { text: 'should-not-appear' },
        breakpointOverrides: {}, classIds: [],
      }],
    }))[0]
    expect(prefix).not.toContain('should-not-appear')
    expect(prefix).not.toContain('module-registry')
    expect(prefix).not.toContain('class-registry')
    expect(prefix).not.toContain('breakpoint-registry')
    expect(prefix).not.toContain('Page Tree')
  })
})

describe('buildSystemPrompt — dynamic suffix (per-request, tiny)', () => {
  it('carries page title, root id, selected node, and active breakpoint', () => {
    const suffix = buildSystemPrompt(makeContext({
      pageTitle: 'Pricing',
      rootNodeId: 'root-pricing',
      selectedNodeId: 'h1-id',
      activeBreakpointId: 'mobile',
    }))[2]
    expect(suffix).toContain('Pricing')
    expect(suffix).toContain('root-pricing')
    expect(suffix).toContain('h1-id')
    expect(suffix).toContain('mobile')
  })

  it('shows "none" when no node is selected', () => {
    const suffix = buildSystemPrompt(makeContext({ selectedNodeId: null }))[2]
    expect(suffix).toContain('selected: none')
  })

  it('is short — under a few hundred characters', () => {
    // The whole reason to split is so this stays tiny and uncached.
    const suffix = buildSystemPrompt(makeContext({
      pageTitle: 'A reasonably named landing page',
      rootNodeId: 'root-abc-very-long-nanoid-1234567890',
      selectedNodeId: 'node-abc-very-long-nanoid-1234567890',
      activeBreakpointId: 'desktop',
    }))[2]
    expect(suffix.length).toBeLessThan(400)
  })

  it('handles empty page state gracefully', () => {
    const suffix = buildSystemPrompt(makeContext({
      pageTitle: 'Untitled',
      rootNodeId: '',
      selectedNodeId: null,
    selectedNodeIds: [],
      activeBreakpointId: '',
    }))[2]
    expect(() => suffix).not.toThrow()
    expect(suffix).toContain('Untitled')
  })
})
