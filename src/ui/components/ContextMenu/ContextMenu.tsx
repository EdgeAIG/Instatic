import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { Button, type ButtonProps } from '@ui/components/Button'
import { Separator } from '@ui/components/Separator'
import { ChevronRightIcon } from 'pixel-art-icons/icons/chevron-right'
import { cn } from '@ui/cn'
import {
  computeFloatingPosition,
  type FloatingAlign,
  type FloatingSide,
  type ResolvedFloatingSide,
} from '@ui/lib/floatingPosition'
import styles from './ContextMenu.module.css'

/**
 * Dropdown auto-priority: prefer opening below the trigger, then above,
 * then to the right, then to the left.
 *
 * This is intentionally different from the Tooltip auto-priority (which
 * starts at `top`) because dropdown menus that open *upward* by default
 * feel inverted; users expect them to drop *down*.
 */
const DROPDOWN_AUTO_PRIORITY = ['bottom', 'top', 'right', 'left'] as const

interface ContextMenuPositionState {
  x: number
  y: number
  side: ResolvedFloatingSide
}

interface ContextMenuProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  ariaLabel: string
  onClose: () => void
  children: ReactNode
  minWidth?: number
  width?: number
  /**
   * Maximum height of the menu in pixels. When the content exceeds this,
   * the menu becomes vertically scrollable (`overflow-y: auto`). The CSS
   * also clamps the menu to the viewport (`min(maxHeight, 100vh - 16px)`)
   * so very tall menus near a screen edge stay reachable. When omitted the
   * menu is unbounded.
   */
  maxHeight?: number
  zIndex?: number
  menuClassName?: string
  /**
   * When provided, the menu switches to a non-modal dismiss mode:
   *   - The invisible backdrop overlay is NOT rendered.
   *   - Outside-click detection runs at the document level (mousedown
   *     capture phase).
   *   - Clicks inside this trigger element do NOT close the menu — the
   *     trigger keeps receiving native focus and clicks while open.
   *
   * Use this for combobox/dropdown patterns where the trigger is an
   * editable input that must stay focused (e.g. ClassPicker). Right-click
   * context menus that should fully capture the next click can leave this
   * prop undefined and the modal backdrop is used instead.
   */
  triggerRef?: RefObject<HTMLElement | null>
  /**
   * Absolute viewport-pixel x coordinate of the menu's left edge.
   * Use this together with `y` for point-anchored menus (e.g. right-click).
   * Mutually exclusive with `anchorRef`.
   */
  x?: number
  /** Absolute viewport-pixel y coordinate of the menu's top edge. */
  y?: number
  /**
   * Element whose bounding rect anchors the menu. The menu measures its
   * own size after mount and picks the side with the most available
   * viewport space (auto-flip), behaving the same way as <Tooltip>.
   * Mutually exclusive with `x`/`y`.
   *
   * Position recomputes on window resize and capture-phase scroll while
   * the menu is open, so the menu stays glued to the trigger.
   *
   * `anchorRef` is also used for dismiss handling — clicks inside this
   * element don't close the menu. When `getAnchorRect` is provided, it
   * overrides the rect used for positioning while `anchorRef` continues
   * to gate dismiss-on-outside-click.
   */
  anchorRef?: RefObject<HTMLElement | null>
  /**
   * Optional override for the rect used to position the menu. When
   * provided, the menu uses this rect instead of
   * `anchorRef.current.getBoundingClientRect()` for floating-position
   * math. Use this when the menu's horizontal extent (width / x) and
   * vertical extent (y / opens-below-trigger) need different sources —
   * e.g. a Select whose dropdown spans a wider parent for label
   * visibility but should still open just below the narrow trigger.
   * `anchorRef` is still required (it gates dismiss handling).
   */
  getAnchorRect?: () => DOMRect | null
  /**
   * Preferred side relative to the anchor. `'auto'` tries the priority
   * list `bottom → top → right → left` and picks the first that fits.
   * Default: `'auto'`. Ignored when `anchorRef` is not provided.
   */
  side?: FloatingSide
  /**
   * Cross-axis alignment relative to the anchor. Default: `'start'`
   * (menu's left edge aligns with the anchor's left edge). Ignored when
   * `anchorRef` is not provided.
   */
  align?: FloatingAlign
  /**
   * Gap between anchor edge and menu, in px. Default: 6. Ignored when
   * `anchorRef` is not provided.
   */
  offset?: number
  /**
   * When `true` and `anchorRef` is provided, the menu's rendered width
   * matches the anchor's measured width (clamped to `minWidth` floor).
   * Tracks the anchor live via ResizeObserver so dropdowns stay flush
   * with their trigger when the panel is resized. Use for combobox /
   * input-attached dropdowns (ClassPicker, DynamicBindingControl,
   * SpacingBoxControl) where the dropdown should span the input row.
   */
  matchAnchorWidth?: boolean
}

export const ContextMenu = forwardRef<HTMLDivElement, ContextMenuProps>(function ContextMenu(
  {
    ariaLabel,
    onClose,
    children,
    minWidth = 176,
    width = minWidth,
    maxHeight,
    zIndex = 1000,
    menuClassName,
    triggerRef,
    x: pointX,
    y: pointY,
    anchorRef,
    getAnchorRect,
    side = 'auto',
    align = 'start',
    offset = 6,
    matchAnchorWidth = false,
    onKeyDown,
    ...domProps
  },
  ref,
) {

  const menuRef = useRef<HTMLDivElement | null>(null)
  const setMenuRef = (node: HTMLDivElement | null) => {
    menuRef.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }

  // ── Anchor-based auto-flip positioning ────────────────────────────────
  //
  // When `anchorRef` is provided, the menu is positioned by measuring
  // itself and the anchor in a layout effect, then choosing the best side
  // via the shared floating-position helper. This mirrors the auto-flip
  // behaviour of <Tooltip> so dropdown menus never overflow off-screen.
  const [autoPosition, setAutoPosition] = useState<ContextMenuPositionState | null>(null)
  // ── Point-anchored viewport-fit ──────────────────────────────────────
  //
  // In point mode (right-click `x`/`y`) the menu measures itself once after
  // mount and shifts the click point so the panel never overflows the
  // viewport: flip horizontally when it would cross the right edge, flip
  // vertically when it would cross the bottom edge, then clamp to the 8 px
  // viewport margin. Until measured, `pointPosition` is `null` and the
  // panel renders with `visibility: hidden`.
  const [pointPosition, setPointPosition] = useState<{ x: number; y: number } | null>(null)
  // Live anchor width, used when `matchAnchorWidth` is set. Tracked via
  // ResizeObserver so the dropdown stays glued to the trigger's width
  // even as the surrounding panel resizes.
  const [anchorWidth, setAnchorWidth] = useState<number | null>(null)

  // Effective render width: when `matchAnchorWidth` is set, the menu
  // expands to the anchor's measured width but never shrinks below the
  // explicit `minWidth` floor.
  const effectiveWidth = matchAnchorWidth && anchorWidth != null
    ? Math.max(anchorWidth, minWidth)
    : width

  const recomputeAutoPosition = useEvent(() => {
    if (!anchorRef) return
    const anchorEl = anchorRef.current
    const menuEl = menuRef.current
    if (!anchorEl || !menuEl) return
    // Position math uses `getAnchorRect()` when provided so callers can
    // decouple the dismiss-handling anchor (`anchorRef`) from the rect
    // used for positioning (e.g. wider parent for X/width, trigger for Y).
    const anchorRect = getAnchorRect?.() ?? anchorEl.getBoundingClientRect()
    const menuRect = menuEl.getBoundingClientRect()
    // Use the explicit `width` prop (which the CSS renders to) rather than
    // the measured rect width — this keeps positioning predictable in jsdom
    // tests and avoids double-counting any layout-time width clamping.
    // When `maxHeight` caps the menu, the measured rect already reflects the
    // capped height (CSS applies `max-height` before getBoundingClientRect).
    // Still defensively clamp here so position calculations agree with the
    // rendered size even on the very first measurement.
    const effectiveHeight = maxHeight != null
      ? Math.min(menuRect.height, maxHeight)
      : menuRect.height
    const next = computeFloatingPosition(anchorRect, {
      floatingWidth: effectiveWidth,
      floatingHeight: effectiveHeight,
      side,
      align,
      offset,
      autoPriority: DROPDOWN_AUTO_PRIORITY,
    })
    setAutoPosition({ x: next.x, y: next.y, side: next.side })
  })

  useLayoutEffect(() => {
    if (!anchorRef) return
    recomputeAutoPosition()
    // `anchorWidth` is intentionally a dep — when the anchor resizes (and
    // `matchAnchorWidth` is on) the dropdown's own width changes, so the
    // floating-position math must run again to keep alignment correct.
  }, [anchorRef, anchorWidth, recomputeAutoPosition])

  // Measure once after mount in point mode and flip/clamp so the panel
  // stays inside the viewport. The "flip around the click point" behaviour
  // is the right-click convention: when the menu would overflow the right
  // edge, position the menu so its right edge sits at the click x (i.e.
  // the menu opens to the LEFT of the click); same for the bottom edge.
  const recomputePointPosition = useEvent(() => {
    if (anchorRef) return
    if (pointX == null || pointY == null) return
    const menuEl = menuRef.current
    if (!menuEl) return
    const menuRect = menuEl.getBoundingClientRect()
    const effectiveHeight = maxHeight != null
      ? Math.min(menuRect.height, maxHeight)
      : menuRect.height
    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = 8
    let x = pointX
    let y = pointY
    if (x + effectiveWidth > vw - margin) {
      // Flip horizontally: align right edge of menu with click point. Then
      // clamp to keep the left edge inside the viewport for the case where
      // the menu is wider than the click point itself.
      x = Math.max(margin, pointX - effectiveWidth)
    }
    if (y + effectiveHeight > vh - margin) {
      y = Math.max(margin, pointY - effectiveHeight)
    }
    // Final clamp — covers the (rare) case where the menu is larger than
    // the viewport in either dimension. Never push the menu past the right
    // / bottom edge; never above / left of the margin.
    x = Math.max(margin, Math.min(x, vw - effectiveWidth - margin))
    y = Math.max(margin, Math.min(y, vh - effectiveHeight - margin))
    setPointPosition({ x, y })
  })

  useLayoutEffect(() => {
    if (anchorRef) return
    recomputePointPosition()
    // `pointX`/`pointY` are deps so reopening the menu at a different
    // coordinate (the typical right-click flow) re-measures and re-flips.
  }, [anchorRef, pointX, pointY, recomputePointPosition])

  // Track the anchor's measured width so `matchAnchorWidth` dropdowns
  // can render flush with their trigger and respond to panel resizes.
  useLayoutEffect(() => {
    if (!matchAnchorWidth || !anchorRef) return
    const anchorEl = anchorRef.current
    if (!anchorEl) return
    setAnchorWidth(anchorEl.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setAnchorWidth(entry.contentRect.width)
    })
    observer.observe(anchorEl)
    return () => observer.disconnect()
  }, [matchAnchorWidth, anchorRef])

  useEffect(() => {
    function onViewportChange() {
      if (anchorRef) recomputeAutoPosition()
      else recomputePointPosition()
    }
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [anchorRef, recomputeAutoPosition, recomputePointPosition])

  // Resolve the effective x/y the menu renders at:
  //   - anchor mode: use the auto-flipped position (or hide until measured)
  //   - point mode:  use the viewport-clamped position (or hide until measured)
  const resolvedX = anchorRef ? autoPosition?.x : pointPosition?.x
  const resolvedY = anchorRef ? autoPosition?.y : pointPosition?.y
  const resolvedSide: ResolvedFloatingSide | undefined = anchorRef
    ? autoPosition?.side
    : undefined

  // While we measure the menu (either mode), render it off-screen with
  // visibility:hidden so it doesn't flash at (0, 0) before the layout
  // effect runs.
  const measuring = anchorRef
    ? autoPosition === null
    : pointX != null && pointY != null && pointPosition === null

  const style = {
    '--context-menu-x': `${resolvedX ?? 0}px`,
    '--context-menu-y': `${resolvedY ?? 0}px`,
    '--context-menu-min-width': `${minWidth}px`,
    '--context-menu-width': `${effectiveWidth}px`,
    '--context-menu-z-index': zIndex,
    ...(maxHeight != null ? { '--context-menu-max-height': `${maxHeight}px` } : null),
    ...(measuring ? { visibility: 'hidden' as const } : null),
  } as CSSProperties

  // Non-modal dismiss: any click outside the menu, the explicit triggerRef
  // (if set), and the anchor element (if set) closes the menu. The anchor
  // is included so anchored dropdowns don't re-close themselves when the
  // user clicks the trigger that just opened them.
  useEffect(() => {
    if (!triggerRef && !anchorRef) return
    function handlePointerDown(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (menuRef.current?.contains(target)) return
      if (triggerRef?.current?.contains(target)) return
      if (anchorRef?.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', handlePointerDown, true)
    document.addEventListener('contextmenu', handlePointerDown, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true)
      document.removeEventListener('contextmenu', handlePointerDown, true)
    }
  }, [onClose, triggerRef, anchorRef])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
    onKeyDown?.(event)
  }

  const menu = (
    <div
      ref={setMenuRef}
      role="menu"
      aria-label={ariaLabel}
      className={cn(styles.menu, menuClassName)}
      data-side={resolvedSide}
      data-scrollable={maxHeight != null ? '' : undefined}
      style={style}
      onKeyDown={handleKeyDown}
      {...domProps}
    >
      {children}
    </div>
  )

  // Non-modal mode (combobox-style or anchor-positioned dropdown): no
  // backdrop, document listener handles dismiss when triggerRef is set.
  if (triggerRef || anchorRef) return menu

  // Modal mode (right-click context menu): invisible backdrop intercepts clicks.
  return (
    <>
      <div
        className={styles.backdrop}
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault()
          onClose()
        }}
        style={style}
      />
      {menu}
    </>
  )
})

/**
 * Stable callback wrapper — the latest function is read on each invocation,
 * so effects can depend on the wrapper without re-subscribing every render.
 *
 * Equivalent to React's experimental `useEvent`; inlined here to avoid
 * pulling a third-party dep just for this one use.
 */
function useEvent<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn {
  const ref = useRef(fn)
  useLayoutEffect(() => {
    ref.current = fn
  })
  // useCallback returns a stable wrapper that reads the latest function
  // off the ref when invoked — so callers see a stable identity but always
  // call the latest closure. Reading `ref.current` happens at call time,
  // not during render.
  return useCallback((...args: TArgs) => ref.current(...args), [])
}

interface ContextMenuItemProps extends Omit<ButtonProps, 'variant' | 'size' | 'menuItem' | 'tone'> {
  danger?: boolean
}

export const ContextMenuItem = forwardRef<HTMLButtonElement, ContextMenuItemProps>(
  function ContextMenuItem({ danger = false, className, children, ...props }, ref) {
    return (
      <Button
        ref={ref}
        variant="ghost"
        size="xs"
        menuItem
        role="menuitem"
        tone={danger ? 'danger' : 'default'}
        className={cn(styles.item, className)}
        {...props}
      >
        {children}
      </Button>
    )
  },
)

export function ContextMenuSeparator() {
  return <Separator spacing="compact" className={styles.separator} />
}

// ---------------------------------------------------------------------------
// ContextMenuSubmenu
// ---------------------------------------------------------------------------

interface ContextMenuSubmenuProps {
  /** Trigger label — displayed on the submenu row */
  label: ReactNode
  /** Optional icon shown to the left of the label (use pixel-art-icons) */
  icon?: ReactNode
  /**
   * Called after a submenu item is clicked — typically the parent menu's
   * `onClose` handler so the entire menu closes when an item is selected.
   */
  onClose?: () => void
  /** Submenu items — typically `ContextMenuItem` elements */
  children: ReactNode
  /** z-index base for the submenu panel (submenu uses zIndex + 10). Default: 1000 */
  zIndex?: number
  /** Submenu panel width in px. Default: 176. */
  width?: number
  /** Submenu panel min-width in px. Default: same as `width`. */
  minWidth?: number
  /**
   * Maximum height of the submenu panel in px. When set, the panel scrolls
   * vertically (`overflow-y: auto`) and the height is clamped to
   * `min(maxHeight, 100vh - 16px)` so it never overflows the viewport. Use
   * for searchable submenus with long item lists.
   */
  maxHeight?: number
  /**
   * When true, panel-level clicks DO NOT auto-close the submenu — only clicks
   * on a `[role="menuitem"]` descendant (or its children) close it. Use this
   * for searchable submenus that contain non-menuitem widgets (e.g. a search
   * input) where clicking the input must not dismiss the menu.
   *
   * Default: false (legacy behavior — any click inside the submenu closes).
   */
  closeOnItemClickOnly?: boolean
}

/**
 * Nested submenu trigger for ContextMenu.
 *
 * Renders a trigger row (role="menuitem") with a trailing chevron. Hovering
 * or pressing ArrowRight opens a positioned submenu panel to the right.
 * ArrowLeft or Escape closes the submenu without closing the parent menu.
 * Clicking a submenu item calls `onClose` (if provided) to close the parent.
 *
 * Usage:
 * ```tsx
 * <ContextMenuSubmenu label="Insert here" icon={<PlusIcon size={12} />} onClose={close}>
 *   <ContextMenuItem onClick={...}>Item A</ContextMenuItem>
 * </ContextMenuSubmenu>
 * ```
 */
/** Submenu side priority — prefer right, flip to left when it doesn't fit. */
const SUBMENU_AUTO_PRIORITY = ['right', 'left'] as const

export function ContextMenuSubmenu({
  label,
  icon,
  onClose,
  children,
  zIndex = 1000,
  width = 176,
  minWidth,
  maxHeight,
  closeOnItemClickOnly = false,
}: ContextMenuSubmenuProps) {
  const [open, setOpen] = useState(false)
  // Position is `null` until the submenu has been measured (one
  // useLayoutEffect tick after mount). While `null`, the panel renders with
  // `visibility: hidden` so it doesn't flash at (0, 0).
  const [position, setPosition] = useState<{
    x: number
    y: number
    side: ResolvedFloatingSide
  } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resolvedMinWidth = minWidth ?? width

  // Measure trigger + submenu and pick the side with the most space.
  // Mirrors the ContextMenu (anchored mode) and Tooltip auto-flip strategy
  // — `computeFloatingPosition` tries `right` first, then `left`, and
  // clamps to the viewport so the panel never overflows the screen edge.
  const recomputePosition = useCallback(() => {
    const triggerEl = triggerRef.current
    const menuEl = submenuRef.current
    if (!triggerEl || !menuEl) return
    const triggerRect = triggerEl.getBoundingClientRect()
    const menuRect = menuEl.getBoundingClientRect()
    // When `maxHeight` is set, the rendered rect already reflects the cap
    // (CSS `max-height` is applied before getBoundingClientRect). Defensively
    // clamp here too so position math agrees with the rendered size on the
    // very first measurement.
    const effectiveHeight = maxHeight != null
      ? Math.min(menuRect.height, maxHeight)
      : menuRect.height
    const next = computeFloatingPosition(triggerRect, {
      floatingWidth: width,
      floatingHeight: effectiveHeight,
      side: 'auto',
      align: 'start',
      offset: 2,
      autoPriority: SUBMENU_AUTO_PRIORITY,
    })
    setPosition({ x: next.x, y: next.y, side: next.side })
  }, [maxHeight, width])

  // Measure on open. useLayoutEffect runs synchronously after the panel
  // mounts, so the user never sees the unmeasured (0, 0) frame.
  // No-op when closed — the panel isn't in the DOM, and `position` is
  // inherently a property of "the open submenu", so dropping a stale value
  // on close is unnecessary (the next open re-measures and overwrites).
  useLayoutEffect(() => {
    if (!open) return
    recomputePosition()
  }, [open, recomputePosition])

  // Recompute on viewport changes while open — same pattern as ContextMenu.
  useEffect(() => {
    if (!open) return
    function onViewportChange() {
      recomputePosition()
    }
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [open, recomputePosition])

  // Open submenu: show panel, auto-focus first item via rAF (rAF runs AFTER
  // the layout effect, so the panel is already positioned).
  function openSubmenu() {
    setOpen(true)
    requestAnimationFrame(() => {
      const first = submenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')
      first?.focus()
    })
  }

  // Schedule a delayed close — cancelled if mouse re-enters trigger or submenu.
  function scheduleClose() {
    closeTimerRef.current = setTimeout(() => {
      setOpen(false)
      closeTimerRef.current = null
    }, 100)
  }

  function cancelClose() {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  function handleTriggerClick() {
    if (open) {
      setOpen(false)
    } else {
      openSubmenu()
    }
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      openSubmenu()
    }
  }

  function handleSubmenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft' || event.key === 'Escape') {
      // Close submenu only — stop propagation so parent ContextMenu's
      // Escape handler does NOT fire (closing submenu ≠ closing parent).
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const items = [
        ...(submenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
      ]
      const currentIndex = items.indexOf(document.activeElement as HTMLElement)
      const next = currentIndex + (event.key === 'ArrowDown' ? 1 : -1)
      if (next >= 0 && next < items.length) {
        items[next].focus()
      }
    }
  }

  // Default: any click inside the submenu panel closes both submenu and parent.
  // When `closeOnItemClickOnly` is set, ignore clicks that don't land on (or
  // inside) a `[role="menuitem"]` — useful for searchable submenus where the
  // panel hosts non-menuitem widgets like a search input.
  function handleSubmenuClick(event: React.MouseEvent<HTMLDivElement>) {
    if (closeOnItemClickOnly) {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (!target.closest('[role="menuitem"]')) return
    }
    setOpen(false)
    onClose?.()
  }

  return (
    <div className={styles.submenuRoot}>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="xs"
        menuItem
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        fullWidth
        align="between"
        className={cn(styles.item, styles.submenuTrigger)}
        onMouseEnter={() => {
          cancelClose()
          openSubmenu()
        }}
        onMouseLeave={scheduleClose}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={styles.submenuTriggerContent}>
          {icon && <span aria-hidden="true">{icon}</span>}
          {label}
        </span>
        <span aria-hidden="true" className={styles.submenuChevron}>
          <ChevronRightIcon size={10} color="currentColor" />
        </span>
      </Button>
      {open && typeof document !== 'undefined' && createPortal(
        // The panel is portaled to document.body so its viewport-pixel
        // positioning (set via CSS custom properties on `style`) escapes
        // any `overflow: hidden` / `transform` / `contain` ancestor that
        // would otherwise clip or re-anchor it. The DOM-tree relationship
        // between trigger and panel is unchanged for accessibility — the
        // ARIA wiring lives on attributes (aria-haspopup / role="menu"),
        // not the DOM hierarchy.
        //
        // While `position` is null we render with `visibility: hidden` so
        // the panel doesn't flash at (0, 0) before the layout effect has
        // measured it — same trick as the anchored ContextMenu mode above.
        <div
          ref={submenuRef}
          role="menu"
          aria-label={typeof label === 'string' ? label : undefined}
          className={styles.menu}
          data-scrollable={maxHeight != null ? '' : undefined}
          data-side={position?.side}
          style={{
            '--context-menu-x': `${position?.x ?? 0}px`,
            '--context-menu-y': `${position?.y ?? 0}px`,
            '--context-menu-z-index': zIndex + 10,
            '--context-menu-min-width': `${resolvedMinWidth}px`,
            '--context-menu-width': `${width}px`,
            ...(maxHeight != null
              ? { '--context-menu-max-height': `${maxHeight}px` }
              : null),
            ...(position === null ? { visibility: 'hidden' as const } : null),
          } as CSSProperties}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onKeyDown={handleSubmenuKeyDown}
          onClick={handleSubmenuClick}
        >
          {children}
        </div>,
        document.body,
      )}
    </div>
  )
}
