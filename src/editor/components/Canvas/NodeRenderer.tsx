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

import { memo, useCallback, useContext } from 'react'
import { useEditorStore, selectActiveCanvasPage } from '../../../core/editor-store/store'
import { resolveProps } from '../../../core/page-tree/selectors'
import { registry } from '../../../core/module-engine/registry'
import { resolveDynamicProps } from '../../../core/templates/dynamicBindings'
import { WarningDiamondIcon } from '@ui/icons/icons/warning-diamond'
import { ModuleSandboxFrame } from './ModuleSandboxFrame'
import { CanvasBreakpointContext, CanvasSelectionContext, CanvasTemplateContext } from './CanvasContexts'
import { getCanvasNodeClassIds, getCanvasNodeClassName } from './canvasNodeClassName'
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

  // Per-node selection/hover subscriptions (Perf fix — Contribution #495).
  // Only the 2 nodes whose boolean flips will re-render on any selection/hover
  // event. Context carries only stable callbacks — no context-driven re-renders.
  const isSelected = useEditorStore(
    useCallback((s) => s.selectedNodeId === nodeId, [nodeId]),
  )
  const isHovered = useEditorStore(
    useCallback((s) => s.hoveredNodeId === nodeId, [nodeId]),
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

  const { onNodeClick, onNodeHover, onNodeContextMenu, onNodeDoubleClick } = useContext(CanvasSelectionContext)
  const breakpointId = useContext(CanvasBreakpointContext)
  const templateContext = useContext(CanvasTemplateContext)

  if (!node) return null
  if (node.hidden) return null

  const definition = registry.get(node.moduleId)
  if (!definition) {
    return (
      <div
        className={styles.unknownModule}
        title={`Unknown module: ${node.moduleId}`}
      >
        <WarningDiamondIcon size={14} /> Unknown module: {node.moduleId}
      </div>
    )
  }

  // Render children recursively
  const children = node.children.map((childId) => (
    <NodeRenderer key={childId} nodeId={childId} />
  ))

  const ComponentType = definition.component
  const shouldRenderSandbox = Boolean(definition.editorRuntime?.sandbox && !definition.trusted)
  const effectiveProps = resolveDynamicProps(resolveProps(node, breakpointId), node.dynamicBindings, templateContext)

  // Build className from classIds using the user-facing class names.
  const effectiveClassIds = getCanvasNodeClassIds(node.classIds, previewClassAssignment, nodeId)

  return (
    <NodeWrapper
      nodeId={nodeId}
      moduleId={node.moduleId}
      isSelected={isSelected}
      isHovered={isHovered}
      onNodeClick={onNodeClick}
      onNodeHover={onNodeHover}
      onNodeContextMenu={onNodeContextMenu}
      onNodeDoubleClick={onNodeDoubleClick}
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
        <ComponentType props={effectiveProps as never} nodeId={nodeId} isSelected={isSelected} mcClassName={mcClassName}>
          {children}
        </ComponentType>
      )}
    </NodeWrapper>
  )
})

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
   * Double-click handler — used for base.visualComponentRef to enter VC canvas mode.
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
