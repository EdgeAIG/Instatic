# Canvas: iframe-per-breakpoint rendering

How the visual editor canvas renders page trees inside isolated per-breakpoint iframes, and how the design and live views are built on top of that foundation.

Each breakpoint frame runs in its own `<iframe>` with its own `<html><body>`. The page tree portals into the iframe body, so user CSS, combinators (`>`, `+`, `:nth-child()`), and viewport units behave exactly as on the published page — no selector rewriting, no scoping, no impedance mismatch.

---

## TL;DR

- `IframeFrameSurface` is the iframe primitive. It boots from an empty `srcDoc`, captures the iframe document, and mounts children via `createPortal(tree, iframeDoc.body)`.
- **Design mode** renders one `IframeFrameSurface` per breakpoint inside `CanvasTransformLayer` (pan/zoom). **Live mode** renders a single real-size `IframeFrameSurface` inside `CanvasLiveSurface` (normal scroll).
- Both modes are fully editable — click-to-select, properties panel, structural edits all work. Neither is a read-only preview.
- CSS arrives in each iframe via three injectors: `EditorChromeInjector` (unlayered), `ClassStyleInjector` (`@layer user-authored`), `UserStylesheetInjector` (`@layer user-authored`).
- Wheel events and pointer events are forwarded from inside the iframe to the parent's gesture / reorder-drag handlers.
- Plugin canvas modules use a separate, sandboxed `ModuleSandboxFrame` (not `IframeFrameSurface`).

---

## Why iframes

Without iframes, each breakpoint frame was a `<div>` inside the editor's document. Two structural mismatches made the canvas unreliable:

1. **`body` was the editor chrome.** `body { background: black }` painted the entire editor.
2. **NodeWrapper divs between authored elements.** CSS combinators (`>`, `+`, `~`, `:nth-child()`) saw wrapper divs, not authored elements, so authored selectors didn't match.

The iframe gives each frame its own real `<body>`. User CSS works unchanged. Modules spread editor-plumbing props (`data-node-id`, click/hover handlers) directly onto their root element — no `<div display:contents>` wrapper between siblings.

---

## IframeFrameSurface

Source: `src/admin/pages/site/canvas/IframeFrameSurface.tsx`

```text
IframeFrameSurface
  <iframe srcDoc="<!doctype html><html>…">
    (inside iframe document, via createPortal)
    ├── EditorChromeInjector   (head: unlayered editor chrome CSS)
    ├── ClassStyleInjector     (head: @layer user-authored — publisher reset + class registry)
    ├── UserStylesheetInjector (head: @layer user-authored — user-uploaded stylesheets)
    ├── {children}             (body: React node tree via NodeRenderer)
    └── RuntimeScriptInjector (body: opt-in runtime scripts when "Run scripts" is on)
```

### Interaction modes

`interaction` prop controls two distinct behaviours:

| Mode | `interaction` value | Height | Scroll | Wheel | Pointer | Canvas chrome CSS |
|---|---|---|---|---|---|---|
| Design canvas frame | `'canvas'` (default) | grows to content | none (frame scrolls with canvas pan) | forwarded to parent pan/zoom | forwarded for middle-click / space pan | applied (cursor, user-select, outline overrides) |
| Live frame | `'live'` | 100% | native (iframe is the scroll viewport) | not forwarded | not forwarded | not applied (real cursors, text selection) |

### Viewport-unit feedback loop guard

The canvas frame grows to content height (so no inner scrollbar appears on the infinite surface). `vh`/`vmin`/`vmax` units size against the iframe element's height — writing a new height feeds back into the viewport unit, which grows the content, which fires the observer again. The frame measures content inside a `requestAnimationFrame`, caps consecutive self-driven resizes at 60, and resets the cap on any DOM mutation that didn't come from its own height writes. When a long page is replaced by a shorter page, the measurement ignores `documentElement.scrollHeight` if it is only reporting the old iframe viewport floor, so frames can shrink to the new body content height.

---

## Design mode

Source: `src/admin/pages/site/canvas/CanvasTransformLayer.tsx`, `BreakpointFrame.tsx`

`CanvasRoot` renders `CanvasTransformLayer` when `canvasView === 'design'`. The transform layer contains one `BreakpointFrame` per breakpoint (filtered to `bp.previewFrame !== false`). Each frame wraps an `IframeFrameSurface` in `interaction='canvas'` mode with a label button above it.

Breakpoints flagged `previewFrame: false` are frameless — they're still selectable editing contexts in the context selector (breakpoint overrides route to them) but don't render a canvas iframe.

The active breakpoint (highlighted, drives style override routing) is tracked by `activeBreakpointId` in `canvasSlice`.

### Breakpoint activation UX

When a layer is selected **and** the Properties panel is open (`rightSidebarExpanded`), the design canvas enters a focused editing context that affects three behaviors:

**Inactive frame dimming.** Non-active breakpoint frames are dimmed to 0.42 opacity via the `frameWrapperDimmed` CSS class, controlled by the `dimInactiveBreakpoints` user preference (Canvas category in Settings → Preferences). This visually focuses the author on the breakpoint they're styling. The preference is on by default.

**Cursor-following activation tooltip.** Moving the cursor over an inactive frame shows a `CursorTooltip` reading "Click to activate [Breakpoint] breakpoint". The cursor coordinate is bridged from inside the iframe to the parent document by `useIframeCursorBridge`, which attaches a native `mousemove` listener inside the iframe document and forwards `MouseEvent` objects to the parent callback. `BreakpointFrame` calls `clientPointToEditorDoc` to convert these events into editor-document coordinates that the `CursorTooltip` can position against.

**Selection preservation on click.** Clicking a node on an inactive frame while a layer is already selected activates the new breakpoint (updates `activeBreakpointId`) but preserves the current selection instead of switching to the clicked node. Focus shifts to `'canvas'` so the Properties panel continues editing the same layer. This lets the author switch breakpoints without losing their place in the Properties panel. Clicking a node on an inactive frame when the Properties panel is collapsed (or nothing is selected) behaves normally — it activates the breakpoint and selects the clicked node.

---

## Live mode

Source: `src/admin/pages/site/canvas/CanvasLiveSurface.tsx`

`CanvasRoot` renders `CanvasLiveSurface` when `canvasView === 'live'`. It shows one `IframeFrameSurface` in `interaction='live'` mode:

- **Fluid + presets.** The frame fills available width by default. Selecting a narrower breakpoint in the toggle clamps the frame to `min(breakpoint.width, containerWidth)`.
- **Side handle resizing.** Left and right `LiveResizeHandle` divs let the author drag the frame width continuously between 240 px and the breakpoint's natural width. Switching breakpoints invalidates any active override — the frame snaps to the new breakpoint's width automatically.
- **Width badge.** A small `{N}px` indicator updates live while dragging.

Pan/zoom gestures are disabled in live mode (`useCanvas({ enabled: !isLive })`). The `CanvasModeToggle` shows an inline breakpoint icon row when live is active.

---

## CSS injection into iframes

Three `<style>` elements are injected per iframe, in this order:

| Injector | `id` attribute | Cascade layer | Purpose |
|---|---|---|---|
| `EditorChromeInjector` | `instatic-editor-chrome` | **unlayered** | Editor chrome: placeholder, slot-instance, unknown-module styles. Copies design tokens (`--editor-*`) from parent `:root` onto iframe `:root`. |
| `ClassStyleInjector` | `mc-classes` | `@layer user-authored` | Publisher reset + framework CSS + class registry CSS |
| `UserStylesheetInjector` | `mc-user-styles` | `@layer user-authored` | User-uploaded stylesheets (verbatim, unscoped) |

Unlayered rules always beat `@layer`-d rules regardless of specificity. User CSS can never override editor chrome even with a high-specificity selector.

`EditorChromeInjector` uses **stable `data-*` attribute selectors** (`data-canvas-module-placeholder`, `data-instatic-slot-instance`, etc.) — not hashed CSS Module class names which only exist in the parent document.

---

## Runtime scripts ("Run scripts" toggle)

Source: `useRuntimeScriptBuild.ts`, `RuntimeScriptInjector.tsx`

When the "Run scripts" toggle (`runScripts` in `canvasSlice`) is on, `CanvasRoot` calls `useRuntimeScriptBuild` to bundle the site's script files and inject them into every editable iframe. The bundle is shared across all frames (design and live) so it isn't rebuilt per frame.

Rebuild triggers: script file content changes, `packageJson` changes, `site.runtime` changes, or a manual Refresh. Node-tree edits do NOT trigger a rebuild — the bundle signature keys on script inputs only, not the page tree.

`RuntimeScriptInjector` appends `<script type="module">` elements imperatively (not via JSX) because browsers don't execute React-inserted `<script>` tags. Old `<script>` elements are removed before new ones are appended; removing them doesn't undo their side effects (registered listeners, injected DOM) — that's why the Refresh button re-runs them.

---

## Event handling across the iframe boundary

React synthetic events bubble through the React fiber tree, not the DOM tree, so click/hover/keyboard handlers in `NodeRenderer` fire normally even though the DOM is inside an iframe.

Native events require explicit forwarding for two cases:

- **Wheel events (design mode):** `IframeFrameSurface` listens for `wheel` inside the iframe document and re-dispatches a new `WheelEvent` on the iframe element (parent document) so `useCanvas`'s pan/zoom handler picks it up.
- **Pointer events (design mode):** Middle-click pan, space+left-click pan, and active reorder drags (`data-instatic-canvas-dragging` on `<html>`) all need to cross the iframe boundary. `IframeFrameSurface` tracks `spaceHeld` and `panPointerId` state to identify when a pointerdown starts a pan, then forwards `pointerdown`/`pointermove`/`pointerup`/`pointercancel` to the parent document.

Native mouse movement is also surfaced for editor chrome that must follow the cursor in the parent document, such as inactive-breakpoint activation hints. These events are not forwarded as new DOM events; `IframeFrameSurface` invokes callback props with the iframe-native `MouseEvent`, and callers translate the point with `clientPointToEditorDoc`.

Live frames skip all forwarding — they scroll natively and have no pan/zoom.

---

## Plugin module sandboxing (`ModuleSandboxFrame`)

Plugin canvas modules render inside `ModuleSandboxFrame.tsx`, a separate component that is NOT `IframeFrameSurface`. Plugin modules run in a `sandbox="allow-scripts"` iframe with no `allow-same-origin` — they communicate with the host via `postMessage`. This is distinct from the page tree iframes described above.

---

## Known limitations

### Inline text editing removed

Double-click to edit text/button content in-place was removed when the iframe move landed. The cross-frame focus model (iframe needs system focus, body competes, React StrictMode double-mount races) made every fix fragile. Text and button content is edited through the Properties panel.

When revisited, the shape worth considering is a parent-doc overlay positioned over the iframe element — a real `<input>`/`<textarea>` in the parent doc, no iframe focus negotiation needed.

### Test environment — iframe globals

`src/__tests__/setup.ts` patches `HTMLIFrameElement.prototype.contentDocument` so each iframe's `contentWindow` gets the same built-in constructors (`SyntaxError`, `Element`, etc.) as the parent. Without this, `querySelectorAll` inside the iframe would crash in happy-dom with "undefined is not a constructor". This is a test-env-only workaround — real browsers provide these natively.

### Canvas tests must use `iframeCanvasQuery`

Tests that render the canvas and query nodes must use the `iframeCanvasQuery.ts` helper. `document.querySelector('[data-node-id="..."]')` returns null because the node lives inside an iframe.

---

## Related

- `docs/editor.md` — canvas architecture overview and the design/live mode toggle
- `docs/features/canvas-iframe-per-frame.md` — this file
- Source-of-truth files:
  - `src/admin/pages/site/canvas/IframeFrameSurface.tsx` — iframe primitive
  - `src/admin/pages/site/canvas/CanvasLiveSurface.tsx` — live mode surface
  - `src/admin/pages/site/canvas/BreakpointFrame.tsx` — design mode per-breakpoint frame
  - `src/admin/pages/site/canvas/CanvasTransformLayer.tsx` — design mode pan/zoom container
  - `src/admin/pages/site/canvas/useIframeCursorBridge.ts` — surfaces iframe cursor movement to parent-doc callbacks
  - `src/admin/pages/site/canvas/EditorChromeInjector.tsx` — unlayered chrome CSS
  - `src/admin/pages/site/canvas/ClassStyleInjector.tsx` — class registry CSS
  - `src/admin/pages/site/canvas/UserStylesheetInjector.tsx` — user stylesheet CSS
  - `src/admin/pages/site/canvas/RuntimeScriptInjector.tsx` — opt-in runtime scripts
  - `src/admin/pages/site/canvas/useRuntimeScriptBuild.ts` — script bundle builder
  - `src/admin/pages/site/store/slices/canvasSlice.ts` — `canvasView`, `runScripts`
  - `src/__tests__/canvas/canvasMode.test.tsx` — design/live toggle + script build contract
