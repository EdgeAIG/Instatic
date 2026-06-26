# Command Spotlight E2E Test Plan

Scenario rows for the ⌘K / Ctrl+K command palette, following the
`docs/e2e/protocol.md` format. Use `docs/e2e/run-log-template.md` for
per-run logging.

**Default environment:** same as the core lifecycle — `bun run dev` with
`DATABASE_URL=sqlite:./.tmp/e2e-agent.db`.

All scenarios in this file assume the user is **logged in** as the site owner
unless stated otherwise. Priority codes follow `docs/e2e/feature-matrix.md`.

**Playwright automation status:** SPOT-001 through SPOT-013 have Playwright
regression coverage in `tests/e2e/command-palette.e2e.ts`.

---

## Scenarios

| ID | Priority | Area | User Goal | Setup | Path | Expected Outcome | Watch For |
|---|---:|---|---|---|---|---|---|
| SPOT-001 | P1 | Open/Close | Open palette with ⌘K, close with Esc | Logged in admin | Press ⌘K (or Ctrl+K on non-Mac) | Palette overlays the admin UI, focused input, backdrop visible. Esc dismisses. | Focus not trapped outside dialog; palette fails to open on first press |
| SPOT-002 | P1 | Navigation | Type a query, press Enter, navigate to expected workspace | Logged in, Site workspace | Open palette, type "content", highlight "Go to Content", press Enter | Admin navigates to /admin/content | Wrong workspace navigated; no navigation at all |
| SPOT-003 | P2 | Subcommand | Push a scope and pick an item | Logged in, Site workspace with viewport contexts | Open palette, type "viewport", highlight "Switch viewport →", press Enter/Tab, pick a viewport | Active viewport changes in the editor canvas bar | Scope never pushes; picking returns to wrong viewport |
| SPOT-004 | P1 | Destructive confirm | Run a destructive command — first Enter shows confirm, second runs | Logged in, multiple pages exist | Open palette, type "delete", highlight "Delete current page", press Enter once — confirm text appears; press Enter again — page deleted | Page is removed from the site tree | Confirm text not visible; double-Enter runs twice; confirm times out before second Enter |
| SPOT-005 | P2 | Destructive timeout | Wait 6 seconds after first Enter; confirm collapses | Logged in, page with deletable sibling | Open palette, trigger destructive first Enter, wait >5 s | Confirm prompt disappears; row returns to normal destructive styling | Timer fires too early or not at all; row stuck in confirm state |
| SPOT-006 | P1 | Empty state | Type a query with no matches; empty state shown | Logged in | Open palette, type "zzz-no-match-xkq" | Empty-state illustration and "No results for …" message are visible | Empty state appears for queries that should return results; empty state missing for truly unmatched queries |
| SPOT-007 | P2 | Context boost | "Duplicate layer" appears near top when a node is selected | Logged in, Site workspace, any node selected in editor | Open palette with node selected | "Duplicate layer" ranks in top 5 results | Command absent; not boosted relative to no-selection open |
| SPOT-008 | P2 | Recents | Recent commands appear at top of empty-query list after running one | Logged in | Run any command (e.g., Save), close, reopen palette, clear query | The recently run command appears in the "Recent" group at top | Recents not persisted across opens; wrong command shown; duplicates |
| SPOT-009 | P2 | AI panel context | ⌘K opens palette from inside the AI assistant panel | Logged in, AI panel open | Open AI assistant panel, focus a visible panel control, then press ⌘K | Palette opens normally with input focused; AI panel content remains visible behind the backdrop; Esc restores panel focus | ⌘K swallowed by AI panel; palette not accessible from panel context; focus lost after close |
| SPOT-010 | P2 | Async skeleton | Skeleton shimmer appears then disappears when async provider resolves | Logged in, Content workspace | Open palette, type a short query (≥ 2 chars) that triggers a provider | Skeleton rows appear briefly under the provider group header, then are replaced by real results | Skeleton never appears; skeleton never disappears; spinner instead of skeleton |
| SPOT-011 | P2 | Keyboard only | Full keyboard flow: open → navigate → run | Logged in | Focus an admin control, ⌘K, type a query, use ↑↓, Enter to run | All steps complete without mouse; focus stays in palette during navigation; command runs | Arrow keys scroll page instead of navigating rows; Enter submits form behind palette |
| SPOT-012 | P3 | Reduced motion | Open/close animations respect prefers-reduced-motion | Logged in, reduced-motion enabled | Open palette and drill into "Switch viewport →" | No slide/translateY animation; nested scope transition is opacity-only or instant | Slide animation still plays; page jumps on open |
| SPOT-013 | P3 | High contrast | Highlighted row is visually distinct in high contrast mode | Logged in, high contrast enabled | Open palette, search, navigate with arrows | Highlighted row has a visible 2px outline ring; match marks are legible | Row highlight invisible; marks blend into background |

---

## Assertions by Scenario

### SPOT-001 (Open/Close)

1. Pressing ⌘K mounts the palette overlay.
2. The input receives focus immediately.
3. The backdrop is visible (semi-opaque overlay behind the panel).
4. Pressing Esc dismisses the palette.
5. After Esc, focus returns to whichever element had focus before ⌘K.
6. Pressing ⌘K again reopens a fresh palette (empty query).
7. Clicking the backdrop (outside the panel) also dismisses.

### SPOT-002 (Navigation)

1. Typing "content" shows at least one "Go to Content" or "Content" result.
2. Pressing Enter on the highlighted result navigates to `/admin/content`.
3. The palette closes after navigation.
4. The URL bar reflects `/admin/content`.

### SPOT-003 (Subcommand push)

1. "Switch viewport →" appears in the result list.
2. Pressing Enter/Tab on it replaces the results list with breakpoint options.
3. A breadcrumb shows the current scope.
4. Pressing ↑↓ navigates breakpoint options.
5. Pressing Enter on a breakpoint option closes the palette and updates the active breakpoint.
6. Pressing ← or Backspace (empty input) pops the scope back to root.

### SPOT-004 (Destructive confirm)

1. The destructive command row is styled in danger color.
2. First Enter shows "Press ↵ again to confirm" text inline in the row.
3. Second Enter runs the command (page is deleted, palette closes).
4. A screen reader announces the confirm prompt (via `role="alert"` live region).

### SPOT-005 (Destructive timeout)

1. After triggering the confirm, the row shows confirm text.
2. After ~5 seconds without a second Enter, the confirm text disappears.
3. The row returns to normal destructive styling (no confirm state).

### SPOT-006 (Empty state)

1. Typing an unmatched query shows the empty-state UI.
2. The empty-state shows the query string highlighted/quoted.
3. A "no results" icon is displayed.

### SPOT-007 (Context boost)

1. With a node selected in the editor, open the palette.
2. Without any query, "Duplicate layer" appears in or near the top-5 results.
3. With a node deselected, "Duplicate layer" either disappears or ranks lower.

### SPOT-008 (Recents)

1. Run a command that does not disappear after run (e.g., "Save").
2. Close the palette.
3. Reopen — verify a "Recent" group appears at the top.
4. The previously run command is listed in that group.
5. The group does not appear if no commands have been run.

### SPOT-009 (AI panel context)

1. Open the AI panel (left sidebar).
2. Focus a visible control inside the AI panel.
3. Press ⌘K — the palette opens over the AI panel and focuses the palette input.
4. The AI panel content remains visible behind the backdrop.
5. Esc closes the palette; focus returns to the previously focused AI panel control.

### SPOT-010 (Async skeleton)

1. In Content or Media workspace, open the palette and type 2+ characters.
2. Within 500 ms, skeleton rows appear under the provider group label.
3. After results arrive, skeleton rows are replaced by actual result rows.
4. No lingering skeleton after results are shown.

### SPOT-011 (Keyboard only)

1. Without using a mouse, press ⌘K.
2. The input is focused (confirmed by visible cursor blinking).
3. Type a query, navigate with arrow keys — the highlighted row tracks correctly.
4. Press Enter — the command runs.
5. Palette closes after the command runs.

### SPOT-012 (Reduced motion)

1. Enable "Reduce motion" in the OS accessibility settings or via Playwright media emulation.
2. Open the palette — the panel has no translateY transform animation.
3. Navigate scopes — no slide-left/right animation; opacity cross-fade only or instant transition.

### SPOT-013 (High contrast)

1. Enable high contrast mode in the OS settings or via Playwright `prefers-contrast` + `forced-colors` emulation.
2. Open the palette and navigate with arrow keys.
3. The highlighted row is visually distinct from non-highlighted rows (2px ring or system highlight).
4. `<mark>` characters in search results are legible against the row background.

---

## Coverage Notes

- **SPOT-001 through SPOT-013** cover the primary user goals from spec §2 and §5.
- **SPOT-009** verifies the palette works in nested panel contexts.
- **SPOT-010** covers Phase 3 async provider skeletons with a held server-provider request (spec §5.3, §7).
- **SPOT-011** is an extended keyboard-only pass (mirrors A11Y-001/A11Y-002 for the palette).
- **SPOT-012 / SPOT-013** cover media-mode accessibility polish with browser media emulation.

These scenarios are appropriate for agent-browser testing per `docs/e2e/protocol.md`
because they require observing UI state, reading visible copy, and verifying
focus/navigation behavior — things that cannot be reliably inferred from unit tests alone.
