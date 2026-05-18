import type { ComponentType, ReactNode } from 'react'
import type { IconComponent } from 'pixel-art-icons/types'
import type { PropertySchema } from './propertySchema'

export type {
  PropertyCondition,
  PropertyControl,
  PropertyControlLayout,
  PropertySchema,
} from './propertySchema'

// ---------------------------------------------------------------------------
// Module package dependencies — dependency-backed editor runtimes
// ---------------------------------------------------------------------------

interface ModuleDependencySpec {
  /** Semver/range tracked for dependency-backed module runtimes. */
  version: string
  /** true writes to devDependencies; false/omitted writes to dependencies. */
  dev?: boolean
}

export type ModuleDependencies = Record<string, string | ModuleDependencySpec>

// ---------------------------------------------------------------------------
// Editor runtime sandbox — dependency-backed live previews
// ---------------------------------------------------------------------------

interface ModuleSandboxRuntime {
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

interface ModuleEditorRuntime {
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
   * (e.g. "hero_title cta_button"). Module editor components must apply this
   * directly to their root JSX element so CSS class rules target the
   * module element instead of the NodeWrapper wrapper div.
   * Task #401 Bug 1 fix.
   */
  mcClassName?: string
  /**
   * When true, the canvas has placed this node into inline-edit mode (a user
   * with `site.content.edit` double-clicked it). The module's component
   * should swap its primary content prop for a `contentEditable` element so
   * the user can type directly on the canvas. Commit on blur / Enter, cancel
   * on Escape, via `onCommitInlineEdit` / `onCancelInlineEdit`.
   *
   * Modules that don't opt in simply ignore this prop — falling back to
   * static rendering. Inline editing is opt-in per module type.
   */
  isInlineEditing?: boolean
  /**
   * Commit the inline edit. Modules call this with the new prop bag —
   * partial; only the keys that changed need to be present. The store
   * action `updateNodeProps` is wired up by the canvas / NodeRenderer.
   */
  onCommitInlineEdit?: (partialProps: Record<string, unknown>) => void
  /**
   * Cancel the inline edit (Escape). The module's content should revert to
   * the underlying prop value and exit edit mode. The canvas also clears
   * `inlineEditingNodeId` so the next render is back to static.
   */
  onCancelInlineEdit?: () => void
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
   * Format: "{namespace}.{module-name}" — e.g. "base.text", "acme.hero-banner"
   * Constraint #181: no bare IDs, namespace required.
   */
  id: string

  /** Human-readable display name */
  name: string

  /** Optional description shown in the Module Library */
  description?: string

  /** Category for grouping in the Module Library */
  category: string

  /**
   * Module icon — concrete icon component from `pixel-art-icons`.
   *
   * Single source of truth for the icon shown next to a module everywhere in
   * the editor: layer tree rows, the canvas notch quick actions, the
   * Properties Panel "Module settings" header, and the module picker popover.
   * Use the shared `ModuleIcon` resolver (see `src/editor/ui/ModuleIcon`)
   * instead of consuming `icon` directly when rendering against a moduleId.
   */
  icon: IconComponent

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
   * When true, the canvas allows the user to double-click the rendered node
   * to enter inline-edit mode. The module's `component` is then re-rendered
   * with `isInlineEditing: true` and is expected to swap its primary content
   * prop (label / text / …) for a `contentEditable` element.
   *
   * Inline editing is gated on the caller's `site.content.edit` capability;
   * structural edits (drag, add child, etc.) remain blocked. Modules that
   * opt in MUST implement the `isInlineEditing` / `onCommitInlineEdit` /
   * `onCancelInlineEdit` props in `ModuleComponentProps`.
   */
  inlineEditable?: boolean

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
   * SiteDocument-level package dependencies required when this module is inserted.
   * These are written to the user's site manifest, not installed into the
   * builder app. Runtime dependencies use string shorthand:
   * `{ three: "^0.184.0" }`; dev dependencies use `{ version, dev: true }`.
   */
  dependencies?: ModuleDependencies

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
   * site dependencies, so packages like `three` do not become builder deps.
   */
  editorRuntime?: ModuleEditorRuntime

  /**
   * PURE FUNCTION — called by the CMS publisher for each node during page rendering.
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
   * Display-only hint for which HTML tag this module emits as its root element
   * for the given props. Surfaced in the DOM/Layers panel as a `<tag>` badge
   * next to each row so authors can see the underlying semantics at a glance
   * (e.g. a Container with `tag: 'header'` displays `<header>`; a Button with
   * a non-empty `href` displays `<a>`).
   *
   * Return `null` for modules that don't emit a single deterministic root tag
   * (visual-component-ref, slot-outlet, loop, etc.). The badge is hidden in
   * that case.
   *
   * NOT consumed by the publisher — `render()` remains the source of truth for
   * emitted HTML. This is a pure metadata function for editor display.
   */
  htmlTag?: string | ((props: TProps) => string | null)
}

// ---------------------------------------------------------------------------
// Module Registry interface
// ---------------------------------------------------------------------------

/**
 * Type-erased module shape used by the heterogeneous registry. Every concrete
 * `ModuleDefinition<TProps>` widens to this; the publisher and registry deal
 * with props as `Record<string, unknown>` because at runtime that's all they
 * have. Module authors keep their own narrow `TProps` at the definition site.
 *
 * Conversions from `ModuleDefinition<T>` to `AnyModuleDefinition` happen once
 * at the registry boundary (see `ModuleRegistry.register`), never in user code.
 */
export type AnyModuleDefinition = ModuleDefinition<Record<string, unknown>>

export interface IModuleRegistry {
  // Heterogeneous collection — each module has its own TProps. Module-specific
  // typing lives at the call site; the registry only sees the erased shape.
  register<T extends Record<string, unknown>>(definition: ModuleDefinition<T>): void
  registerOrReplace<T extends Record<string, unknown>>(definition: ModuleDefinition<T>): void
  unregister(id: string): void
  get(id: string): AnyModuleDefinition | undefined
  getOrThrow(id: string): AnyModuleDefinition
  has(id: string): boolean
  list(): AnyModuleDefinition[]
  listByCategory(): Record<string, AnyModuleDefinition[]>
  /** Subscribe to registration changes — used by the editor canvas. */
  subscribe(listener: () => void): () => void
  /** Monotonic counter that bumps on every register / unregister. */
  generation(): number
}
