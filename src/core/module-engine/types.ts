import type { ComponentType, ReactNode } from 'react'
import type { CSSPropertyBag } from '../page-tree/types'

// ---------------------------------------------------------------------------
// Property Condition — declarative, JSON-serializable (no function callbacks)
// Constraint #212: condition must NOT be a function — breaks serialization
// ---------------------------------------------------------------------------

export type PropertyCondition =
  | { field: string; eq: unknown }
  | { field: string; notEq: unknown }
  | { field: string; in: unknown[] }
  | { field: string; notIn: unknown[] }
  | { and: PropertyCondition[] }
  | { or: PropertyCondition[] }

// ---------------------------------------------------------------------------
// Property Controls — drive the Properties Panel UI
// ---------------------------------------------------------------------------

export type PropertyControlBase = {
  label: string
  description?: string
  condition?: PropertyCondition
}

export type PropertyControl = PropertyControlBase &
  (
    | { type: 'text'; placeholder?: string }
    | { type: 'textarea'; rows?: number; placeholder?: string }
    | { type: 'number'; min?: number; max?: number; step?: number; unit?: string }
    | { type: 'color'; format?: 'hex' | 'rgba' }
    | { type: 'select'; options: Array<{ label: string; value: unknown }> }
    | { type: 'toggle' }
    | { type: 'image' }
    | { type: 'url' }
    | { type: 'richtext' }
    | { type: 'spacing' }
    | { type: 'group'; collapsed?: boolean; children: PropertySchema }
  )

/**
 * Maps each prop key to a PropertyControl descriptor.
 * Keys must be FLAT — no dot-paths.
 * Use `type: 'group'` for visual grouping only — it does NOT nest the data shape.
 */
export type PropertySchema = Record<string, PropertyControl>

// ---------------------------------------------------------------------------
// Module style bindings — bridge module settings into reusable class styles
// ---------------------------------------------------------------------------

export interface ModuleStyleBinding {
  /** CSSPropertyBag keys this module setting owns when edited on a class. */
  properties: ReadonlyArray<keyof CSSPropertyBag>
  /** Optional label/control override. Defaults to the module schema entry. */
  label?: string
  control?: PropertyControl
  /** Optional initial value when the setting is added from search. */
  defaultValue?: unknown
  /** Convert the control value into a CSSPropertyBag patch. */
  toCSS: (value: unknown, currentStyles: Partial<CSSPropertyBag>) => Partial<CSSPropertyBag>
  /** Read the control value back from the current class styles. */
  fromCSS: (styles: Partial<CSSPropertyBag>) => unknown
  /** Optional custom assigned-state check. Defaults to any owned CSS property being set. */
  isSet?: (styles: Partial<CSSPropertyBag>) => boolean
}

export type ModuleStyleBindings = Record<string, ModuleStyleBinding>

export type ModuleField =
  | { kind: 'prop'; control: PropertyControl }
  | ({ kind: 'style' } & ModuleStyleBinding)

export type ModuleFields = Record<string, ModuleField>

// ---------------------------------------------------------------------------
// Module package dependencies — project manifest, not builder app deps
// ---------------------------------------------------------------------------

export interface ModuleDependencySpec {
  /** Semver/range written to the exported project's package.json. */
  version: string
  /** true writes to devDependencies; false/omitted writes to dependencies. */
  dev?: boolean
}

export type ModuleDependencies = Record<string, string | ModuleDependencySpec>

// ---------------------------------------------------------------------------
// React project export assets — trusted modules only
// ---------------------------------------------------------------------------

export interface ModuleReactExport {
  /** Extra import lines needed by generated React page components. */
  imports?: ReadonlyArray<string>
  /** Top-level declarations emitted once per generated page when this module is used. */
  declarations?: ReadonlyArray<string>
}

// ---------------------------------------------------------------------------
// Editor runtime sandbox — dependency-backed live previews
// ---------------------------------------------------------------------------

export interface ModuleSandboxRuntime {
  /**
   * ESM source executed inside an isolated editor iframe. The module should
   * export `mount(root, context)`. `mount()` may return a cleanup function or
   * `{ update, cleanup }`. Exporting `update(root, context)` is also supported.
   * Implement `update` for seamless property edits without iframe/WebGL reloads.
   */
  source: string
  /** Minimum editor-frame height before class/module CSS overrides apply. */
  minHeight?: number
}

export interface ModuleEditorRuntime {
  sandbox?: ModuleSandboxRuntime
}

// ---------------------------------------------------------------------------
// Render Output — the canonical return type for ModuleDefinition.render()
// Decision #309: render() returns { html, css? } not a plain string
// ---------------------------------------------------------------------------

export interface RenderOutput {
  /** Clean HTML string — no editor code, no React, no framework runtime */
  html: string
  /**
   * Optional scoped CSS for this module TYPE.
   * The publisher deduplicates across all instances (one CSS block per module type).
   */
  css?: string
}

// ---------------------------------------------------------------------------
// Module Component Props — passed to the editor preview component
// ---------------------------------------------------------------------------

export interface ModuleComponentProps<
  TProps extends Record<string, unknown> = Record<string, unknown>,
> {
  props: TProps
  nodeId: string
  isSelected: boolean
  /** Already-rendered child module React nodes */
  children?: ReactNode
  /**
   * Space-separated CSS class string derived from node.classIds
   * (e.g. "mc-abc mc-xyz"). Module editor components must apply this
   * directly to their root JSX element so CSS class rules target the
   * module element instead of the NodeWrapper wrapper div.
   * Task #401 Bug 1 fix.
   */
  mcClassName?: string
}

// ---------------------------------------------------------------------------
// Module Definition — the canonical contract every module must satisfy
// Source of truth: Contribution #309
// ---------------------------------------------------------------------------

export interface ModuleDefinition<
  TProps extends Record<string, unknown> = Record<string, unknown>,
> {
  /**
   * Globally unique, namespaced ID.
   * Format: "{namespace}.{module-name}" — e.g. "base.heading", "acme.hero-banner"
   * Constraint #181: no bare IDs, namespace required.
   */
  id: string

  /** Human-readable display name */
  name: string

  /** Optional description shown in the Module Library */
  description?: string

  /** Category for grouping in the Module Library */
  category: string

  /** Lucide icon name or inline SVG string */
  icon?: string

  /** Semver string e.g. "1.0.0" */
  version: string

  /**
   * Trust level — determines sandbox strategy.
   * true  = base/trusted module → component mounts directly in editor React tree
   * false = community module  → component runs inside <iframe sandbox="allow-scripts">
   *                             with a future postMessage bridge host
   * Constraint #218: decided in Contribution #309
   */
  trusted: boolean

  /**
   * Whether this module can contain child nodes.
   * Replaces the former `slots?: SlotDefinition[]` for MVP simplicity.
   * All children go into a single default slot.
   */
  canHaveChildren: boolean

  /**
   * Declarative property schema — maps prop key → PropertyControl.
   * This is the sole source of truth for the Properties Panel UI.
   * Modules must NOT render their own property controls.
   * Keys must be flat (no dot-paths). Constraint #212.
   */
  schema: PropertySchema

  /** Default property values matching the schema */
  defaults: TProps

  /**
   * Project-level package dependencies required when this module is inserted.
   * These are written to the user's project manifest, not installed into the
   * builder app. Runtime dependencies use string shorthand:
   * `{ three: "^0.184.0" }`; dev dependencies use `{ version, dev: true }`.
   */
  dependencies?: ModuleDependencies

  /**
   * Optional author-facing field manifest. `defineModule()` can derive `schema`
   * and `classStyleBindings` from this, while the editor can still inspect a
   * single list of module-exposed fields.
   */
  fields?: ModuleFields

  /**
   * Optional bridge from module settings to CSS class styles.
   * Use this only for visual/style-backed module props. Content, data, URLs,
   * behavior, and structural settings should remain normal module props.
   */
  classStyleBindings?: ModuleStyleBindings

  /**
   * React component for the editor canvas live preview.
   * - trusted modules: mounted directly in the editor React tree
   * - untrusted modules: rendered via a future iframe bridge host
   * NEVER called by the publisher.
   */
  component: ComponentType<ModuleComponentProps<TProps>>

  /**
   * Optional dependency-backed editor runtime. When present, the canvas renders
   * this module in a sandboxed iframe with an import map built from the module's
   * project dependencies, so packages like `three` do not become builder deps.
   */
  editorRuntime?: ModuleEditorRuntime

  /**
   * PURE FUNCTION — called by the publisher for each node during static export.
   * Constraint #179 (hard): Must have zero side effects.
   * - No React, no ReactDOM, no JSX
   * - No DOM access (no document/window/navigator)
   * - No imports from src/editor/
   * - ALL string props MUST be HTML-escaped before interpolation
   * - MUST reject javascript: URLs in href/src/action attributes
   * Decision #309: returns RenderOutput { html, css? } not a plain string
   */
  render: (props: TProps, renderedChildren: string[]) => RenderOutput

  /**
   * Optional source assets for React Project export. Only trusted modules are
   * allowed to contribute these strings; community modules continue through the
   * safe HTML fallback and cannot inject compiled source.
   */
  reactExport?: ModuleReactExport

  /**
   * OPTIONAL — JSX source-code generation for React Project export (Phase E).
   *
   * Returns a JSX string fragment that, when written into a `.tsx` file and
   * compiled by Vite/React, produces the equivalent UI for this node.
   *
   * `renderedChildren` are already-generated JSX fragments for this node's children.
   * Concatenate them inside the returned JSX (e.g. `<div>{children.join('\n')}</div>`).
   *
   * SECURITY (Constraints #303, #290 — CWE-94 code injection prevention):
   * - User-controlled string props MUST be embedded as {JSON.stringify(value)}.
   *   e.g. `<h2>{${JSON.stringify(props.text)}}</h2>` NOT `<h2>${props.text}</h2>`
   * - Constrained-set props (enums, booleans) and CSS number values may be embedded directly.
   * - Style objects may use { key: "value" } syntax — CSS values are not directly executable.
   *
   * ISOLATION (Constraint #269 / #271):
   * - Must NOT import from src/core/publisher/ or src/editor/.
   *
   * Absence of `toJsx` means the module does not support React Project mode.
   * The module will still appear in the editor but is filtered from the module
   * picker when projectMode === 'react' (Guideline #305).
   * Untrusted community modules must use dangerouslySetInnerHTML fallback (Constraint #304).
   */
  toJsx?: (props: TProps, renderedChildren: string[]) => string
}

// ---------------------------------------------------------------------------
// Module Registry interface
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyModuleDefinition = ModuleDefinition<any>

export interface IModuleRegistry {
  // Uses ModuleDefinition<any> because the registry is a heterogeneous collection —
  // each module has its own TProps type. Type safety is enforced at the call site.
  register(definition: AnyModuleDefinition): void
  get(id: string): AnyModuleDefinition | undefined
  getOrThrow(id: string): AnyModuleDefinition
  has(id: string): boolean
  list(): AnyModuleDefinition[]
  listByCategory(): Record<string, AnyModuleDefinition[]>
}
