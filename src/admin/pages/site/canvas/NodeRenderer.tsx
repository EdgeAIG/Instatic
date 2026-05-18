/**
 * NodeRenderer — renders a single PageNode in the editor canvas.
 *
 * Performance notes (Contribution #312 + #495):
 * ─────────────────────────────────────────────
 * - memo() prevents re-renders when unrelated nodes change.
 * - Per-node Zustand selector: subscribes ONLY to the specific node's data.
 *   Editing node A never re-renders NodeRenderer for node B.
 * - Selection/hover handled via CanvasSelectionContext (no DOM event bubbling).
 * - selectedNodeId / hoveredNodeId are NOT in context (Perf fix #495):
 *   Each NodeRenderer subscribes directly to its own boolean — only the 2
 *   affected nodes re-render per selection/hover event (O(2) not O(N)).
 */

import { memo, useCallback, useContext, useSyncExternalStore } from 'react'
import { useEditorStore, selectActiveCanvasPage } from '@site/store/store'
import { resolveProps } from '@core/page-tree/selectors'
import { registry } from '@core/module-engine/registry'
import { resolveDynamicProps, type TemplateRenderDataContext } from '@core/templates/dynamicBindings'
import type { PageNode } from '@core/page-tree/schemas'
import { WarningDiamondSolidIcon } from 'pixel-art-icons/icons/warning-diamond-solid'
import { ErrorBoundary } from '@ui/components/ErrorBoundary'
import { ModuleSandboxFrame } from './ModuleSandboxFrame'
import { CanvasBreakpointContext, CanvasSelectionContext, CanvasTemplateContext } from './CanvasContexts'
import { getCanvasNodeClassIds, getCanvasNodeClassName } from './canvasNodeClassName'
import { findEnclosingComponentRef, type AnnotatedPageNode } from './canvasSelectionUtils'
import { useLoopPreviewItems } from './useLoopPreviewItems'
import styles from './NodeRenderer.module.css'

// ---------------------------------------------------------------------------
// NodeRenderer
// ---------------------------------------------------------------------------

interface NodeRendererProps {
  nodeId: string
}

export const NodeRenderer = memo(function NodeRenderer({ nodeId }: NodeRendererProps) {
  // Per-node subscription — editing this node's props only re-renders THIS component.
  // Uses selectActiveCanvasPage (Task #438) so VC canvas mode works alongside page mode.
  const node = useEditorStore(
    useCallback((s) => selectActiveCanvasPage(s)?.nodes[nodeId] ?? null, [nodeId]),
  )
  const breakpointId = useContext(CanvasBreakpointContext)
  const templateContext = useContext(CanvasTemplateContext)

  // Per-node selection/hover subscriptions (Perf fix — Contribution #495).
  // Only the 2 nodes whose boolean flips will re-render on any selection/hover
  // event. Context carries only stable callbacks — no context-driven re-renders.
  //
  // Multi-select: this checks `selectedNodeIds.includes(nodeId)` so every node
  // in a multi-selection shows the selection ring. The selector still resolves
  // to a boolean, so per-node memoization isn't disturbed — only rows whose
  // `includes(nodeId)` result flips will re-render.
  const isSelected = useEditorStore(
    useCallback((s) => s.selectedNodeIds.includes(nodeId), [nodeId]),
  )
  const isHovered = useEditorStore(
    useCallback(
      (s) =>
        s.hoveredNodeId === nodeId &&
        (!s.hoveredBreakpointId || s.hoveredBreakpointId === breakpointId),
      [nodeId, breakpointId],
    ),
  )
  const previewClassAssignment = useEditorStore(
    useCallback(
      (s) => s.previewClassAssignment?.nodeId === nodeId ? s.previewClassAssignment : null,
      [nodeId],
    ),
  )
  const mcClassName = useEditorStore(
    useCallback((s) => {
      const canvasNode = selectActiveCanvasPage(s)?.nodes[nodeId]
      const preview = s.previewClassAssignment?.nodeId === nodeId ? s.previewClassAssignment : null
      return getCanvasNodeClassName(canvasNode?.classIds, preview, nodeId, s.site?.classes)
    }, [nodeId]),
  )
  // Inline-edit gate — when the editor's inlineEditingNodeId matches this
  // node, the module's component renders contentEditable for its primary
  // content prop. Set by the canvas double-click handler.
  const isInlineEditing = useEditorStore(
    useCallback((s) => s.inlineEditingNodeId === nodeId, [nodeId]),
  )
  const updateNodeProps = useEditorStore((s) => s.updateNodeProps)
  const setInlineEditing = useEditorStore((s) => s.setInlineEditing)
  const commitInlineEdit = useCallback(
    (partial: Record<string, unknown>) => {
      updateNodeProps(nodeId, partial)
      setInlineEditing(null)
    },
    [nodeId, updateNodeProps, setInlineEditing],
  )
  const cancelInlineEdit = useCallback(() => {
    setInlineEditing(null)
  }, [setInlineEditing])

  const { onNodeClick, onNodeHover, onNodeContextMenu, onNodeDoubleClick } = useContext(CanvasSelectionContext)

  const handleNodeClick = useCallback(
    (clickedNodeId: string, e: React.MouseEvent) => {
      // B3 — VC lock-down: redirect clicks inside inlined VC bodies to the ref node.
      // Imperative store access is correct here (event handler, not render path).
      const state = useEditorStore.getState()
      if (state.activeDocument?.kind !== 'visualComponent') {
        const page = selectActiveCanvasPage(state)
        if (page) {
          const enclosing = findEnclosingComponentRef(
            page.nodes as Record<string, AnnotatedPageNode>,
            clickedNodeId,
          )
          if (enclosing !== null && !enclosing.isInsideSlotContent) {
            // Clicked inside a VC body (not slot content) — route to the ref.
            onNodeClick(enclosing.refId, e, breakpointId)
            return
          }
        }
      }
      onNodeClick(clickedNodeId, e, breakpointId)
    },
    [breakpointId, onNodeClick],
  )

  const handleNodeContextMenu = useCallback(
    (clickedNodeId: string, e: React.MouseEvent) => {
      onNodeContextMenu(clickedNodeId, e, breakpointId)
    },
    [breakpointId, onNodeContextMenu],
  )

  const handleNodeHover = useCallback(
    (hoveredNodeId: string | null) => {
      if (hoveredNodeId !== null) {
        // B3 — VC lock-down: clamp hover ring to the ref node for VC body nodes.
        const state = useEditorStore.getState()
        if (state.activeDocument?.kind !== 'visualComponent') {
          const page = selectActiveCanvasPage(state)
          if (page) {
            const enclosing = findEnclosingComponentRef(
              page.nodes as Record<string, AnnotatedPageNode>,
              hoveredNodeId,
            )
            if (enclosing !== null && !enclosing.isInsideSlotContent) {
              onNodeHover(enclosing.refId, breakpointId)
              return
            }
          }
        }
      }
      onNodeHover(hoveredNodeId, breakpointId)
    },
    [breakpointId, onNodeHover],
  )

  // Subscribe to module registry changes so plugin module packs that activate
  // after the canvas mounted trigger a re-render — otherwise the canvas would
  // freeze on `Unknown module` even after the registry receives the module.
  useSyncExternalStore(
    registry.subscribe.bind(registry),
    registry.generation.bind(registry),
    registry.generation.bind(registry),
  )

  if (!node) return null
  if (node.hidden) return null

  const definition = registry.get(node.moduleId)
  if (!definition) {
    return (
      <div
        className={styles.unknownModule}
        title={`Unknown module: ${node.moduleId}`}
      >
        <WarningDiamondSolidIcon size={14} /> Unknown module: {node.moduleId}
      </div>
    )
  }

  // Render children recursively. For `base.loop` nodes, delegate to a
  // dedicated component (`LoopIterationsPreview`) that uses hooks to fetch
  // real iteration data via the CMS API and round-robins variants across
  // iterations. Each iteration pushes a real LoopItem onto the entry stack
  // via a nested CanvasTemplateContext.Provider so dynamic bindings inside
  // the loop body resolve against the iteration item — same semantics as
  // the publisher's renderLoop().
  const children =
    node.moduleId === 'base.loop' && node.children.length > 0 ? (
      <LoopIterationsPreview node={node} baseTemplateContext={templateContext} />
    ) : (
      node.children.map((childId) => <NodeRenderer key={childId} nodeId={childId} />)
    )

  const ComponentType = definition.component
  const shouldRenderSandbox = Boolean(definition.editorRuntime?.sandbox && !definition.trusted)
  // Pass the module schema so resolveProps drops breakpoint overrides for
  // non-responsive (content) keys — text/tag/src etc. must look identical
  // across every breakpoint frame, since published HTML is one document.
  const effectiveProps = resolveDynamicProps(
    resolveProps(node, breakpointId, definition.schema),
    node.dynamicBindings,
    templateContext,
  )

  // Build className from classIds using the user-facing class names.
  const effectiveClassIds = getCanvasNodeClassIds(node.classIds, previewClassAssignment, nodeId)

  return (
    <NodeWrapper
      nodeId={nodeId}
      moduleId={node.moduleId}
      isSelected={isSelected}
      isHovered={isHovered}
      onNodeClick={handleNodeClick}
      onNodeHover={handleNodeHover}
      onNodeContextMenu={handleNodeContextMenu}
      onNodeDoubleClick={onNodeDoubleClick}
    >
      {/*
        Per-module isolation: a buggy first-party or third-party module
        render must not collapse the entire canvas. The boundary scope is
        scoped to the module render path; selection chrome (NodeWrapper)
        and the rest of the page tree keep working. resetKey on the
        moduleId means an editor swap to a different module clears
        any stuck error.
        silentToast: the canvas-level boundary already toasts, and a
        100-node page with one bad module would otherwise produce 100
        identical toasts on every render.
      */}
      <ErrorBoundary
        location="node-renderer"
        resetKeys={[node.moduleId, nodeId]}
        silentToast
      >
        {/* mcClassName forwarded to the module component so the CSS class targets
            the module's own root element (button, div, etc.) rather than the
            NodeWrapper wrapper div. Task #401 Bug 1 fix. */}
        {shouldRenderSandbox ? (
          <ModuleSandboxFrame
            moduleDefinition={definition}
            props={effectiveProps}
            nodeId={nodeId}
            isSelected={isSelected}
            mcClassName={mcClassName}
            classIds={effectiveClassIds}
          />
        ) : (
          <ComponentType
            props={effectiveProps as never}
            nodeId={nodeId}
            isSelected={isSelected}
            mcClassName={mcClassName}
            isInlineEditing={isInlineEditing}
            onCommitInlineEdit={commitInlineEdit}
            onCancelInlineEdit={cancelInlineEdit}
          >
            {children}
          </ComponentType>
        )}
      </ErrorBoundary>
    </NodeWrapper>
  )
})

// ---------------------------------------------------------------------------
// Loop iteration preview
// ---------------------------------------------------------------------------

interface LoopIterationsPreviewProps {
  node: PageNode
  baseTemplateContext?: TemplateRenderDataContext
}

/**
 * Render a `base.loop` node's children once per real iteration item.
 *
 * Mirrors the publisher's `renderLoop()` in `src/core/publisher/render.ts`:
 *   - Round-robin children when N variants × M items.
 *   - Augmented `templateContext` per iteration via Context.Provider, so
 *     dynamic bindings inside the loop body resolve to the iteration's
 *     `currentEntry`.
 *
 * Iteration data comes from `useLoopPreviewItems`, which dispatches per
 * source: built-in sources (`content.entries`, `site.media`) fetch real
 * data via the CMS API; in-memory sources (`site.pages`) read directly
 * from the store; plugin sources fall back to their `preview()` method.
 *
 * Empty result (source not picked yet, no rows, fetch in flight) renders
 * nothing — same as the publisher's empty-loop behaviour. Once data
 * arrives the component re-renders with real iterations.
 */
function LoopIterationsPreview({ node, baseTemplateContext }: LoopIterationsPreviewProps) {
  const items = useLoopPreviewItems(node)
  if (items.length === 0) return null

  const baseStack = baseTemplateContext?.entryStack ?? []
  return (
    <>
      {items.map((item, i) => {
        const variantId = node.children[i % node.children.length]
        // Preserve the parent's `page` / `site` / `viewer` / `route`
        // frames so bindings against those sources keep resolving
        // inside loop iterations. Only the entry stack changes per
        // iteration — push the iteration item on top.
        const augmentedContext: TemplateRenderDataContext = {
          ...baseTemplateContext,
          entryStack: [...baseStack, item],
        }
        return (
          <CanvasTemplateContext.Provider
            key={`${variantId}-${i}-${item.id}`}
            value={augmentedContext}
          >
            <NodeRenderer nodeId={variantId} />
          </CanvasTemplateContext.Provider>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
// NodeWrapper — click/hover target, selection ring
// ---------------------------------------------------------------------------

// Exported for testing (keyboard navigation, ARIA attributes)
interface NodeWrapperProps {
  nodeId: string
  moduleId?: string
  isSelected: boolean
  isHovered: boolean
  onNodeClick: (nodeId: string, e: React.MouseEvent) => void
  onNodeHover: (nodeId: string | null) => void
  onNodeContextMenu: (nodeId: string, e: React.MouseEvent) => void
  /**
   * Double-click handler — used for base.visual-component-ref to enter VC canvas mode.
   * Defaults to no-op; provided by CanvasRoot via CanvasSelectionContext.
   */
  onNodeDoubleClick: (nodeId: string, e: React.MouseEvent) => void
  children: React.ReactNode
  // NOTE: mcClassName intentionally NOT here — it is forwarded to the module
  // ComponentType so CSS classes target the module's own root element.
  // Task #401 Bug 1 fix. Previously mcClassName was on NodeWrapper's div which
  // caused CSS classes to style the wrapper instead of the button/heading/etc.
}

// Exported for testing — allows direct unit tests of WCAG attributes and
// keyboard handlers without needing the full Zustand store.
export const NodeWrapper = memo(function NodeWrapper({
  nodeId,
  moduleId,
  isSelected,
  isHovered,
  onNodeClick,
  onNodeHover,
  onNodeContextMenu,
  onNodeDoubleClick,
  children,
}: NodeWrapperProps) {
  return (
    <div
      data-node-id={nodeId}
      data-module-id={moduleId}
      className={styles.nodeWrapper}
      // ─── Accessibility (WCAG 2.1 AA, SC 2.1.1) ──────────────────────────
      // Canvas nodes are selectable interactive elements. role="button" is
      // correct here — NOT role="treeitem". The tree representation of the
      // document hierarchy lives in the DOM Panel (J6) which owns the
      // role="tree" / role="treeitem" semantics. Using role="treeitem" on
      // canvas elements without a role="tree" parent is an ARIA ownership
      // violation (WCAG SC 4.1.2). aria-pressed communicates selection state
      // for a toggle-button pattern (pressed = selected).
      tabIndex={0}
      role="button"
      aria-pressed={isSelected}
      data-hovered={isHovered && !isSelected ? 'true' : undefined}
      onClickCapture={(e) => {
        if (!isClosestCanvasNodeTarget(e.target, e.currentTarget)) return
        if (isCanvasEditorControlTarget(e.target, e.currentTarget)) return
        e.preventDefault()
        e.stopPropagation()
        onNodeClick(nodeId, e)
      }}
      onClick={(e) => {
        if (!isClosestCanvasNodeTarget(e.target, e.currentTarget)) return
        if (isCanvasEditorControlTarget(e.target, e.currentTarget)) {
          e.stopPropagation()
          return
        }
        e.preventDefault()
        e.stopPropagation() // prevent canvas deselect from firing
        onNodeClick(nodeId, e)
      }}
      onDoubleClickCapture={(e) => {
        if (!isClosestCanvasNodeTarget(e.target, e.currentTarget)) return
        if (isCanvasEditorControlTarget(e.target, e.currentTarget)) return
        e.preventDefault()
        e.stopPropagation()
        onNodeDoubleClick(nodeId, e)
      }}
      onDoubleClick={(e) => {
        if (!isClosestCanvasNodeTarget(e.target, e.currentTarget)) return
        if (isCanvasEditorControlTarget(e.target, e.currentTarget)) {
          e.stopPropagation()
          return
        }
        e.preventDefault()
        e.stopPropagation()
        onNodeDoubleClick(nodeId, e)
      }}
      onContextMenuCapture={(e) => {
        if (!isClosestCanvasNodeTarget(e.target, e.currentTarget)) return
        if (isCanvasEditorControlTarget(e.target, e.currentTarget)) return
        e.preventDefault()
        e.stopPropagation()
        onNodeContextMenu(nodeId, e)
      }}
      onContextMenu={(e) => {
        if (!isClosestCanvasNodeTarget(e.target, e.currentTarget)) return
        if (isCanvasEditorControlTarget(e.target, e.currentTarget)) {
          e.stopPropagation()
          return
        }
        e.preventDefault()
        e.stopPropagation()
        onNodeContextMenu(nodeId, e)
      }}
      onKeyDown={(e) => {
        if (isCanvasEditorControlTarget(e.target, e.currentTarget)) {
          e.stopPropagation()
          return
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          // Synthesise a mouse event so the context handler receives a valid event
          onNodeClick(nodeId, e as unknown as React.MouseEvent)
        }
      }}
      onMouseEnter={() => onNodeHover(nodeId)}
      onMouseLeave={() => onNodeHover(null)}
    >
      {children}
    </div>
  )
})

const CANVAS_EDITOR_CONTROL_SELECTOR = '[data-canvas-interactive="true"]'
const CANVAS_NODE_SELECTOR = '[data-node-id]'

function isClosestCanvasNodeTarget(
  target: EventTarget | null,
  currentTarget: EventTarget | null,
): boolean {
  if (
    typeof Element === 'undefined' ||
    !(target instanceof Element) ||
    !(currentTarget instanceof Element)
  ) {
    return true
  }

  const closestNode = target.closest(CANVAS_NODE_SELECTOR)
  return closestNode === currentTarget
}

function isCanvasEditorControlTarget(
  target: EventTarget | null,
  currentTarget: EventTarget | null,
): boolean {
  if (
    typeof Element === 'undefined' ||
    !(target instanceof Element) ||
    !(currentTarget instanceof Element)
  ) {
    return false
  }

  const interactive = target.closest(CANVAS_EDITOR_CONTROL_SELECTOR)
  return Boolean(interactive && currentTarget.contains(interactive))
}
