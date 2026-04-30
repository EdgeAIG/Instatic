/**
 * TreeNode — a single row in the DOM tree panel.
 *
 * Performance notes (Contribution #437 / Guideline #318):
 * - `React.memo` wrapping: re-renders only when nodeId or depth changes.
 * - Per-node isSelected / isHovered selectors: only the 2 affected rows
 *   re-render per canvas click (not all 1,000).
 * - Drag state tracked via refs; Zustand only updated on pointerUp (drag end).
 *
 * Drag-and-drop:
 * - Each TreeNode is a @dnd-kit draggable item with DOMPanel-owned targets.
 * - Visual indicators render as overlays (no DOM reorder during drag).
 * - moveNode() called once on DragEndEvent at the DomPanel level.
 *
 * Accessibility:
 * - role="treeitem" + aria-selected + aria-expanded on THE SAME element as
 *   tabIndex={0} and keyboard handlers (Guideline #234 / WCAG SC 4.1.2).
 * - onFocus/onBlur boxShadow focus ring (WCAG SC 2.4.7).
 * - height: 28px (Guideline #357 — compact density; WCAG 2.5.5 touch target
 *   NOT required for editor chrome per user directive / Guideline #357).
 * - Context menu focuses first item on mount.
 */
import { memo, useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEditorStore, selectActivePage } from '../../../core/editor-store/store'
import { registry } from '../../../core/module-engine/registry'
import { useDraggable } from '@dnd-kit/core'
import { useDomTree } from './DomTreeContext'
import { useDomPanelDndContext } from './DomPanelDndContext'
import { LayerNodeContextMenu } from './LayerNodeContextMenu'
import { Input } from '@ui/components/Input'
import { cn } from '@ui/cn'
import {
  TreeChevron,
  TreeIconSlot,
  TreeLabel,
  TreeLabelGroup,
  TreeMeta,
  TreeRow,
} from '../../ui/Tree'
import styles from './TreeNode.module.css'

export interface TreeNodeProps {
  nodeId: string
  depth: number
}

interface ContextMenuState {
  x: number
  y: number
}

export const TreeNode = memo(function TreeNode({ nodeId, depth }: TreeNodeProps) {
  // ── Per-node selectors — only THIS node re-renders on its own changes ──────
  const node = useEditorStore(
    useCallback((s) => selectActivePage(s)?.nodes[nodeId] ?? null, [nodeId]),
  )
  // Per-node selection: only 2 rows re-render per canvas click (prev + next selected)
  const isSelected = useEditorStore(useCallback((s) => s.selectedNodeId === nodeId, [nodeId]))
  const isHovered = useEditorStore(useCallback((s) => s.hoveredNodeId === nodeId, [nodeId]))
  const isRoot = useEditorStore(useCallback((s) => selectActivePage(s)?.rootNodeId === nodeId, [nodeId]))

  const selectNode = useEditorStore((s) => s.selectNode)
  const hoverNode = useEditorStore((s) => s.hoverNode)
  const deleteNode = useEditorStore((s) => s.deleteNode)
  const duplicateNode = useEditorStore((s) => s.duplicateNode)
  const renameNode = useEditorStore((s) => s.renameNode)
  const wrapNode = useEditorStore((s) => s.wrapNode)

  const { isExpanded, toggleExpanded } = useDomTree()

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')

  const rowRef = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const { activeId, target, invalidOverId, registerRow } = useDomPanelDndContext()

  // ── dnd-kit draggable ─────────────────────────────────────────────────────
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({
    id: nodeId,
    disabled: !node || isRoot || node.locked || isRenaming,
  })

  const setRowNodeRef = useCallback((element: HTMLDivElement | null) => {
    rowRef.current = element
    setNodeRef(element)
    registerRow(nodeId, element)
  }, [nodeId, registerRow, setNodeRef])

  // ── Guard against unmounted nodes ─────────────────────────────────────────
  if (!node) return null

  const definition = registry.get(node.moduleId)
  const displayName = node.label || definition?.name || node.moduleId
  const hasChildren = node.children.length > 0
  const expanded = isExpanded(nodeId)
  const isOpenContainerGroup = node.moduleId === 'base.container' && hasChildren && expanded && isSelected
  const dropPosition =
    target?.overId === nodeId && target.position !== 'inside'
      ? target.position
      : target?.parentId === nodeId && target.position === 'inside'
        ? 'inside'
        : undefined

  // ── Keyboard navigation ───────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // When the rename input is active, all key handling is delegated to
    // handleRenameKeyDown on the input itself — don't intercept here.
    if (isRenaming) return
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault()
        selectNode(nodeId)
        if (hasChildren) toggleExpanded(nodeId)
        break
      case 'ArrowRight':
        e.preventDefault()
        if (hasChildren && !expanded) toggleExpanded(nodeId)
        break
      case 'ArrowLeft':
        e.preventDefault()
        if (expanded) toggleExpanded(nodeId)
        break
      case 'F2':
        e.preventDefault()
        openRename()
        break
    }
  }

  // ── Inline rename ─────────────────────────────────────────────────────────
  const openRename = () => {
    setRenameValue(node.label ?? displayName)
    setIsRenaming(true)
    setContextMenu(null)
    // Focus the input after it renders
    requestAnimationFrame(() => renameInputRef.current?.select())
  }

  const commitRename = () => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== displayName) {
      renameNode(nodeId, trimmed)
    }
    setIsRenaming(false)
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // stopPropagation prevents bubbling to the parent row's handleKeyDown,
    // which would otherwise intercept Enter/Space and call selectNode().
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitRename() }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setIsRenaming(false) }
  }

  // Module type tag: last segment after "." (e.g. "base.button" → "button")
  const moduleType = node.moduleId.includes('.')
    ? node.moduleId.split('.').pop()!
    : node.moduleId

  return (
    // Wrapper preserves the recursive tree shape. DnD refs live on TreeRow so
    // hit-testing uses the actual visible row height.
    <div
      data-node-id={nodeId}
      data-open-container-group={isOpenContainerGroup ? 'true' : undefined}
      className={cn(
        isOpenContainerGroup && styles.openContainerGroup,
        activeId === nodeId && styles.dragSource,
      )}
    >
      {/* ── Row: role="treeitem" + tabIndex + handlers all on ONE element ── */}
      {/*
          IMPORTANT: {…attributes} from useSortable injects role="button".
          role="treeitem" is placed AFTER the spread to override it back
          (Guideline #234 / WAI-ARIA tree pattern — treeitem role is non-negotiable).
      */}
      <TreeRow
        ref={setRowNodeRef}
        depth={depth}
        selected={isSelected}
        hovered={isHovered}
        focused={isFocused}
        locked={node.locked}
        hidden={node.hidden}
        dragging={isDragging}
        className={cn(
          dropPosition === 'before' && styles.dropBefore,
          dropPosition === 'after' && styles.dropAfter,
          dropPosition === 'inside' && styles.dropInside,
          invalidOverId === nodeId && styles.dropInvalid,
        )}
        {...attributes}
        {...listeners}
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={hasChildren ? expanded : undefined}
        // aria-label names the row for AT, including locked/hidden state so screen
        // reader users get the full picture without relying on the emoji indicators
        // (which are aria-hidden and therefore invisible to AT).
        aria-label={[
          displayName,
          node.locked ? 'locked' : null,
          node.hidden ? 'hidden' : null,
        ].filter(Boolean).join(', ')}
        data-drop-position={dropPosition}
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation()
          selectNode(nodeId)
          if (hasChildren) toggleExpanded(nodeId)
        }}
        onKeyDown={handleKeyDown}
        onContextMenu={(e) => {
          e.preventDefault(); e.stopPropagation()
          setContextMenu({ x: e.clientX, y: e.clientY })
        }}
        onMouseEnter={() => hoverNode(nodeId)}
        onMouseLeave={() => hoverNode(null)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
      >
        {/* Expand/collapse chevron */}
        <TreeChevron
          onClick={(e) => { e.stopPropagation(); toggleExpanded(nodeId) }}
          expanded={expanded}
          visible={hasChildren}
        />

        {/* Module icon */}
        <TreeIconSlot
          iconName={getModuleIconName(node.moduleId)}
          iconSize={11}
          iconColor="var(--editor-text-subtle)"
        />

        {/* Node label — inline editable when renaming */}
        {isRenaming ? (
          <Input
            ref={renameInputRef}
            fieldSize="xs"
            // autoFocus ensures the input receives keyboard focus as soon as it
            // mounts — more reliable than the requestAnimationFrame fallback.
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={commitRename}
            // Stop pointer events from bubbling to the row's dnd-kit listeners.
            // Without this, a click inside the input triggers the PointerSensor
            // on the row div, which can steal focus away from the input.
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={`Rename ${displayName}`}
            className={styles.renameInput}
          />
        ) : (
          <TreeLabelGroup>
            <TreeLabel>
              {displayName}
            </TreeLabel>
            {/* Module type annotation — React DevTools-style <type> chip.
                Shown when the user has set a custom label (so the module type
                is still visible alongside it). Hidden when displayName already
                IS the registry name (no label set) to avoid redundancy. */}
            {node.label && (
              <TreeMeta aria-hidden="true" className={styles.moduleTag}>
                &lt;{moduleType}&gt;
              </TreeMeta>
            )}
          </TreeLabelGroup>
        )}

        {/* Indicators: locked, hidden
            These emoji spans are aria-hidden="true" (decorative — AT reads state via
            the row's aria-label above). title gives sighted mouse users a tooltip.
            No aria-label here — it would be ignored by AT due to aria-hidden="true". */}
        {node.locked && (
          <span title="Locked" aria-hidden="true" className={styles.indicator}>
            🔒
          </span>
        )}
        {node.hidden && (
          <span title="Hidden" aria-hidden="true" className={styles.indicator}>
            👁
          </span>
        )}
      </TreeRow>

      {/* Children — role="group" as required by WAI-ARIA tree pattern */}
      {hasChildren && expanded && (
        <ChildrenGroup nodeId={nodeId} depth={depth} />
      )}

      {/* Context menu — rendered via portal at document.body to escape the
          DomPanel's transform: translateZ(0) stacking context.
          Without the portal, position:fixed inside a transformed ancestor is
          positioned relative to that ancestor, not the viewport, causing the
          menu to appear ~40px below the cursor (Task #413). */}
      {contextMenu && createPortal(
        <LayerNodeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onDelete={() => { deleteNode(nodeId); setContextMenu(null) }}
          onDuplicate={() => { duplicateNode(nodeId); setContextMenu(null) }}
          onRename={() => { setContextMenu(null); openRename() }}
          onWrapInContainer={() => {
            wrapNode(nodeId, 'base.container')
            setContextMenu(null)
          }}
        />,
        document.body,
      )}
    </div>
  )
})

// ─── ChildrenGroup — recursive child rendering ───────────────────────────────

import { useEditorStore as useStore } from '../../../core/editor-store/store'

function ChildrenGroup({ nodeId, depth }: { nodeId: string; depth: number }) {
  const children = useStore(
    useCallback((s) => selectActivePage(s)?.nodes[nodeId]?.children ?? [], [nodeId]),
  )

  return (
    <div role="group">
      {children.map((childId) => (
        <TreeNode key={childId} nodeId={childId} depth={depth + 1} />
      ))}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getModuleIconName(moduleId: string): string {
  const icons: Record<string, string> = {
    'base.container': 'layout',
    'base.text':      'type',
    'base.image':     'image',
    'base.button':    'square',
    'base.link':      'link',
    'base.spacer':    'minus',
    'base.divider':   'minus',
    'base.list':      'list-box',
    'base.root':      'file-text',
    'base.video':     'video',
    'base.columns':   'layout',
  }
  return icons[moduleId] ?? 'square'
}
