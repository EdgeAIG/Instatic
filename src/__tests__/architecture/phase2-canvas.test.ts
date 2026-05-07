/**
 * Architecture Source-Scan — Phase 2 Infinite Canvas Safety Gates
 *
 * Pre-registered gate tests for the Phase 2 canvas implementation.
 * Uses the adaptive-skip pattern: tests skip with a clear log if the canvas
 * directory doesn't exist yet, and activate automatically when Phase 2 begins.
 *
 * ENFORCED CONSTRAINTS (from Contribution #431 / Guideline #315 +
 *                        Contribution #435 / Guideline #319 +
 *                        Constraint #317 / Guideline #221 / Guideline #294 +
 *                        Contribution #495 / #497 / Guideline #352):
 *
 * 1. No store.setState inside onPointerMove / pointermove handlers.
 *    `setState` triggers React re-renders. At 60Hz during a pan gesture,
 *    this blocks the UI thread and causes jank. Pan state must live in a
 *    ref during the gesture; `setState` only fires on pointerUp.
 *
 * 2. NodeRenderer must NOT subscribe to canvasTransform (zoom/pan).
 *    One transform change re-renders every mounted node. The canvas root
 *    applies the transform via CSS; NodeRenderer subscribes to its own
 *    node data only.
 *
 * 3. No React onWheel= prop on the canvas root element.
 *    React's synthetic wheel event is passive — `preventDefault()` silently
 *    fails and the browser scrolls anyway. The canvas root must use
 *    `addEventListener('wheel', handler, { passive: false })` in a useEffect.
 *
 * 4. No setInterval in canvas keyboard pan handlers.
 *    `setInterval` drifts and produces off-frame paints. Keyboard pan must
 *    use a requestAnimationFrame loop, started on keydown and cancelled on keyup.
 *
 * 5. CSS transform only — no style.left / style.top for pan/zoom.
 *    Layout properties trigger full reflow. The canvas root must use
 *    `style.transform = 'translate(x, y) scale(z)'` exclusively.
 *
 * 6. CanvasSelectionContext must carry ONLY stable callbacks — no selectedNodeId
 *    or hoveredNodeId fields. React context bypasses React.memo(); putting
 *    frequently-changing state here causes O(N) re-renders per event.
 *    (Contribution #495 / #497, Guideline #352)
 *
 * 7. NodeRenderer must subscribe to its own isSelected/isHovered booleans
 *    directly from the Zustand store — NOT via context destructuring.
 *    Per-node Zustand selectors limit re-renders to ≤ 2 nodes per event.
 *    (Contribution #495 / #497, Guideline #352)
 *
 * 8. useCanvas must NOT live-subscribe to s.zoom / s.panX / s.panY.
 *    Those values only seed the initial transform on mount; live subscriptions
 *    cause CanvasRoot to re-render on every 100ms debounced pan commit.
 *    Use useEditorStore.getState() in the mount effect instead.
 *    (Contribution #495 / #497, Guideline #315)
 *
 * @see Contribution #431 — Phase 2 Infinite Canvas Performance Spec (Performance Engineer)
 * @see Guideline #315 — Phase 2 merge gate (Performance Engineer)
 * @see Contribution #495 — Phase 2 canvas performance audit (Performance Engineer)
 * @see Contribution #497 — Phase 2 canvas perf fixes (Performance Engineer)
 * @see Guideline #352 — React Context Must Not Carry Frequently-Changing State
 */

import { describe, it, expect } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, extname } from 'path'

const SRC_ROOT = join(import.meta.dir, '../../')

// Phase 2 canvas implementation directory (expected location)
// Adjust if Full Stack Engineer places it elsewhere.
const CANVAS_DIRS = [
  join(SRC_ROOT, 'editor/components/Canvas'), // actual site layout
  join(SRC_ROOT, 'components/Canvas'),
  join(SRC_ROOT, 'editor/Canvas'),
  join(SRC_ROOT, 'ui/Canvas'),
  join(SRC_ROOT, 'Canvas'),
]

function findCanvasDir(): string | null {
  return CANVAS_DIRS.find(existsSync) ?? null
}

const PHASE2_CANVAS_DIR = findCanvasDir()
const PHASE2_IMPLEMENTED = PHASE2_CANVAS_DIR !== null

// ---------------------------------------------------------------------------
// File walker — same helper pattern as other architecture gates
// ---------------------------------------------------------------------------

function collectTs(dir: string): string[] {
  const results: string[] = []
  if (!existsSync(dir)) return results
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      results.push(...collectTs(full))
    } else if (['.ts', '.tsx'].includes(extname(entry))) {
      results.push(full)
    }
  }
  return results
}

function canvasFiles(): string[] {
  return PHASE2_CANVAS_DIR ? collectTs(PHASE2_CANVAS_DIR) : []
}

// ---------------------------------------------------------------------------
// Gate 1: No store.setState / store.set inside pointermove / onPointerMove
//
// Context: Contribution #431 / Guideline #315.
// setState inside pointermove fires 60+ React re-renders per second during
// a pan gesture — instant frame budget failure.
// Pan state must live in a ref (panRef.current = { x, y }) during gesture.
// Store update fires once on pointerUp only.
// ---------------------------------------------------------------------------

describe('Phase 2 — No store mutation inside pointermove handler (Guideline #315)', () => {
  it('[pre-registered] canvas files must not call setState/set inside onPointerMove', () => {
    if (!PHASE2_IMPLEMENTED) {
      console.log(
        '[Phase2 gate] Canvas directory not yet created — ' +
        'pointermove setState prohibition gate pre-registered (Contribution #431 / Guideline #315)'
      )
      expect(true).toBe(true)
      return
    }

    const violations: string[] = []

    for (const file of canvasFiles()) {
      let src: string
      try { src = readFileSync(file, 'utf8') } catch { continue }
      if (!src.includes('PointerMove') && !src.includes('pointermove')) continue

      const lines = src.split('\n')
      let insidePointerMoveHandler = false
      let braceDepth = 0
      let handlerStartDepth = 0

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        // Detect entry into a pointermove/onPointerMove handler body
        const isPointerMoveLine =
          /onPointerMove|pointermove/.test(line) &&
          !/\/\//.test(line.substring(0, line.search(/onPointerMove|pointermove/)))

        if (isPointerMoveLine) {
          insidePointerMoveHandler = true
          handlerStartDepth = braceDepth
        }

        if (insidePointerMoveHandler) {
          braceDepth += (line.match(/\{/g) ?? []).length
          braceDepth -= (line.match(/\}/g) ?? []).length

          // Check for setState / store.set patterns inside the handler
          if (
            /setState\s*\(|\.setState\s*\(|useEditorStore\.setState|store\.setState/.test(line) &&
            !/\/\//.test(line.trim().substring(0, line.trim().search(/setState/)))
          ) {
            const rel = file.replace(SRC_ROOT, 'src/')
            violations.push(
              `${rel}:${i + 1} — setState() called inside pointermove handler (causes 60+ re-renders/s)`
            )
          }

          // Exit handler when braces close back to entry depth
          if (braceDepth <= handlerStartDepth && braceDepth >= 0) {
            insidePointerMoveHandler = false
          }
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        '[Phase 2 perf / Guideline #315] setState inside pointermove handler.\n' +
        'Pan state must live in a ref during gesture: panRef.current = { x, y }\n' +
        'Call store.setState only on pointerUp to commit the final pan position.\n' +
        'See Contribution #431, Rule 2: "Ref during pan, Zustand only on pointerUp".\n' +
        'Violations:\n' +
        violations.map((v) => `  ${v}`).join('\n')
      )
    }

    expect(violations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Gate 2: NodeRenderer must NOT subscribe to canvasTransform
//
// Context: Contribution #431 / Guideline #315.
// One transform change re-renders every NodeRenderer instance.
// With 200 nodes that's 200 re-renders per wheel tick.
// The canvas root applies the CSS transform; NodeRenderer reads its own data.
// ---------------------------------------------------------------------------

describe('Phase 2 — NodeRenderer must not subscribe to canvasTransform (Guideline #315)', () => {
  it('[pre-registered] NodeRenderer.tsx must not select canvasTransform from store', () => {
    if (!PHASE2_IMPLEMENTED) {
      console.log(
        '[Phase2 gate] Canvas directory not yet created — ' +
        'NodeRenderer canvasTransform subscription gate pre-registered (Contribution #431 / Guideline #315)'
      )
      expect(true).toBe(true)
      return
    }

    // Find NodeRenderer file (it may exist in Canvas or elsewhere)
    const nodeRendererPaths = [
      join(PHASE2_CANVAS_DIR!, 'NodeRenderer.tsx'),
      join(PHASE2_CANVAS_DIR!, 'NodeRenderer.ts'),
      join(SRC_ROOT, 'components/Canvas/NodeRenderer.tsx'),
      join(SRC_ROOT, 'editor/Canvas/NodeRenderer.tsx'),
    ].filter(existsSync)

    if (nodeRendererPaths.length === 0) {
      // NodeRenderer not yet created — pre-registered
      expect(true).toBe(true)
      return
    }

    const violations: string[] = []

    for (const filePath of nodeRendererPaths) {
      let src: string
      try { src = readFileSync(filePath, 'utf8') } catch { continue }

      // canvasTransform, zoom, pan selectors inside NodeRenderer are dangerous
      if (/canvasTransform|\.zoom|\.pan\b/.test(src)) {
        // Check if it's inside a selector (useEditorStore call)
        const lines = src.split('\n')
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          if (/canvasTransform|s\.zoom|s\.pan\b|state\.zoom|state\.pan\b/.test(line) &&
              !/\/\//.test(line.trim())) {
            const rel = filePath.replace(SRC_ROOT, 'src/')
            violations.push(
              `${rel}:${i + 1} — NodeRenderer subscribes to canvas transform ` +
              '(causes full node tree re-render on every zoom/pan tick)'
            )
          }
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        '[Phase 2 perf / Guideline #315] NodeRenderer subscribes to canvasTransform.\n' +
        'One transform change re-renders every mounted NodeRenderer simultaneously.\n' +
        'The canvas root applies the CSS transform; NodeRenderer reads its own node data only.\n' +
        'Rule: NodeRenderer selector must NOT reference zoom, pan, or canvasTransform.\n' +
        'See Contribution #431, Rule 3.\n' +
        'Violations:\n' +
        violations.map((v) => `  ${v}`).join('\n')
      )
    }

    expect(violations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Gate 3: No React onWheel= prop on canvas root
//
// Context: Contribution #431 / Guideline #315.
// React's synthetic onWheel is passive — event.preventDefault() silently
// fails and the browser scrolls the page behind the canvas.
// The canvas root must register a non-passive native wheel listener via
// addEventListener('wheel', handler, { passive: false }) in a useEffect/ref.
// ---------------------------------------------------------------------------

describe('Phase 2 — No React onWheel= on canvas root (must use native listener)', () => {
  it('[pre-registered] CanvasRoot must not use onWheel= React prop', () => {
    if (!PHASE2_IMPLEMENTED) {
      console.log(
        '[Phase2 gate] Canvas directory not yet created — ' +
        'onWheel React prop prohibition gate pre-registered (Contribution #431 / Guideline #315)'
      )
      expect(true).toBe(true)
      return
    }

    // Focus check on CanvasRoot / canvas root component files
    const canvasRootPaths = [
      join(PHASE2_CANVAS_DIR!, 'CanvasRoot.tsx'),
      join(PHASE2_CANVAS_DIR!, 'Canvas.tsx'),
      join(PHASE2_CANVAS_DIR!, 'InfiniteCanvas.tsx'),
    ].filter(existsSync)

    if (canvasRootPaths.length === 0) {
      // Root component not yet created — pre-registered
      expect(true).toBe(true)
      return
    }

    // Detect JSX onWheel= attribute (React passive synthetic handler)
    const ON_WHEEL_JSX_RE = /\bonWheel\s*=/

    const violations: string[] = []

    for (const filePath of canvasRootPaths) {
      let src: string
      try { src = readFileSync(filePath, 'utf8') } catch { continue }

      if (ON_WHEEL_JSX_RE.test(src)) {
        const lines = src.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (ON_WHEEL_JSX_RE.test(lines[i]) && !/\/\//.test(lines[i].trim())) {
            const rel = filePath.replace(SRC_ROOT, 'src/')
            violations.push(
              `${rel}:${i + 1} — onWheel= React prop detected ` +
              '(must use addEventListener with { passive: false })'
            )
          }
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        '[Phase 2 perf / Guideline #315] React onWheel= on canvas root.\n' +
        "React's onWheel is passive — event.preventDefault() silently fails.\n" +
        'The browser scrolls the page behind the canvas instead of zooming.\n' +
        'Required:\n' +
        '  useEffect(() => {\n' +
        "    const el = canvasRef.current\n" +
        "    el.addEventListener('wheel', handleWheel, { passive: false })\n" +
        "    return () => el.removeEventListener('wheel', handleWheel)\n" +
        '  }, [])\n' +
        'See Contribution #431, Rule 4.\n' +
        'Violations:\n' +
        violations.map((v) => `  ${v}`).join('\n')
      )
    }

    expect(violations).toHaveLength(0)
  })

  it('useCanvas must not route wheel pan/zoom through @use-gesture React handlers', () => {
    const useCanvasPaths = [
      join(SRC_ROOT, 'editor/hooks/useCanvas.ts'),
      join(SRC_ROOT, 'editor/hooks/useCanvas.tsx'),
      join(PHASE2_CANVAS_DIR!, 'useCanvas.ts'),
      join(PHASE2_CANVAS_DIR!, 'useCanvas.tsx'),
    ].filter(existsSync)

    if (useCanvasPaths.length === 0) {
      // Hook not yet created — pre-registered
      expect(true).toBe(true)
      return
    }

    const violations: string[] = []

    for (const filePath of useCanvasPaths) {
      const src = readFileSync(filePath, 'utf8')
      const rel = filePath.replace(SRC_ROOT, 'src/')

      if (/\bonWheel\s*:/.test(src)) {
        violations.push(`${rel} — useGesture onWheel handler detected`)
      }

      if (/wheel\s*:\s*\{\s*eventOptions/.test(src)) {
        violations.push(`${rel} — useGesture wheel eventOptions detected`)
      }

      if (!/canvasRootRef/.test(src) || !/\.addEventListener\(\s*['"]wheel['"]/.test(src)) {
        violations.push(`${rel} — missing native canvas root wheel listener`)
      }
    }

    if (violations.length > 0) {
      throw new Error(
        '[Phase 2 perf / Guideline #315] Wheel pan/zoom must use a native non-passive listener.\n' +
        '@use-gesture bind() routes handlers through React synthetic events when no target is used;\n' +
        'those wheel events are passive and React clears currentTarget outside the event dispatch.\n' +
        'This causes passive preventDefault warnings and currentTarget null crashes when embedded\n' +
        'content such as the Three.js demo scene receives wheel hover events.\n' +
        'Required: attach canvas pan/zoom wheel handling with addEventListener on the canvas root ref,\n' +
        'and keep @use-gesture for drag/pinch only.\n' +
        'Violations:\n' +
        violations.map((v) => `  ${v}`).join('\n')
      )
    }

    expect(violations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Gate 4: No setInterval in canvas keyboard pan handlers
//
// Context: Contribution #431 / Guideline #315.
// setInterval drifts over time and produces off-frame paints.
// Keyboard pan must use a requestAnimationFrame (rAF) loop, started on
// keydown and cancelled on keyup, for frame-aligned smooth movement.
// ---------------------------------------------------------------------------

describe('Phase 2 — No setInterval in canvas keyboard pan (use rAF loop)', () => {
  it('[pre-registered] canvas files must not use setInterval for keyboard pan', () => {
    if (!PHASE2_IMPLEMENTED) {
      console.log(
        '[Phase2 gate] Canvas directory not yet created — ' +
        'setInterval keyboard pan prohibition gate pre-registered (Contribution #431 / Guideline #315)'
      )
      expect(true).toBe(true)
      return
    }

    // Detect setInterval usage in canvas files — it's only a problem when
    // used for keyboard-driven animation. Flag any occurrence for review.
    const SET_INTERVAL_RE = /\bsetInterval\s*\(/

    const violations: string[] = []

    for (const file of canvasFiles()) {
      let src: string
      try { src = readFileSync(file, 'utf8') } catch { continue }

      if (!SET_INTERVAL_RE.test(src)) continue

      const lines = src.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (SET_INTERVAL_RE.test(line) && !/\/\//.test(line.trim())) {
          const rel = file.replace(SRC_ROOT, 'src/')
          violations.push(
            `${rel}:${i + 1} — setInterval detected in canvas code ` +
            '(drifts over time; use requestAnimationFrame loop for keyboard pan)'
          )
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        '[Phase 2 perf / Guideline #315] setInterval in canvas code.\n' +
        'setInterval drifts and produces off-frame paints during keyboard pan.\n' +
        'Required pattern for keyboard pan:\n' +
        '  let rafId: number\n' +
        '  function tick() { pan(); rafId = requestAnimationFrame(tick) }\n' +
        '  document.addEventListener("keydown", (e) => { if (arrowKey(e)) tick() })\n' +
        '  document.addEventListener("keyup", () => cancelAnimationFrame(rafId))\n' +
        'See Contribution #431, Rule 5.\n' +
        'Violations:\n' +
        violations.map((v) => `  ${v}`).join('\n')
      )
    }

    expect(violations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Gate 5: CSS transform only for pan/zoom — no style.left / style.top
//
// Context: Contribution #431 / Guideline #315.
// Setting style.left or style.top on the canvas container triggers full
// layout reflow on the element and its descendants — an instant frame budget
// failure during continuous pan. CSS transform is composited on the GPU;
// it never triggers layout.
// ---------------------------------------------------------------------------

describe('Phase 2 — CSS transform only for pan/zoom, no style.left/style.top (Guideline #315)', () => {
  it('[pre-registered] canvas root must not set style.left or style.top for pan/zoom', () => {
    if (!PHASE2_IMPLEMENTED) {
      console.log(
        '[Phase2 gate] Canvas directory not yet created — ' +
        'style.left/style.top prohibition gate pre-registered (Contribution #431 / Guideline #315)'
      )
      expect(true).toBe(true)
      return
    }

    // Detect assignment to style.left / style.top (layout properties)
    // In the context of canvas pan — these are almost always bugs.
    // Allow JSX style={{ left: 0 }} for absolutely-positioned overlays (non-canvas).
    const STYLE_LEFT_RIGHT_RE = /\.style\.(left|top)\s*=/

    const violations: string[] = []

    for (const file of canvasFiles()) {
      let src: string
      try { src = readFileSync(file, 'utf8') } catch { continue }

      if (!STYLE_LEFT_RIGHT_RE.test(src)) continue

      const lines = src.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (STYLE_LEFT_RIGHT_RE.test(line) && !/\/\//.test(line.trim())) {
          const rel = file.replace(SRC_ROOT, 'src/')
          violations.push(
            `${rel}:${i + 1} — .style.left= or .style.top= detected ` +
            '(triggers layout reflow; use style.transform instead)'
          )
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        '[Phase 2 perf / Guideline #315] style.left/style.top used for canvas positioning.\n' +
        'Layout properties trigger full reflow on element and all descendants.\n' +
        'Required: style.transform = `translate(${x}px, ${y}px) scale(${zoom})`\n' +
        'CSS transform is GPU-composited and never triggers layout reflow.\n' +
        'See Contribution #431, Rule 1.\n' +
        'Violations:\n' +
        violations.map((v) => `  ${v}`).join('\n')
      )
    }

    expect(violations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Gate 6: CanvasSelectionContext must carry ONLY stable callbacks
//
// Context: Contribution #495 / #497, Guideline #352.
// Putting selectedNodeId or hoveredNodeId in the context bypasses React.memo()
// and causes every NodeRenderer to re-render on every hover/selection event —
// O(N) re-renders per event on a page with N nodes.
//
// The CanvasSelectionContextValue interface must have EXACTLY two fields:
//   onNodeClick and onNodeHover. No selectedNodeId. No hoveredNodeId.
// ---------------------------------------------------------------------------

describe('Phase 2 — CanvasSelectionContext must not carry selectedNodeId/hoveredNodeId (Guideline #352)', () => {
  it('CanvasSelectionContextValue interface must not declare selectedNodeId or hoveredNodeId', () => {
    if (!PHASE2_IMPLEMENTED) {
      console.log(
        '[Phase2 gate] Canvas directory not yet created — ' +
        'CanvasSelectionContext shape gate pre-registered (Contribution #495/#497, Guideline #352)'
      )
      expect(true).toBe(true)
      return
    }

    const nodeRendererPaths = [
      join(PHASE2_CANVAS_DIR!, 'NodeRenderer.tsx'),
      join(PHASE2_CANVAS_DIR!, 'NodeRenderer.ts'),
    ].filter(existsSync)

    if (nodeRendererPaths.length === 0) {
      // NodeRenderer not yet created — pre-registered
      expect(true).toBe(true)
      return
    }

    const violations: string[] = []

    for (const filePath of nodeRendererPaths) {
      let src: string
      try { src = readFileSync(filePath, 'utf8') } catch { continue }

      // Check the CanvasSelectionContextValue interface block for forbidden fields.
      const lines = src.split('\n')
      let insideContextInterface = false
      let interfaceBraceDepth = 0

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const isComment = /^\s*(\/\/|\/\*|\*)/.test(line.trim())

        if (/interface\s+CanvasSelectionContextValue/.test(line)) {
          insideContextInterface = true
          interfaceBraceDepth = 0
        }

        if (insideContextInterface) {
          interfaceBraceDepth += (line.match(/\{/g) ?? []).length
          interfaceBraceDepth -= (line.match(/\}/g) ?? []).length

          if (!isComment && /\bselectedNodeId\b|\bhoveredNodeId\b/.test(line)) {
            const rel = filePath.replace(SRC_ROOT, 'src/')
            const match = /\bselectedNodeId\b/.test(line) ? 'selectedNodeId' : 'hoveredNodeId'
            violations.push(
              `${rel}:${i + 1} — CanvasSelectionContextValue declares '${match}' ` +
              '(must not — context drives O(N) re-renders per event; use per-node Zustand selector instead)'
            )
          }

          if (interfaceBraceDepth <= 0 && i > 0) {
            insideContextInterface = false
          }
        }
      }

      // Also check the createContext() default value literal for these keys
      const contextDefaultMatch = src.match(/createContext\s*<[^>]*>\s*\(\s*\{([^}]*)\}/)
      if (contextDefaultMatch) {
        const defaultBody = contextDefaultMatch[1]
        if (/\bselectedNodeId\b/.test(defaultBody)) {
          const rel = filePath.replace(SRC_ROOT, 'src/')
          violations.push(
            `${rel} — createContext() default includes 'selectedNodeId' ` +
            '(must be removed — context shape must carry only callbacks)'
          )
        }
        if (/\bhoveredNodeId\b/.test(defaultBody)) {
          const rel = filePath.replace(SRC_ROOT, 'src/')
          violations.push(
            `${rel} — createContext() default includes 'hoveredNodeId' ` +
            '(must be removed — context shape must carry only callbacks)'
          )
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        '[Phase 2 perf / Guideline #352] CanvasSelectionContext carries selection/hover state.\n' +
        'React context bypasses React.memo() — every context consumer re-renders when value changes.\n' +
        'On a 500-node page: 1 hover event → 500 NodeRenderer re-renders (15,000/sec at 30Hz mouse).\n' +
        'Required fix: remove selectedNodeId/hoveredNodeId from CanvasSelectionContextValue.\n' +
        'The interface must contain ONLY: onNodeClick and onNodeHover callbacks.\n' +
        'Each NodeRenderer subscribes to its own boolean via a per-node Zustand selector instead.\n' +
        'See Contribution #495 (audit), #497 (fix), Guideline #352.\n' +
        'Violations:\n' +
        violations.map((v) => `  ${v}`).join('\n')
      )
    }

    expect(violations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Gate 7: NodeRenderer must use per-node Zustand selectors for isSelected/isHovered
//
// Context: Contribution #495 / #497, Guideline #352.
// Each NodeRenderer must subscribe to its own boolean:
//   useEditorStore(useCallback((s) => s.selectedNodeId === nodeId, [nodeId]))
//   useEditorStore(useCallback((s) => s.hoveredNodeId  === nodeId, [nodeId]))
//
// It must NOT destructure selectedNodeId or hoveredNodeId from useContext().
// Only the ≤ 2 nodes whose boolean flips will re-render on any event.
// ---------------------------------------------------------------------------

describe('Phase 2 — NodeRenderer must use per-node Zustand selectors (not context) for isSelected/isHovered (Guideline #352)', () => {
  it('NodeRenderer.tsx must contain per-node store selectors and must not read selectedNodeId/hoveredNodeId from context', () => {
    if (!PHASE2_IMPLEMENTED) {
      console.log(
        '[Phase2 gate] Canvas directory not yet created — ' +
        'NodeRenderer per-node selector gate pre-registered (Contribution #495/#497, Guideline #352)'
      )
      expect(true).toBe(true)
      return
    }

    const nodeRendererPaths = [
      join(PHASE2_CANVAS_DIR!, 'NodeRenderer.tsx'),
      join(PHASE2_CANVAS_DIR!, 'NodeRenderer.ts'),
    ].filter(existsSync)

    if (nodeRendererPaths.length === 0) {
      expect(true).toBe(true)
      return
    }

    const violations: string[] = []

    for (const filePath of nodeRendererPaths) {
      let src: string
      try { src = readFileSync(filePath, 'utf8') } catch { continue }

      const rel = filePath.replace(SRC_ROOT, 'src/')

      // 7a — Must contain per-node boolean selector for selection.
      // Multi-select (Task #multi-select): the canonical pattern is
      // `s.selectedNodeIds.includes(nodeId)` so every node in a multi-set
      // shows the selection ring. The legacy single-anchor pattern
      // (`s.selectedNodeId === nodeId`) is also accepted for components
      // that explicitly want anchor-only behavior.
      const hasSelectionSelector =
        /s\.selectedNodeIds\.includes\(nodeId\)/.test(src) ||
        /s\.selectedNodeId\s*===\s*nodeId/.test(src)
      if (!hasSelectionSelector) {
        violations.push(
          `${rel} — missing per-node Zustand selector: ` +
          'useEditorStore(useCallback((s) => s.selectedNodeIds.includes(nodeId), [nodeId])). ' +
          'Without this, all N nodes re-render on every selection event.'
        )
      }

      // 7b — Must contain per-node boolean selector for hoveredNodeId
      if (!/s\.hoveredNodeId\s*===\s*nodeId/.test(src)) {
        violations.push(
          `${rel} — missing per-node Zustand selector: ` +
          'useEditorStore(useCallback((s) => s.hoveredNodeId === nodeId, [nodeId])). ' +
          'Without this, all N nodes re-render on every hover event.'
        )
      }

      // 7c — Must NOT destructure selectedNodeId/hoveredNodeId from the useContext result.
      // We scan for `const { ... } = useContext(...)` blocks (potentially multi-line)
      // by looking for lines that contain a useContext() call and walking backwards
      // to find the opening `{` of the destructuring and forwards to the closing `}`.
      //
      // Example of the bad pattern:
      //   const { onNodeClick, onNodeHover, selectedNodeId } = useContext(CanvasSelectionContext)
      //
      // We do NOT flag `selectedNodeId` that appears in other contexts (e.g. the
      // per-node Zustand selector two lines above the useContext call).
      const lines = src.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (!/useContext\s*\(/.test(lines[i])) continue

        // Walk backward from the useContext line to find the `{` that starts
        // the const destructuring (handles multi-line destructures where the
        // `{` might be 3-5 lines above the `= useContext(...)` line).
        // We stop if we've gone too far back or hit a statement boundary (`;` / empty).
        let destructureContent = ''
        let foundOpenBrace = false

        // First check if the entire destructure is on one line
        // e.g.: const { onNodeClick, hoveredNodeId } = useContext(...)
        const singleLineMatch = lines[i].match(/const\s*\{([^}]*)\}\s*=\s*useContext\s*\(/)
        if (singleLineMatch) {
          destructureContent = singleLineMatch[1]
          foundOpenBrace = true
        } else {
          // Multi-line: scan backwards for the opening `{` with `const` before it
          for (let j = i; j >= Math.max(0, i - 10); j--) {
            const jl = lines[j]
            if (/const\s*\{/.test(jl)) {
              // Collect from opening brace to the useContext line
              const block = lines.slice(j, i + 1).join('\n')
              const match = block.match(/const\s*\{([^}]*)\}/)
              if (match) {
                destructureContent = match[1]
                foundOpenBrace = true
              }
              break
            }
            // Don't cross statement boundaries
            if (j < i && /;\s*$/.test(lines[j].trim())) break
          }
        }

        if (!foundOpenBrace) continue

        if (/\bselectedNodeId\b/.test(destructureContent)) {
          violations.push(
            `${rel}:${i + 1} — 'selectedNodeId' destructured from useContext(). ` +
            'Remove from context; subscribe via per-node Zustand selector instead.'
          )
        }
        if (/\bhoveredNodeId\b/.test(destructureContent)) {
          violations.push(
            `${rel}:${i + 1} — 'hoveredNodeId' destructured from useContext(). ` +
            'Remove from context; subscribe via per-node Zustand selector instead.'
          )
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        '[Phase 2 perf / Guideline #352] NodeRenderer uses context for selection/hover state.\n' +
        'Per-node Zustand boolean selectors are required:\n' +
        '  const isSelected = useEditorStore(useCallback((s) => s.selectedNodeId === nodeId, [nodeId]))\n' +
        '  const isHovered  = useEditorStore(useCallback((s) => s.hoveredNodeId  === nodeId, [nodeId]))\n' +
        'And selectedNodeId/hoveredNodeId must NOT be destructured from useContext().\n' +
        'Result: only the ≤ 2 nodes whose boolean flips re-render per event (O(2) not O(N)).\n' +
        'See Contribution #495 (audit), #497 (fix), Guideline #352.\n' +
        'Violations:\n' +
        violations.map((v) => `  ${v}`).join('\n')
      )
    }

    expect(violations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Gate 8: useCanvas must NOT live-subscribe to s.zoom / s.panX / s.panY
//
// Context: Contribution #495 / #497, Guideline #315.
// These values are only needed once on mount to seed the transform ref.
// Live useEditorStore selectors fire on every 100ms debounced pan commit,
// causing CanvasRoot to re-render ~10×/second during active pan.
//
// Required: read via useEditorStore.getState() inside the mount useEffect.
// ---------------------------------------------------------------------------

describe('Phase 2 — useCanvas must not live-subscribe to s.zoom/s.panX/s.panY (Guideline #315)', () => {
  it('useCanvas.ts must not contain live useEditorStore subscriptions for zoom, panX, or panY', () => {
    if (!PHASE2_IMPLEMENTED) {
      console.log(
        '[Phase2 gate] Canvas directory not yet created — ' +
        'useCanvas zoom/pan subscription gate pre-registered (Contribution #495/#497, Guideline #315)'
      )
      expect(true).toBe(true)
      return
    }

    // useCanvas lives in src/editor/hooks/ (outside the canvas component dir)
    const USE_CANVAS_PATHS = [
      join(SRC_ROOT, 'editor/hooks/useCanvas.ts'),
      join(SRC_ROOT, 'editor/hooks/useCanvas.tsx'),
      join(PHASE2_CANVAS_DIR!, 'useCanvas.ts'),
      join(PHASE2_CANVAS_DIR!, 'useCanvas.tsx'),
    ].filter(existsSync)

    if (USE_CANVAS_PATHS.length === 0) {
      // useCanvas not yet created — pre-registered
      expect(true).toBe(true)
      return
    }

    // Patterns that indicate a live subscription to pan/zoom values.
    // A live subscription looks like:
    //   useEditorStore((s) => s.zoom)
    //   useEditorStore((s) => s.panX)
    //   useEditorStore(state => state.panY)
    // These fire on every store update — every 100ms during pan.
    //
    // Safe pattern: useEditorStore.getState().zoom — NOT a subscription.
    const LIVE_ZOOM_RE  = /useEditorStore\s*\(\s*(?:useCallback\s*\(\s*)?(?:\([^)]*\)|[a-zA-Z_$]\w*)\s*=>\s*[a-zA-Z_$]\w*\.zoom\b/
    const LIVE_PAN_X_RE = /useEditorStore\s*\(\s*(?:useCallback\s*\(\s*)?(?:\([^)]*\)|[a-zA-Z_$]\w*)\s*=>\s*[a-zA-Z_$]\w*\.panX\b/
    const LIVE_PAN_Y_RE = /useEditorStore\s*\(\s*(?:useCallback\s*\(\s*)?(?:\([^)]*\)|[a-zA-Z_$]\w*)\s*=>\s*[a-zA-Z_$]\w*\.panY\b/

    const violations: string[] = []

    for (const filePath of USE_CANVAS_PATHS) {
      let src: string
      try { src = readFileSync(filePath, 'utf8') } catch { continue }

      const rel = filePath.replace(SRC_ROOT, 'src/')
      const lines = src.split('\n')

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const isComment = /^\s*(\/\/|\/\*|\*)/.test(line.trim())
        if (isComment) continue

        if (LIVE_ZOOM_RE.test(line)) {
          violations.push(
            `${rel}:${i + 1} — live useEditorStore subscription to s.zoom detected. ` +
            'Re-renders CanvasRoot every 100ms during active pan. ' +
            'Fix: read once on mount via useEditorStore.getState().'
          )
        }
        if (LIVE_PAN_X_RE.test(line)) {
          violations.push(
            `${rel}:${i + 1} — live useEditorStore subscription to s.panX detected. ` +
            'Re-renders CanvasRoot every 100ms during active pan. ' +
            'Fix: read once on mount via useEditorStore.getState().'
          )
        }
        if (LIVE_PAN_Y_RE.test(line)) {
          violations.push(
            `${rel}:${i + 1} — live useEditorStore subscription to s.panY detected. ` +
            'Re-renders CanvasRoot every 100ms during active pan. ' +
            'Fix: read once on mount via useEditorStore.getState().'
          )
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        '[Phase 2 perf / Guideline #315] useCanvas live-subscribes to s.zoom/s.panX/s.panY.\n' +
        'These values are only read once on mount to seed the transform ref.\n' +
        'A live subscription fires every time the store commits a pan position (100ms cadence),\n' +
        'causing ~10 CanvasRoot re-renders/second during active pan — pure waste.\n' +
        'Required pattern (reads once on mount, no ongoing subscription):\n' +
        '  useEffect(() => {\n' +
        '    const { zoom, panX, panY } = useEditorStore.getState()\n' +
        '    transformRef.current = { zoom, panX, panY }\n' +
        '    applyTransformToDOM(transformRef.current)\n' +
        '  }, []) // intentionally run once on mount\n' +
        'See Contribution #495 (audit), #497 (fix), Guideline #315.\n' +
        'Violations:\n' +
        violations.map((v) => `  ${v}`).join('\n')
      )
    }

    expect(violations).toHaveLength(0)
  })
})
