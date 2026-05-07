/**
 * Architecture Gate Tests — Phase 3: DOM Tree Panel
 *
 * Pre-registered gate tests for Phase 3 — DOM Tree Panel (Task #176).
 * Uses the adaptive-skip pattern — tests activate automatically when the
 * DomTreePanel implementation directory or files are created.
 *
 * ENFORCED CONSTRAINTS (from Contribution #437 / Guideline #318):
 *
 * 1. No `s.currentPage.nodes` full-map selector in DomTreePanel files.
 *    Subscribing to the full nodes map causes the ENTIRE tree to re-render on
 *    every single node change (1,000 nodes × every prop update = frame drops).
 *    Per-node render isolation: each TreeNode must subscribe only to its own
 *    node data (per-node selector keyed by nodeId).
 *    Budget: 1,000-node initial render < 50ms (Guideline #318).
 *
 * 2. No `store.setState` / `useEditorStore.setState` inside `pointermove` or
 *    `onPointerMove` handlers.
 *    Zustand setState inside pointermove fires 60+ re-renders/second during drag.
 *    Position must be tracked via refs during drag; store updated only on pointerUp.
 *    Budget: drag-to-reorder must be 60fps (Guideline #318).
 *
 * 3. `expandedNodeIds` must NOT live in `siteSlice.ts`.
 *    Expand/collapse is ephemeral UI state — not part of the saved site.
 *    If stored in siteSlice, every tree expand/collapse triggers autosave and
 *    appears in undo history, which is incorrect behaviour.
 *    Must live in a dedicated UI-only slice (domTreeSlice or uiSlice).
 *
 * @see Contribution #437 — Phase 3 DOM Tree Panel Performance Spec (Performance Engineer)
 * @see Guideline #318 — Phase 3 DOM Tree Panel merge gate
 * @see Contribution #442 — Phase 3 Accessibility Additions (UX Reviewer)
 * @see Guideline #321 — Phase 3 Implementation Architecture (Architect)
 */

import { describe, it, expect } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, extname } from 'path'

const SRC_ROOT = join(import.meta.dir, '../../')
const PROJECT_SLICE_PATH = join(SRC_ROOT, 'core/editor-store/slices/siteSlice.ts')

// Phase 3 DOM Tree Panel can live in either of these directories:
const DOM_PANEL_DIRS = [
  join(SRC_ROOT, 'editor/components/DomTreePanel'),
  join(SRC_ROOT, 'editor/components/DomPanel'),
]

function findDomPanelDir(): string | null {
  return DOM_PANEL_DIRS.find(existsSync) ?? null
}

// ---------------------------------------------------------------------------
// File walker
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

function domPanelFiles(): string[] {
  const dir = findDomPanelDir()
  return dir ? collectTs(dir) : []
}

// Whether Phase 3 has been partially or fully implemented
// (the DomPanel directory already exists with stub files — gates activate)
const DOM_PANEL_IMPLEMENTED = existsSync(DOM_PANEL_DIRS[1])

// DomTreeContext source path (either naming convention)
function findDomTreeContextFile(): string | null {
  const dir = findDomPanelDir()
  if (!dir) return null
  const candidates = [
    join(dir, 'DomTreeContext.tsx'),
    join(dir, 'DomTreeContext.ts'),
    join(dir, 'TreeContext.tsx'),
    join(dir, 'TreeContext.ts'),
  ]
  return candidates.find(existsSync) ?? null
}

// TreeNode source path
function findTreeNodeFile(): string | null {
  const dir = findDomPanelDir()
  if (!dir) return null
  const candidates = [
    join(dir, 'TreeNode.tsx'),
    join(dir, 'TreeNode.ts'),
    join(dir, 'DomTreeNode.tsx'),
  ]
  return candidates.find(existsSync) ?? null
}

// ---------------------------------------------------------------------------
// Gate 1 — No full-nodes-map selector in DomTreePanel files
//
// Context: Guideline #318, Contribution #437.
// Subscribing to `s.currentPage.nodes` (the full flat map) causes every TreeNode
// to re-render when ANY node changes — O(n) re-renders per edit.
// The correct pattern is a per-node selector: useEditorStore(s => s.currentPage?.nodes[nodeId])
// Budget: 1,000-node initial render < 50ms; canvas click → row highlight ≤ 16ms.
// ---------------------------------------------------------------------------

describe('Phase 3 Gate 1 — No full-nodes-map selector in DomTreePanel (Guideline #318)', () => {
  it('[gate] DomTreePanel files must not subscribe to the full nodes map', () => {
    if (!DOM_PANEL_IMPLEMENTED) {
      console.log(
        '[Phase3 gate] DomTreePanel not yet fully implemented — ' +
        'full-nodes-map selector gate pre-registered (Contribution #437 / Guideline #318)'
      )
      expect(true).toBe(true)
      return
    }

    // Patterns that subscribe to the full nodes map — O(n) re-render on every edit
    const FULL_MAP_PATTERNS = [
      /useEditorStore\s*\(\s*[^)]*\.nodes\b(?!\s*\[\s*\w)/,   // s.nodes (without keyed access)
      /useEditorStore\s*\(\s*s\s*=>\s*s\.currentPage\??\s*\.\s*nodes\s*\)/,  // s.currentPage.nodes
      /useEditorStore\s*\(\s*s\s*=>\s*s\.site\??\s*\..+\.nodes\s*\)/,    // deep .nodes
    ]

    const violations: string[] = []

    for (const file of domPanelFiles()) {
      let src: string
      try { src = readFileSync(file, 'utf8') } catch { continue }

      if (!src.includes('.nodes')) continue

      const lines = src.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (/^\s*\/\//.test(line)) continue

        if (FULL_MAP_PATTERNS.some((re) => re.test(line))) {
          violations.push(
            `${file.replace(SRC_ROOT, 'src/')}:${i + 1} — ` +
            'full nodes-map subscription (causes O(n) re-renders)'
          )
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        '[Phase 3 perf / Guideline #318] Full nodes-map selector found in DomTreePanel files.\n' +
        'Subscribing to the entire nodes map re-renders ALL tree nodes on every single\n' +
        'property change — 1,000 nodes × 60Hz drag = frame budget exceeded instantly.\n' +
        'Required pattern: per-node selector\n' +
        '  const node = useEditorStore(s => s.currentPage?.nodes[nodeId])\n' +
        'Violations:\n' +
        violations.map((v) => `  ${v}`).join('\n')
      )
    }

    expect(violations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Gate 2 — No store.setState inside pointermove / onPointerMove handlers
//
// Context: Guideline #318, Contribution #437.
// Calling Zustand setState inside a pointermove handler fires React re-renders
// at 60+ Hz — immediately exceeds the 16ms frame budget for the entire editor.
// Drag position MUST be tracked via useRef during the move; Zustand is called
// once on pointerUp to commit the final reorder.
// Budget: drag-to-reorder must be 60fps (Guideline #318).
// ---------------------------------------------------------------------------

describe('Phase 3 Gate 2 — No store.setState inside pointermove handlers (Guideline #318)', () => {
  it('[gate] DomTreePanel files must not call store.setState inside pointermove', () => {
    if (!DOM_PANEL_IMPLEMENTED) {
      console.log(
        '[Phase3 gate] DomTreePanel not yet fully implemented — ' +
        'pointermove setState gate pre-registered (Contribution #437 / Guideline #318)'
      )
      expect(true).toBe(true)
      return
    }

    // Patterns: setState / useEditorStore.getState().xxx appearing inside a
    // pointermove handler function body. We detect by proximity (same line or
    // within a handler string containing "pointermove").
    const POINTER_MOVE_HANDLER_RE = /pointermove|onPointerMove/i
    const SET_STATE_RE = /\bsetState\s*\(|\buseEditorStore\.getState\(\)\.[a-z]/

    const violations: string[] = []

    for (const file of domPanelFiles()) {
      let src: string
      try { src = readFileSync(file, 'utf8') } catch { continue }

      if (!POINTER_MOVE_HANDLER_RE.test(src)) continue
      if (!SET_STATE_RE.test(src)) continue

      // Find handler blocks: look for pointermove registration + setState nearby
      // Strategy: scan for addEventListener('pointermove' or onPointerMove=
      // within ~20 lines of a setState call
      const lines = src.split('\n')
      let inHandlerDepth = 0
      let inPointerMoveBlock = false

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (/^\s*\/\//.test(line)) continue

        if (POINTER_MOVE_HANDLER_RE.test(line)) {
          inPointerMoveBlock = true
          inHandlerDepth = 0
        }

        if (inPointerMoveBlock) {
          inHandlerDepth += (line.match(/\{/g) || []).length
          inHandlerDepth -= (line.match(/\}/g) || []).length

          if (SET_STATE_RE.test(line)) {
            violations.push(
              `${file.replace(SRC_ROOT, 'src/')}:${i + 1} — ` +
              'store.setState called inside a pointermove handler (fires at 60Hz)'
            )
          }

          // Handler block closed
          if (inHandlerDepth <= 0 && i > 0) {
            inPointerMoveBlock = false
          }
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        '[Phase 3 perf / Guideline #318] store.setState called inside pointermove handler.\n' +
        'Zustand setState in pointermove fires React re-renders at 60+ Hz — instant jank.\n' +
        'Required: track drag position via useRef during move; call store.setState once on pointerUp.\n' +
        '  const dragPosRef = useRef<{ x: number; y: number } | null>(null)\n' +
        '  // pointermove: dragPosRef.current = { x: e.clientX, y: e.clientY }  ← ref only\n' +
        '  // pointerUp:   store.getState().moveNode(nodeId, target)             ← single setState\n' +
        'See Contribution #437, Hot Path 4 (drag-to-reorder).\n' +
        'Violations:\n' +
        violations.map((v) => `  ${v}`).join('\n')
      )
    }

    expect(violations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Gate 3 — expandedNodeIds must NOT live in siteSlice
//
// Context: Guideline #318, Contribution #437.
// Expand/collapse state is ephemeral UI state — it has no business being in
// the site document. If stored in siteSlice:
//   - Every tree expand/collapse fires autosave
//   - Expand/collapse appears in undo history (Ctrl+Z collapses a tree node!)
//   - SiteDocument grows with UI state that has no meaning on reload
// Required: expandedNodeIds lives in domTreeSlice, uiSlice, or local component state.
// ---------------------------------------------------------------------------

describe('Phase 3 Gate 3 — expandedNodeIds must NOT be in siteSlice (Guideline #318)', () => {
  it('[gate] siteSlice.ts must not contain expandedNodeIds', () => {
    if (!existsSync(PROJECT_SLICE_PATH)) {
      expect(true).toBe(true)
      return
    }

    const src = readFileSync(PROJECT_SLICE_PATH, 'utf-8')

    // expandedNodeIds in siteSlice means tree expand/collapse triggers
    // site autosave and pollutes undo history — incorrect by design.
    const hasExpandedInSite = /expandedNodeIds/.test(src)

    if (hasExpandedInSite) {
      throw new Error(
        '[Phase 3 arch / Guideline #318] `expandedNodeIds` found in siteSlice.ts.\n' +
        'Expand/collapse state is ephemeral UI state — must NOT be stored in the site.\n' +
        'If in siteSlice:\n' +
        '  - Every tree expand fires autosave (costly)\n' +
        '  - Expand/collapse appears in undo history (Ctrl+Z unexpectedly collapses a node)\n' +
        '  - Saved site contains meaningless UI state\n' +
        'Required: store expandedNodeIds in domTreeSlice (a UI-only slice) or uiSlice.\n' +
        'See Guideline #318 / Contribution #437.'
      )
    }

    expect(hasExpandedInSite).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Gate 4 — DomTreeContext must NOT carry selectedNodeId or hoveredNodeId
//
// Context: Guideline #352, Guideline #354, Contribution #497.
// React context bypasses React.memo(). Putting selectedNodeId or hoveredNodeId
// in the DomTreeContext causes every TreeNode to re-render on every canvas
// selection/hover event — O(N) re-renders per event.
//
// Pattern enforced here mirrors Phase 2 Gate 6 (CanvasSelectionContext):
//   - DomTreeContextValue interface must NOT declare selectedNodeId / hoveredNodeId
//   - createContext() default literal must NOT include those keys
//   - TreeNode must use per-node Zustand selectors (s.selectedNodeId === nodeId)
//     rather than destructuring from useContext()
//
// Required pattern per Guideline #354:
//   const isSelected = useEditorStore(useCallback(s => s.selectedNodeId === nodeId, [nodeId]))
//   const isHovered  = useEditorStore(useCallback(s => s.hoveredNodeId  === nodeId, [nodeId]))
//
// Budget: canvas click → ≤ 2 TreeNode re-renders (prev + next selected row).
// ---------------------------------------------------------------------------

describe('Phase 3 Gate 4 — DomTreeContext must not carry selectedNodeId/hoveredNodeId (Guideline #352/#354)', () => {
  it('DomTreeContextValue interface must not declare selectedNodeId or hoveredNodeId', () => {
    if (!DOM_PANEL_IMPLEMENTED) {
      console.log(
        '[Phase3 gate] DomPanel not yet implemented — ' +
        'DomTreeContext shape gate pre-registered (Guideline #352/#354)'
      )
      expect(true).toBe(true)
      return
    }

    const contextFile = findDomTreeContextFile()
    if (!contextFile) {
      // Context file not yet created — pre-registered
      expect(true).toBe(true)
      return
    }

    let src: string
    try { src = readFileSync(contextFile, 'utf8') } catch {
      expect(true).toBe(true)
      return
    }

    const rel = contextFile.replace(SRC_ROOT, 'src/')
    const violations: string[] = []
    const lines = src.split('\n')

    // Scan the DomTreeContextValue interface block for forbidden fields
    let insideContextInterface = false
    let interfaceBraceDepth = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const isComment = /^\s*(\/\/|\/\*|\*)/.test(line.trim())

      if (/interface\s+DomTreeContextValue/.test(line)) {
        insideContextInterface = true
        interfaceBraceDepth = 0
      }

      if (insideContextInterface) {
        interfaceBraceDepth += (line.match(/\{/g) ?? []).length
        interfaceBraceDepth -= (line.match(/\}/g) ?? []).length

        if (!isComment && /\bselectedNodeId\b|\bhoveredNodeId\b/.test(line)) {
          const match = /\bselectedNodeId\b/.test(line) ? 'selectedNodeId' : 'hoveredNodeId'
          violations.push(
            `${rel}:${i + 1} — DomTreeContextValue declares '${match}' ` +
            '(must not — context drives O(N) TreeNode re-renders per event; ' +
            'use per-node Zustand selector instead)'
          )
        }

        if (interfaceBraceDepth <= 0 && i > 0) {
          insideContextInterface = false
        }
      }
    }

    // Also check the createContext() default value literal
    const contextDefaultMatch = src.match(/createContext\s*(?:<[^>]*>)?\s*\(\s*\{([^}]*)\}/)
    if (contextDefaultMatch) {
      const defaultBody = contextDefaultMatch[1]
      if (/\bselectedNodeId\b/.test(defaultBody)) {
        violations.push(
          `${rel} — createContext() default includes 'selectedNodeId' ` +
          '(must be removed — DomTreeContext must carry only expand/collapse state)'
        )
      }
      if (/\bhoveredNodeId\b/.test(defaultBody)) {
        violations.push(
          `${rel} — createContext() default includes 'hoveredNodeId' ` +
          '(must be removed — DomTreeContext must carry only expand/collapse state)'
        )
      }
    }

    if (violations.length > 0) {
      throw new Error(
        '[Phase 3 perf / Guideline #352/#354] DomTreeContext carries selection/hover state.\n' +
        'React context bypasses React.memo() — every TreeNode re-renders when context value changes.\n' +
        'On a 500-node tree: 1 canvas selection event → 500 TreeNode re-renders.\n' +
        'DomTreeContext must carry ONLY expand/collapse state (expanded Set + toggle actions).\n' +
        'Each TreeNode subscribes to its own boolean via a per-node Zustand selector:\n' +
        '  const isSelected = useEditorStore(useCallback(s => s.selectedNodeId === nodeId, [nodeId]))\n' +
        '  const isHovered  = useEditorStore(useCallback(s => s.hoveredNodeId  === nodeId, [nodeId]))\n' +
        'See Guideline #352 (context anti-pattern), Guideline #354 (CanvasSelectionContext addendum).\n' +
        'Violations:\n' +
        violations.map((v) => `  ${v}`).join('\n')
      )
    }

    expect(violations).toHaveLength(0)
  })

  it('TreeNode.tsx must use per-node Zustand selectors for isSelected/isHovered, not useContext()', () => {
    if (!DOM_PANEL_IMPLEMENTED) {
      console.log(
        '[Phase3 gate] DomPanel not yet implemented — ' +
        'TreeNode per-node selector gate pre-registered (Guideline #352/#354)'
      )
      expect(true).toBe(true)
      return
    }

    const treeNodeFile = findTreeNodeFile()
    if (!treeNodeFile) {
      expect(true).toBe(true)
      return
    }

    let src: string
    try { src = readFileSync(treeNodeFile, 'utf8') } catch {
      expect(true).toBe(true)
      return
    }

    const rel = treeNodeFile.replace(SRC_ROOT, 'src/')
    const violations: string[] = []

    // 4a — Must contain per-node boolean selector for selection.
    // Multi-select (Task #multi-select): the canonical pattern is
    // `s.selectedNodeIds.includes(nodeId)` so every node in a multi-set shows
    // the selection ring. The legacy single-anchor pattern
    // (`s.selectedNodeId === nodeId`) is also accepted for components that
    // explicitly want anchor-only behavior (e.g. focus tracking).
    const hasSelectionSelector =
      /s\.selectedNodeIds\.includes\(nodeId\)/.test(src) ||
      /s\.selectedNodeId\s*===\s*nodeId/.test(src)
    if (!hasSelectionSelector) {
      violations.push(
        `${rel} — missing per-node Zustand selector: ` +
        'useEditorStore(useCallback(s => s.selectedNodeIds.includes(nodeId), [nodeId])). ' +
        'Without this, all N TreeNodes re-render on every canvas selection event.'
      )
    }

    // 4b — Must contain per-node boolean selector for hoveredNodeId
    if (!/s\.hoveredNodeId\s*===\s*nodeId/.test(src)) {
      violations.push(
        `${rel} — missing per-node Zustand selector: ` +
        'useEditorStore(useCallback(s => s.hoveredNodeId === nodeId, [nodeId])). ' +
        'Without this, all N TreeNodes re-render on every canvas hover event.'
      )
    }

    // 4c — Must NOT destructure selectedNodeId or hoveredNodeId from useContext / useDomTree
    // Strategy: find useContext()/useDomTree() call sites and check the destructuring block
    // that follows for selectedNodeId / hoveredNodeId.
    //
    // We walk backwards from any "selectedNodeId" or "hoveredNodeId" occurrence to find if
    // it's inside a destructuring block that originated from a useContext/useDomTree call.
    // (Same false-positive-safe approach as Phase 2 Gate 7.)
    const USE_CONTEXT_RE = /\buseDomTree\s*\(|\buseContext\s*\(\s*DomTreeContext/
    const contextCallLines: number[] = []
    const lines = src.split('\n')

    for (let i = 0; i < lines.length; i++) {
      if (USE_CONTEXT_RE.test(lines[i])) contextCallLines.push(i)
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (/\bselectedNodeId\b|\bhoveredNodeId\b/.test(line) && !/s\.\w+NodeId\s*===/.test(line)) {
        // Check if this line is in a destructuring block from a useDomTree/useContext call
        // Walk backward to find if we're inside a { ... } destructuring from context
        let braceDepth = 0
        for (let j = i; j >= Math.max(0, i - 15); j--) {
          braceDepth += (lines[j].match(/\}/g) ?? []).length
          braceDepth -= (lines[j].match(/\{/g) ?? []).length
          if (braceDepth < 0) {
            // We found an opening brace — check if this block is a useContext destructure
            const openLine = lines[j]
            if (USE_CONTEXT_RE.test(openLine) ||
                contextCallLines.some((cl) => Math.abs(cl - j) <= 2)) {
              const field = /\bselectedNodeId\b/.test(line) ? 'selectedNodeId' : 'hoveredNodeId'
              violations.push(
                `${rel}:${i + 1} — '${field}' destructured from useDomTree/useContext() ` +
                '(must use per-node Zustand selector instead — context read causes O(N) re-renders)'
              )
            }
            break
          }
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        '[Phase 3 perf / Guideline #352/#354] TreeNode selection/hover pattern violation.\n' +
        'Each TreeNode must subscribe to its own boolean selector from the Zustand store:\n' +
        '  // ✅ Correct — only the 2 affected rows re-render per event\n' +
        '  const isSelected = useEditorStore(useCallback(s => s.selectedNodeId === nodeId, [nodeId]))\n' +
        '  const isHovered  = useEditorStore(useCallback(s => s.hoveredNodeId  === nodeId, [nodeId]))\n' +
        '  // ❌ Wrong — passes through context → all N nodes re-render\n' +
        '  const { selectedNodeId } = useDomTree()\n' +
        '  const isSelected = selectedNodeId === nodeId\n' +
        'See Guideline #352 (context anti-pattern) and Guideline #354.\n' +
        'Violations:\n' +
        violations.map((v) => `  ${v}`).join('\n')
      )
    }

    expect(violations).toHaveLength(0)
  })
})
