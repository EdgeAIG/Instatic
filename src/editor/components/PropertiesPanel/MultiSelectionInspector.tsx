/**
 * MultiSelectionInspector — body of the Properties panel when the editor has
 * 2+ layers selected.
 *
 * The panel header above this component shows "N layers selected" (rendered
 * by the parent `PropertiesPanel.NodeHeader` substitute — see
 * `MultiSelectionHeader` below). This body provides the discoverable action
 * surface for the multi-selection: Duplicate, Wrap..., Copy, Cut, Paste, Delete.
 *
 * Componentize is intentionally NOT exposed in v1 — see the multi-select task
 * notes for the v1 vs v2 scope decision.
 *
 * Wrap is a small popover with two choices: Container and Loop. Selecting one
 * dispatches `wrapNodes` with the closest-common-ancestor semantics
 * implemented in `mutations.ts`.
 *
 * Below the action bar, every selected layer is listed with its display name,
 * tag chip, and an X button that removes JUST that layer from the multi-set.
 * Clicking a layer label scrolls the canvas / DOM panel to that layer (not
 * implemented in v1 — kept as a pure list to keep the surface minimal).
 *
 * Architecture notes:
 * - Reads `selectedNodeIds` via `useShallow` so re-renders only happen on
 *   selection identity changes.
 * - Reads each layer's display name lazily via `getNodeDisplayName` against
 *   the active canvas page; doesn't subscribe per-row to keep the list cheap
 *   for large multi-selections.
 */

import { useCallback, useMemo, useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  useEditorStore,
  selectActiveCanvasPage,
} from '@core/editor-store/store'
import { registry } from '@core/module-engine/registry'
import {
  getNodeDisplayName,
  getNodeHtmlTag,
  getNodeClassNames,
} from '@core/page-tree/nodeDisplayName'
import { Button } from '@ui/components/Button'
import { useConfirmDelete } from '../shared/ConfirmDeleteDialog'
import {
  TreeRow,
  TreeLabel,
  TreeLabelGroup,
  TreeMeta,
} from '../../ui/Tree'
import { pillAccent } from '@ui/pillAccent'
import { CopyIcon } from 'pixel-art-icons/icons/copy'
import { Copy2Icon } from 'pixel-art-icons/icons/copy-2'
import { EraserIcon } from 'pixel-art-icons/icons/eraser'
import { FilesStack2Icon } from 'pixel-art-icons/icons/files-stack-2'
import { CheckboxIcon } from 'pixel-art-icons/icons/checkbox'
import { BoxStackIcon } from 'pixel-art-icons/icons/box-stack'
import { DeleteIcon } from 'pixel-art-icons/icons/delete'
import { CloseIcon } from 'pixel-art-icons/icons/close'
import {
  ContextMenu,
  ContextMenuItem,
} from '@ui/components/ContextMenu'
import styles from './MultiSelectionInspector.module.css'

interface MultiSelectionInspectorProps {
  /** Ordered selection set (anchor last). Must contain 2+ ids. */
  selectedNodeIds: string[]
}

export function MultiSelectionInspector({
  selectedNodeIds,
}: MultiSelectionInspectorProps) {
  const removeFromSelection = useEditorStore((s) => s.removeFromSelection)
  const duplicateNodes = useEditorStore((s) => s.duplicateNodes)
  const deleteNodes = useEditorStore((s) => s.deleteNodes)
  const copyNodes = useEditorStore((s) => s.copyNodes)
  const cutNodes = useEditorStore((s) => s.cutNodes)
  const wrapNodes = useEditorStore((s) => s.wrapNodes)
  const pasteNode = useEditorStore((s) => s.pasteNode)
  const canPaste = useEditorStore((s) => s.clipboardEntry !== null)

  // Resolve display names / tags / class chips against the active canvas page.
  // The selectors subscribe to STABLE references (page + visualComponents +
  // class registry) and the per-row mapping happens via `useMemo` so we don't
  // return a freshly-built array from the store selector on every render —
  // `useShallow` can't equate freshly-built objects element-by-element, which
  // would loop.
  const tree = useEditorStore(selectActiveCanvasPage)
  const visualComponents = useEditorStore((s) => s.site?.visualComponents)
  const classes = useEditorStore((s) => s.site?.classes)
  const layers = useMemo(() => {
    if (!tree) return []
    return selectedNodeIds.map((id) => {
      const node = tree.nodes[id]
      if (!node) {
        return {
          id,
          label: '(missing)',
          tag: null as string | null,
          classChip: null as string | null,
        }
      }
      const def = registry.get(node.moduleId)
      const classNames = getNodeClassNames(node, classes)
      return {
        id,
        label: getNodeDisplayName(node, def, visualComponents),
        tag: getNodeHtmlTag(node, def),
        // Chained-dot CSS selector style — matches the DOM panel's class chip
        // formatting (".header.padding-m").
        classChip: classNames.length > 0 ? `.${classNames.join('.')}` : null,
      }
    })
  }, [tree, visualComponents, classes, selectedNodeIds])

  const confirmDelete = useConfirmDelete()
  const handleDelete = useCallback(() => {
    confirmDelete({
      title: 'Delete layers?',
      description: `${selectedNodeIds.length} layers (and their children) will be removed. This can be undone with Ctrl/Cmd+Z.`,
      confirmLabel: 'Delete',
      commit: () => deleteNodes(selectedNodeIds),
    })
  }, [confirmDelete, deleteNodes, selectedNodeIds])

  // Wrap menu — small ContextMenu pinned to the Wrap button so the same
  // submenu primitive used in LayerNodeContextMenu is reused here.
  const wrapButtonRef = useRef<HTMLButtonElement>(null)
  const [wrapMenu, setWrapMenu] = useState<{ x: number; y: number } | null>(null)
  const closeWrapMenu = useCallback(() => setWrapMenu(null), [])
  const openWrapMenu = useCallback(() => {
    const rect = wrapButtonRef.current?.getBoundingClientRect()
    if (!rect) return
    // Anchor the menu just below the button.
    setWrapMenu({ x: rect.left, y: rect.bottom + 4 })
  }, [])

  // Paste anchors to the multi-selection's anchor (last id) — same as
  // single-paste against the selected node.
  const handlePaste = useCallback(() => {
    const anchor = selectedNodeIds[selectedNodeIds.length - 1]
    if (anchor) pasteNode(anchor)
  }, [selectedNodeIds, pasteNode])

  // Memoise the action handlers so the action bar stays stable across re-renders.
  const handlers = useMemo(
    () => ({
      duplicate: () => duplicateNodes(selectedNodeIds),
      copy: () => copyNodes(selectedNodeIds),
      cut: () => cutNodes(selectedNodeIds),
      wrapContainer: () => {
        wrapNodes(selectedNodeIds, 'base.container')
        closeWrapMenu()
      },
      wrapLoop: () => {
        wrapNodes(selectedNodeIds, 'base.loop')
        closeWrapMenu()
      },
    }),
    [duplicateNodes, copyNodes, cutNodes, wrapNodes, selectedNodeIds, closeWrapMenu],
  )

  return (
    <div className={styles.root}>
      <div className={styles.actionBar} role="group" aria-label="Multi-select actions">
        <div className={styles.actionRow}>
          <Button
            variant="secondary"
            size="sm"
            onClick={handlers.duplicate}
            tooltip="Duplicate selected layers"
          >
            <CopyIcon size={13} aria-hidden="true" />
            Duplicate
          </Button>
          <Button
            ref={wrapButtonRef}
            variant="secondary"
            size="sm"
            onClick={openWrapMenu}
            aria-haspopup="menu"
            aria-expanded={wrapMenu !== null}
            tooltip="Wrap selected layers"
          >
            <CheckboxIcon size={13} aria-hidden="true" />
            Wrap…
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleDelete}
            tooltip="Delete selected layers"
          >
            <DeleteIcon size={13} aria-hidden="true" />
            Delete
          </Button>
        </div>
        <div className={styles.actionRow}>
          <Button variant="ghost" size="sm" onClick={handlers.copy} tooltip="Copy">
            <Copy2Icon size={13} aria-hidden="true" />
            Copy
          </Button>
          <Button variant="ghost" size="sm" onClick={handlers.cut} tooltip="Cut">
            <EraserIcon size={13} aria-hidden="true" />
            Cut
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePaste}
            disabled={!canPaste}
            tooltip="Paste at anchor"
          >
            <FilesStack2Icon size={13} aria-hidden="true" />
            Paste
          </Button>
        </div>
      </div>

      <div className={styles.layerListHeader}>
        Selected layers ({selectedNodeIds.length})
      </div>
      <div className={styles.layerList} role="list">
        {/*
          Each row uses the same primitives + chip styles as TreeNode in the
          DOM panel: TreeRow as the visual contract, TreeMeta with
          `data-accent={pillAccent(tag)}` for the gradient-tinted HTML tag
          pill, and the chained-dot class chip after the label. The styles
          object below picks up the tag/class CSS that mirrors TreeNode.module.css.
        */}
        {layers.map((layer) => (
          <TreeRow
            key={layer.id}
            depth={0}
            role="listitem"
            className={styles.layerRow}
          >
            <TreeLabelGroup>
              {layer.tag && (
                <TreeMeta
                  aria-hidden="true"
                  data-accent={pillAccent(layer.tag)}
                  className={styles.tagPill}
                >
                  {layer.tag}
                </TreeMeta>
              )}
              <TreeLabel>{layer.label}</TreeLabel>
              {layer.classChip && (
                <TreeMeta
                  aria-hidden="true"
                  title={layer.classChip}
                  className={styles.classChip}
                >
                  {layer.classChip}
                </TreeMeta>
              )}
            </TreeLabelGroup>
            <Button
              variant="ghost"
              size="xs"
              iconOnly
              onClick={() => removeFromSelection(layer.id)}
              aria-label={`Remove ${layer.label} from selection`}
              tooltip="Remove from selection"
            >
              <CloseIcon size={11} aria-hidden="true" />
            </Button>
          </TreeRow>
        ))}
      </div>

      {wrapMenu &&
        createPortal(
          <WrapMenu
            x={wrapMenu.x}
            y={wrapMenu.y}
            onClose={closeWrapMenu}
            onWrapContainer={handlers.wrapContainer}
            onWrapLoop={handlers.wrapLoop}
          />,
          document.body,
        )}
    </div>
  )
}

interface WrapMenuProps {
  x: number
  y: number
  onClose: () => void
  onWrapContainer: () => void
  onWrapLoop: () => void
}

function WrapMenu({ x, y, onClose, onWrapContainer, onWrapLoop }: WrapMenuProps) {
  const firstRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    firstRef.current?.focus()
  }, [])
  return (
    <ContextMenu x={x} y={y} ariaLabel="Wrap selection in" onClose={onClose}>
      <ContextMenuItem ref={firstRef} onClick={onWrapContainer}>
        <span aria-hidden="true">
          <CheckboxIcon size={13} />
        </span>
        Container
      </ContextMenuItem>
      <ContextMenuItem onClick={onWrapLoop}>
        <span aria-hidden="true">
          <BoxStackIcon size={13} />
        </span>
        Loop
      </ContextMenuItem>
    </ContextMenu>
  )
}

// ---------------------------------------------------------------------------
// MultiSelectionHeader — replaces NodeHeader in the panel header for multi.
// Static "N layers selected" chip; no rename affordance (rename is single-only).
// ---------------------------------------------------------------------------

interface MultiSelectionHeaderProps {
  count: number
}

export function MultiSelectionHeader({ count }: MultiSelectionHeaderProps) {
  return <span>{count} layers selected</span>
}
