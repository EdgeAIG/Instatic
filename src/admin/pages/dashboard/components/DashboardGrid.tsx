/**
 * DashboardGrid — the 12-column / fixed-row-height widget grid plus
 * drag-to-reorder and 4-side resize handles for Customize mode.
 *
 * The grid uses `grid-auto-rows: var(--row-h)` so vertical resize is
 * just `grid-row: span N`. Snap math (cell rect width / 12 → column
 * width; --row-h + gap → row delta) lives in `handleResize` below; the
 * actual constants are mirrored from `useDashboardLayout.ts` so the
 * JS and CSS stay in sync.
 *
 * Horizontal handles (left + right) drag column span. Vertical handles
 * (top + bottom) drag row span. The bottom-right corner combines both.
 * Left / top handles invert the delta direction so dragging "outward"
 * always grows the widget.
 *
 * The widget renderer is invoked with the live span so chart primitives
 * can react to layout changes without remount.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { PlusIcon } from 'pixel-art-icons/icons/plus'
import type { DashboardWidgetDefinition } from '@core/dashboard'
import { Button } from '@ui/components/Button'
import { cn } from '@ui/cn'
import {
  GRID_GAP,
  GRID_ROW_HEIGHT,
  MAX_COLS,
  MAX_ROWS,
  MIN_COLS,
  MIN_ROWS,
  type DashboardItem,
} from '../hooks/useDashboardLayout'
import styles from './DashboardGrid.module.css'

function clampSize(size: number, min: number, max: number): number {
  if (size < min) return min
  if (size > max) return max
  return Math.round(size)
}

export interface DashboardGridProps {
  items: readonly DashboardItem[]
  /** Definitions keyed by id (registry snapshot). */
  definitions: ReadonlyMap<string, DashboardWidgetDefinition>
  editing: boolean
  onReorder: (next: readonly DashboardItem[]) => void
  onResize: (id: string, size: number) => void
  onResizeRows: (id: string, rows: number) => void
  onAddBlock: () => void
}

export function DashboardGrid({
  items,
  definitions,
  editing,
  onReorder,
  onResize,
  onResizeRows,
  onAddBlock,
}: DashboardGridProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )
  const [draggingId, setDraggingId] = useState<string | null>(null)

  function handleDragStart(event: DragStartEvent) {
    setDraggingId(event.active.id as string)
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null)
    const fromId = event.active.id as string
    const overId = event.over?.id as string | undefined
    if (!overId || fromId === overId) return

    const fromIndex = items.findIndex((i) => i.id === fromId)
    const toIndex = items.findIndex((i) => i.id === overId)
    if (fromIndex === -1 || toIndex === -1) return

    const next = [...items]
    const [picked] = next.splice(fromIndex, 1)
    if (picked) next.splice(toIndex, 0, picked)
    onReorder(next)
  }

  // Static render — no DnD context needed.
  if (!editing) {
    return (
      <div className={styles.gridLayout}>
        {items.map((item) => {
          const def = definitions.get(item.id)
          if (!def) return null
          const Render = def.render
          return (
            <div
              key={item.id}
              className={styles.cell}
              data-span={item.size}
              data-rows={item.rows}
              style={{
                ['--span' as string]: String(item.size),
                ['--rows' as string]: String(item.rows),
              }}
            >
              <Render span={item.size} editing={false} />
            </div>
          )
        })}
      </div>
    )
  }

  const draggingDef = draggingId ? definitions.get(draggingId) ?? null : null
  const draggingItem = draggingId ? items.find((i) => i.id === draggingId) ?? null : null

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className={cn(styles.gridLayout, styles.editing)}>
        {items.map((item) => {
          const def = definitions.get(item.id)
          if (!def) return null
          return (
            <DraggableCell
              key={item.id}
              item={item}
              definition={def}
              onResize={onResize}
              onResizeRows={onResizeRows}
            />
          )
        })}
        <Button
          variant="ghost"
          className={cn(styles.cell, styles.addWidget)}
          data-span={3}
          data-rows={3}
          style={{
            ['--span' as string]: '3',
            ['--rows' as string]: '3',
          }}
          onClick={onAddBlock}
        >
          <span className={styles.addInner}>
            <span className={styles.addIcon}>
              <PlusIcon size={14} />
            </span>
            <span className={styles.addLabel}>Add block</span>
          </span>
        </Button>
      </div>
      <DragOverlay>
        {draggingDef && draggingItem ? (
          <div
            className={cn(styles.cell, styles.dragOverlay)}
            data-span={draggingItem.size}
            data-rows={draggingItem.rows}
            style={{
              ['--span' as string]: String(draggingItem.size),
              ['--rows' as string]: String(draggingItem.rows),
            }}
          >
            <draggingDef.render span={draggingItem.size} editing />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

// ---------------------------------------------------------------------------
// Draggable cell + resize handles
// ---------------------------------------------------------------------------

/**
 * Which direction does this handle resize, and which sign does the
 * pointer delta map to? `right` and `bottom` use positive deltas
 * (drag away from origin → grow); `left` and `top` use negative
 * deltas (drag away from origin → grow → drag direction is opposite).
 */
type ResizeAxis = 'x' | 'y' | 'xy'
type ResizeKind = 'left' | 'right' | 'top' | 'bottom' | 'corner'

interface ResizeSpec {
  kind: ResizeKind
  axis: ResizeAxis
  xSign: -1 | 0 | 1
  ySign: -1 | 0 | 1
}

const RESIZE_SPECS: Record<ResizeKind, ResizeSpec> = {
  right:  { kind: 'right',  axis: 'x',  xSign:  1, ySign:  0 },
  left:   { kind: 'left',   axis: 'x',  xSign: -1, ySign:  0 },
  bottom: { kind: 'bottom', axis: 'y',  xSign:  0, ySign:  1 },
  top:    { kind: 'top',    axis: 'y',  xSign:  0, ySign: -1 },
  corner: { kind: 'corner', axis: 'xy', xSign:  1, ySign:  1 },
}

interface DraggableCellProps {
  item: DashboardItem
  definition: DashboardWidgetDefinition
  onResize: (id: string, size: number) => void
  onResizeRows: (id: string, rows: number) => void
}

function DraggableCell({ item, definition, onResize, onResizeRows }: DraggableCellProps) {
  const draggable = useDraggable({ id: item.id })
  const droppable = useDroppable({ id: item.id })
  const Render = definition.render

  const containerRef = useRef<HTMLDivElement | null>(null)
  const resizeStateRef = useRef<{
    spec: ResizeSpec
    startX: number
    startY: number
    startSize: number
    startRows: number
    colWidth: number
    rowHeight: number
  } | null>(null)

  function startResize(spec: ResizeSpec, event: ReactPointerEvent<HTMLSpanElement>) {
    event.stopPropagation()
    event.preventDefault()

    const container = containerRef.current
    const grid = container?.parentElement
    if (!container || !grid) return

    // Snap math: one column == (gridWidth - 11×gap) / 12. We treat
    // gap as part of a column for simplicity since the gap is small
    // relative to a column (14 / ~107). Rows are exact: GRID_ROW_HEIGHT
    // plus GRID_GAP per step.
    const gridRect = grid.getBoundingClientRect()
    const colWidth = gridRect.width / MAX_COLS
    if (colWidth <= 0) return

    resizeStateRef.current = {
      spec,
      startX: event.clientX,
      startY: event.clientY,
      startSize: item.size,
      startRows: item.rows,
      colWidth,
      rowHeight: GRID_ROW_HEIGHT + GRID_GAP,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveResize(event: ReactPointerEvent<HTMLSpanElement>) {
    const state = resizeStateRef.current
    if (!state) return

    const { spec, startX, startY, startSize, startRows, colWidth, rowHeight } = state

    if (spec.axis === 'x' || spec.axis === 'xy') {
      const dx = event.clientX - startX
      const cols = Math.round(dx / colWidth) * spec.xSign
      const nextSize = clampSize(startSize + cols, MIN_COLS, MAX_COLS)
      if (nextSize !== item.size) onResize(item.id, nextSize)
    }
    if (spec.axis === 'y' || spec.axis === 'xy') {
      const dy = event.clientY - startY
      const rows = Math.round(dy / rowHeight) * spec.ySign
      const nextRows = clampSize(startRows + rows, MIN_ROWS, MAX_ROWS)
      if (nextRows !== item.rows) onResizeRows(item.id, nextRows)
    }
  }

  function endResize(event: ReactPointerEvent<HTMLSpanElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    resizeStateRef.current = null
  }

  const transformStyle = draggable.transform
    ? `translate3d(${draggable.transform.x}px, ${draggable.transform.y}px, 0)`
    : undefined

  return (
    <div
      ref={(node) => {
        containerRef.current = node
        draggable.setNodeRef(node)
        droppable.setNodeRef(node)
      }}
      className={cn(
        styles.cell,
        draggable.isDragging && styles.dragging,
        droppable.isOver && styles.dropTarget,
      )}
      data-span={item.size}
      data-rows={item.rows}
      style={{
        ['--span' as string]: String(item.size),
        ['--rows' as string]: String(item.rows),
        transform: transformStyle,
      }}
      {...draggable.listeners}
      {...draggable.attributes}
    >
      <Render span={item.size} editing />

      {/* 4 edge handles + 1 corner handle, all rendered into the same
          flow so each gets its own pointer capture. The corner is
          stacked above the edges (z-index: 11 vs 10) so the 12×12
          intersection area resolves to two-axis resize. */}
      <ResizeHandle
        kind="left"
        label={`Resize ${definition.name} from left`}
        onStart={startResize}
        onMove={moveResize}
        onEnd={endResize}
      />
      <ResizeHandle
        kind="right"
        label={`Resize ${definition.name} from right`}
        onStart={startResize}
        onMove={moveResize}
        onEnd={endResize}
      />
      <ResizeHandle
        kind="top"
        label={`Resize ${definition.name} from top`}
        onStart={startResize}
        onMove={moveResize}
        onEnd={endResize}
      />
      <ResizeHandle
        kind="bottom"
        label={`Resize ${definition.name} from bottom`}
        onStart={startResize}
        onMove={moveResize}
        onEnd={endResize}
      />
      <ResizeHandle
        kind="corner"
        label={`Resize ${definition.name} from corner`}
        onStart={startResize}
        onMove={moveResize}
        onEnd={endResize}
      />
    </div>
  )
}

interface ResizeHandleProps {
  kind: ResizeKind
  label: string
  onStart: (spec: ResizeSpec, event: ReactPointerEvent<HTMLSpanElement>) => void
  onMove: (event: ReactPointerEvent<HTMLSpanElement>) => void
  onEnd: (event: ReactPointerEvent<HTMLSpanElement>) => void
}

const HANDLE_CLASS: Record<ResizeKind, string> = {
  left: styles.handleLeft as string,
  right: styles.handleRight as string,
  top: styles.handleTop as string,
  bottom: styles.handleBottom as string,
  corner: styles.handleCorner as string,
}

function ResizeHandle({ kind, label, onStart, onMove, onEnd }: ResizeHandleProps) {
  const spec = RESIZE_SPECS[kind]
  return (
    <span
      className={cn(styles.handle, HANDLE_CLASS[kind])}
      role="separator"
      aria-orientation={spec.axis === 'y' ? 'horizontal' : 'vertical'}
      aria-label={label}
      onPointerDown={(e) => onStart(spec, e)}
      onPointerMove={onMove}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
      onClick={(e) => e.stopPropagation()}
    />
  )
}
