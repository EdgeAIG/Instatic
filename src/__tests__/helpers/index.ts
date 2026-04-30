/**
 * Shared test helpers for the page-builder test suite.
 *
 * Exports:
 *   - renderModule()              — safe wrapper around ModuleDefinition.render()
 *   - withBannedGlobals()         — detects forbidden global access in render()
 *   - runModuleConformanceSuite() — registers full contract tests for any ModuleDefinition
 */

import { describe, it, expect } from 'bun:test'
import type { AnyModuleDefinition, PropertyControl } from '../../core/module-engine/types'

// ---------------------------------------------------------------------------
// renderModule
// ---------------------------------------------------------------------------

/**
 * Call def.render() with safe defaults merged with provided props.
 * Prevents "prop is undefined" crashes in tests — merges def.defaults first.
 *
 * NOTE: This helper calls render() directly WITHOUT applying escapeProps().
 * When testing real base modules for XSS safety, use the publisher pipeline:
 *   const safe = escapeProps({ ...mod.defaults, ...props })
 *   const { html } = mod.render(safe, [])
 * See base-modules.test.ts for the correct pattern.
 *
 * This helper is kept without escapeProps to support fixture modules
 * (makeSafeTextModule etc.) that escape their own output for isolation testing.
 *
 * @example
 * const { html } = renderModule(headingModule, { text: 'Hello' })
 * expect(html).toContain('Hello')
 */
export function renderModule(
  def: AnyModuleDefinition,
  props: Record<string, unknown> = {},
  renderedChildren: string[] = []
) {
  return def.render({ ...def.defaults, ...props }, renderedChildren)
}

// ---------------------------------------------------------------------------
// withBannedGlobals — detect forbidden global access inside render()
// ---------------------------------------------------------------------------

/**
 * Globals that render() must NEVER access (Constraint #179: render must be pure).
 * Each is replaced with a throwing Proxy for the duration of the callback.
 */
const BANNED_IN_RENDER = ['document', 'fetch', 'eval'] as const
type BannedGlobal = (typeof BANNED_IN_RENDER)[number]

function makeBannedProxy(globalName: string): object {
  return new Proxy(
    function () {} as object,
    {
      get(_target, prop) {
        throw new Error(
          `[Constraint #179] render() accessed banned global ` +
            `"${globalName}.${String(prop)}" — render() must be a pure function.`
        )
      },
      apply(_target, _thisArg, _args) {
        throw new Error(
          `[Constraint #179] render() called banned global "${globalName}" — ` +
            `render() must be a pure function.`
        )
      },
      construct(_target, _args) {
        throw new Error(
          `[Constraint #179] render() constructed banned global "${globalName}" — ` +
            `render() must be a pure function.`
        )
      },
    }
  )
}

/**
 * Run `fn` with `document`, `fetch`, and `eval` replaced by throwing Proxies.
 * Any access to these globals inside `fn` will throw, causing the test to fail.
 *
 * Use inside an `it()` to assert render() doesn't access DOM globals:
 * @example
 * it('render() does not access document', () => {
 *   expect(() => withBannedGlobals(() => mod.render(mod.defaults, []))).not.toThrow()
 * })
 */
export function withBannedGlobals<T>(fn: () => T): T {
  const saved: Partial<Record<BannedGlobal, unknown>> = {}

  for (const g of BANNED_IN_RENDER) {
    saved[g] = (globalThis as Record<string, unknown>)[g]
    ;(globalThis as Record<string, unknown>)[g] = makeBannedProxy(g)
  }

  try {
    return fn()
  } finally {
    for (const g of BANNED_IN_RENDER) {
      const original = saved[g]
      if (original === undefined) {
        delete (globalThis as Record<string, unknown>)[g]
      } else {
        ;(globalThis as Record<string, unknown>)[g] = original
      }
    }
  }
}

// ---------------------------------------------------------------------------
// activateCondition — helper for URL prop conformance tests
// ---------------------------------------------------------------------------

/**
 * Given a declarative PropertyCondition, return a partial props object that
 * satisfies the condition (so the prop is visible / active in render()).
 *
 * Used by the URL-prop conformance test to ensure conditional URL props
 * (e.g. base.video's `videoUrl` with `condition: { field: 'source', eq: 'url' }`)
 * are actually rendered into HTML, making the safeUrl() call testable.
 *
 * Handles: eq, in, and, or. For notEq/notIn (hard to satisfy generically) returns {}.
 */
function activateCondition(condition: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(condition['and'])) {
    // AND: satisfy all branches
    return Object.assign(
      {},
      ...(condition['and'] as Record<string, unknown>[]).map(activateCondition)
    )
  }
  if (Array.isArray(condition['or']) && (condition['or'] as unknown[]).length > 0) {
    // OR: satisfy the first branch
    return activateCondition((condition['or'] as Record<string, unknown>[])[0])
  }
  if ('eq' in condition && 'field' in condition) {
    return { [condition['field'] as string]: condition['eq'] }
  }
  if ('in' in condition && 'field' in condition && Array.isArray(condition['in'])) {
    return { [condition['field'] as string]: (condition['in'] as unknown[])[0] }
  }
  // notEq / notIn: can't determine a valid value generically — return empty
  return {}
}

// ---------------------------------------------------------------------------
// runModuleConformanceSuite
// ---------------------------------------------------------------------------

/**
 * Register the full Module contract test suite for a given ModuleDefinition.
 * Call this at module-level in your test file — it creates a `describe` block.
 *
 * Covers:
 *   - Identity contract (id format, name, category, version, trusted, canHaveChildren)
 *   - Schema contract (flat keys, plain object)
 *   - render() interface contract (return type, purity)
 *   - Security contract (no banned globals, no raw <script> in default output)
 *   - Children contract (only when canHaveChildren is true)
 *
 * @example
 * import { TextModule } from '@modules/base/text'
 * runModuleConformanceSuite(TextModule)
 */
export function runModuleConformanceSuite(def: AnyModuleDefinition): void {
  describe(`Module conformance — ${def.id}`, () => {
    // ---- Identity ----

    it('id is truthy', () => {
      expect(def.id).toBeTruthy()
    })

    it('id is namespaced (namespace.module-name format, lowercase)', () => {
      // Must be: one or more lowercase-word segments separated by a single dot
      expect(def.id).toMatch(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/)
    })

    it('name is a non-empty string', () => {
      expect(typeof def.name).toBe('string')
      expect(def.name.trim().length).toBeGreaterThan(0)
    })

    it('category is a non-empty string', () => {
      expect(typeof def.category).toBe('string')
      expect(def.category.trim().length).toBeGreaterThan(0)
    })

    it('version is semver-like (e.g. "1.0.0")', () => {
      expect(def.version).toMatch(/^\d+\.\d+\.\d+/)
    })

    it('trusted is a boolean', () => {
      expect(typeof def.trusted).toBe('boolean')
    })

    it('canHaveChildren is a boolean', () => {
      expect(typeof def.canHaveChildren).toBe('boolean')
    })

    // ---- Schema ----

    it('schema is a plain object (not null, not array)', () => {
      expect(def.schema).toBeTruthy()
      expect(typeof def.schema).toBe('object')
      expect(Array.isArray(def.schema)).toBe(false)
    })

    it('schema keys are flat — no dot-path nesting', () => {
      for (const key of Object.keys(def.schema)) {
        expect(key).not.toContain('.')
      }
    })

    // ---- Defaults ----

    it('defaults is a plain object (not null, not array)', () => {
      expect(def.defaults).toBeTruthy()
      expect(typeof def.defaults).toBe('object')
      expect(Array.isArray(def.defaults)).toBe(false)
    })

    // ---- render() interface ----

    it('render() returns an object (not a plain string)', () => {
      const result = def.render(def.defaults, [])
      expect(typeof result).toBe('object')
      expect(result).not.toBeNull()
    })

    it('render() returns { html: string }', () => {
      const result = def.render(def.defaults, [])
      expect(typeof result.html).toBe('string')
    })

    it('render() html is a string (may be empty for content-dependent modules)', () => {
      // Non-emptiness is NOT asserted here — some modules (e.g. base.image)
      // legitimately return { html: '' } when required content (e.g. src) is
      // absent in defaults. Guideline #226: render() must not emit editor-only
      // chrome into published output — an empty string is correct in that case.
      const result = def.render(def.defaults, [])
      expect(typeof result.html).toBe('string')
    })

    it('render() css is string | undefined (no other types)', () => {
      const result = def.render(def.defaults, [])
      if (result.css !== undefined) {
        expect(typeof result.css).toBe('string')
      }
    })

    it('render() is a pure function — same inputs produce same outputs', () => {
      const children = ['<span>child</span>']
      const r1 = def.render(def.defaults, children)
      const r2 = def.render(def.defaults, children)
      expect(r1.html).toBe(r2.html)
      expect(r1.css).toBe(r2.css)
    })

    // ---- Security contract ----

    it('render() does not access document, fetch, or eval (Constraint #179)', () => {
      expect(() =>
        withBannedGlobals(() => def.render(def.defaults, []))
      ).not.toThrow()
    })

    it('render() default output contains no raw <script> tags', () => {
      const { html } = def.render(def.defaults, [])
      expect(/<script[\s>]/i.test(html)).toBe(false)
    })

    it('render() default output contains no inline event handlers (on*=)', () => {
      const { html } = def.render(def.defaults, [])
      expect(/\bon\w+\s*=/i.test(html)).toBe(false)
    })

    // ---- Security contract — URL prop call verification (Constraint #211, Guideline #231) ----
    //
    // For every 'url' or 'image' typed prop in the schema, render with dangerous
    // payloads injected and verify the output does NOT contain the unsafe scheme.
    // This confirms safeUrl() (or equivalent) is CALLED at render time — not just
    // imported. The base.video bug (#445) would have been caught by this test.
    //
    // If a URL prop has a declarative condition (e.g. videoUrl requires source==='url'),
    // we activate that condition so the URL is actually rendered into HTML, making
    // the safeUrl() call exercisable.
    //
    // When the module does NOT render the URL in a given configuration, the unsafe
    // scheme won't appear in the output anyway — the test passes correctly.

    const URL_PROP_TYPES = new Set<PropertyControl['type']>(['url', 'image'])
    const urlPropEntries = Object.entries(def.schema).filter(
      ([, ctrl]) => URL_PROP_TYPES.has(ctrl.type)
    )

    if (urlPropEntries.length > 0) {
      it('url/image-typed props are sanitised at render time — unsafe schemes rejected (Constraint #211)', () => {
        // Vectors that isSafeUrl() must block
        const UNSAFE_VECTORS: Array<{ scheme: string; payload: string }> = [
          { scheme: 'javascript:', payload: 'javascript:alert(1)' },
          { scheme: 'data:',        payload: 'data:text/html,<script>alert(1)</script>' },
          { scheme: 'vbscript:',    payload: 'vbscript:MsgBox(1)' },
          // Tab-normalised javascript: bypass — WHATWG URL parser strips \t from scheme
          { scheme: 'javascript:',  payload: 'java\tscript:alert(1)' },
        ]

        for (const [propKey, ctrl] of urlPropEntries) {
          // If the prop is behind a condition, activate it so the URL appears in HTML
          const activatingProps =
            ctrl.condition ? activateCondition(ctrl.condition as Record<string, unknown>) : {}

          for (const { scheme, payload } of UNSAFE_VECTORS) {
            const testProps = { ...def.defaults, ...activatingProps, [propKey]: payload }
            const { html } = def.render(testProps, [])
            // The unsafe scheme must NOT reach the HTML output
            expect(html).not.toContain(scheme)
          }
        }
      })
    }

    // ---- Children contract ----

    if (def.canHaveChildren) {
      it('render() embeds rendered children HTML in output', () => {
        const childHtml = '<p data-test-child="true">child content</p>'
        const { html } = def.render(def.defaults, [childHtml])
        expect(html).toContain(childHtml)
      })
    }
  })
}
