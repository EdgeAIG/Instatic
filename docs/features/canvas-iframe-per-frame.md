# Canvas: iframe per breakpoint frame

> **Status:** shipped (with known follow-ups — see "Remaining work" at the
> bottom of this doc). The CSS scoper, the `data-pb-page-body` attribute
> hook, the `NodeWrapper` `<div>`, and the `scopedPublisherResetCss` helper
> have all been removed. User CSS now reaches each breakpoint frame's iframe
> document unchanged, and selectors like `body > nav`, `:nth-child()`, and
> `h1 + p` match the same elements they match on the published page.

## The problem this is solving

The editor canvas renders each breakpoint frame as a React subtree mounted inside the editor's own document. This is fast and simple, but it creates two DOM-level discrepancies between what the author sees in the canvas and what visitors get on the published page:

1. **`<body>` is the editor chrome**, not the page body. A rule like
   `body { background: black; }` in the user's stylesheet paints the entire
   editor instead of the page frame.

2. **Every authored element is wrapped in a `<div class="nodeWrapper">`** so
   the editor can attach click / drag / keyboard / selection handlers. The
   wrapper uses `display: contents` so layout is unaffected, but CSS combinators
   follow the DOM tree, not the layout tree. So `body > nav > strong` never
   matches in the canvas because there's a NodeWrapper between every authored
   element pair, even though the published HTML matches perfectly.

The current stopgap (`scopeUserStylesheetForCanvas` + a `data-pb-page-body`
attribute hook + relaxed `>` combinators) handles the most common patterns but
breaks down on:

- Adjacent-sibling combinator `+` (NodeWrappers sit between siblings)
- General-sibling combinator `~` (same)
- Structural pseudo-classes — `:first-child`, `:nth-child()`, `:only-of-type`,
  etc. — match the wrapper, not the authored element
- Authors who deliberately use `>` for strict specificity see different cascade
  in canvas vs. published

The CSS rewriter can't fix any of these without becoming a full CSS parser
that tracks the entire NodeWrapper hierarchy and reconstructs published-vs-
canvas selector mapping. That's a parsing problem masquerading as a styling
problem — the right answer is to make the canvas DOM actually match the
published DOM.

## The fix: one iframe per breakpoint frame

Replace the per-frame `<div class="viewport">` with an `<iframe>`. The iframe
gets its own document. The page tree renders into the iframe's `<body>`. User
CSS works exactly as it does on the published site — no rewriting, no scoping,
no impedance mismatch.

```
BreakpointFrame
  <div className={frameWrapper}>
    <Button>Mobile</Button>   // chrome (outside iframe)
    <iframe>
      // inside the iframe document:
      <html>
        <head>
          <style>reset CSS</style>
          <style>framework CSS</style>
          <style>class registry CSS</style>
          <style>user CSS (UNSCOPED — `body` is the real body)</style>
          @font-face declarations
        </head>
        <body>
          // React tree mounted here via createPortal
          // No NodeWrapper divs at the layout-affecting level.
        </body>
      </html>
    </iframe>
  </div>
```

After the cut-over, `scopeUserStylesheetForCanvas` and the
`data-pb-page-body` attribute hook on `BodyEditor` become dead code and get
removed in the same change.

## Implementation work

### 1. Iframe shell

- New component: `IframeCanvasFrame` (or merge into `BreakpointFrame`).
- Each breakpoint frame renders a single `<iframe>` element with a stable
  `key` so it isn't unmounted on unrelated re-renders.
- The iframe's `srcDoc` carries an empty HTML skeleton:
  `<!doctype html><html><head></head><body></body></html>`. We don't load
  anything external — the document is constructed entirely in JS once it's
  alive.
- On the iframe's `load` event, capture `iframe.contentDocument` and
  `iframe.contentWindow` into refs.

### 2. Mount React into the iframe

- Use `createPortal(reactTree, iframe.contentDocument.body)` to portal the
  page tree into the iframe.
- React 18+ supports portals into other-document targets. Synthetic events
  bubble through the React tree (not the DOM tree), so click/hover/keyboard
  handlers attached in the React tree fire normally even though the rendered
  DOM is inside the iframe.
- `<NodeRenderer>` and its descendants render unchanged — they don't need to
  know they're inside an iframe.

### 3. CSS injection inside the iframe

- Refactor `ClassStyleInjector` and `UserStylesheetInjector` to accept a
  target document (default: `document`) and inject `<style>` tags into that
  document's `<head>`.
- For each iframe, mount a parallel pair of injectors targeting that iframe's
  document. The same source CSS that goes to the published site goes into
  each iframe — verbatim, no rewriting.
- The publisher reset CSS, the framework / class bundle CSS, and the user
  stylesheets all need to be in the iframe. So does `@font-face` from the
  fonts library so custom fonts render correctly inside the iframe.

### 4. Selection / hover overlay positioning

- `BreakpointSelectionOverlay` currently calls `getBoundingClientRect()` on
  elements inside the same document as the editor. The overlay then absolutely-
  positions a ring DIV.
- After the iframe move, element rects come from inside the iframe's coordinate
  system. To draw the ring in the editor's coordinate system, add the iframe's
  own `getBoundingClientRect()` to the element rect:
  `editorX = iframeRect.left + elementRectInsideIframe.left`.
- Update `ResizeObserver` / `MutationObserver` / scroll listeners to attach
  inside the iframe document as well.

### 5. Event handling across the iframe boundary

- React portal events: clicks, hover, focus, keyboard — work natively because
  React tracks events through the component tree, not the DOM tree.
- Native events that don't go through React (drag-and-drop from `@dnd-kit`,
  global keyboard shortcuts, pointer captures) need explicit forwarding.
  - For `@dnd-kit`: install pointer event listeners on `iframe.contentDocument`
    that relay `pointermove` / `pointerup` events to the parent document, OR
    use a DnD context that recognises the iframe's pointer events. The latter
    is cleaner; investigate `@dnd-kit/sensors` `KeyboardSensor` and
    `PointerSensor` config for cross-document targets.
  - Wheel events for the canvas zoom/pan gesture layer: forward similarly.

### 6. Computed styles / measurements from outside the iframe

- Any code doing `getComputedStyle(node)` where `node` lives inside an iframe
  must use `iframe.contentWindow.getComputedStyle(node)` instead.
- Same for `window.getSelection()` — use `iframe.contentWindow.getSelection()`.

### 7. NodeWrapper changes

- The NodeWrapper div STAYS (it still owns event handlers and the
  `data-node-id` attribute) but its `display: contents` continues to keep it
  layout-transparent. Inside the iframe, `display: contents` still doesn't
  affect CSS combinators — but that's now fine because user CSS never has to
  cross the wrapper. Selectors like `body > nav` work because:
  - `body` is the iframe's body (matches `<body>` directly).
  - The page tree's root `base.body` renders as `<body>`'s content. The
    first authored element (e.g. `<nav>`) is wrapped in a NodeWrapper, so
    the actual DOM child of `<body>` is the wrapper. **`body > nav` still
    won't match a direct-child relationship.**
  - To fix this completely we need to also remove NodeWrapper — see §8.

### 8. Stretch: remove NodeWrapper entirely

The cleanest end-state is no wrapper at all. Every module's React component
accepts a bag of editor props (event handlers, refs, `data-node-id`,
`aria-pressed`, etc.) and spreads them onto its root element. The user's
`<nav>` IS the click target — the editor adds attributes; no surrounding
`<div>` exists.

This is a larger refactor (touches every module + the canvas selection layer
+ drag/drop targets) and can be tracked as a follow-up. The iframe move alone
already eliminates the `<body>` mismatch, which is the most visible
discrepancy. Direct-child combinator parity is the second-order improvement
that needs the NodeWrapper removal.

## Trade-offs

| Concern | Today | After iframe | After iframe + NodeWrapper removal |
|---|---|---|---|
| `body` selector | rewritten | works natively | works natively |
| `>` combinator | relaxed to descendant | broken (NodeWrapper between elements) | works natively |
| `+`, `~`, `:nth-child` | broken | broken | works natively |
| `@font-face` | inherited from editor doc | needs replication into iframe | same |
| Cold paint per frame | ~5 ms | +30–60 ms (iframe parse + load) | same |
| Memory | low | +1 document per frame | same |
| Canvas reorder drag | works | needs cross-doc pointer relay (shipped — `data-pb-canvas-dragging` signal on `<html>` + per-iframe pointer forwarding) | same |
| `getComputedStyle` from outside | works | needs `contentWindow.getComputedStyle` | same |

## Cut-over plan

The work can land behind a feature flag (`editorIframeFrames`) so the existing
canvas continues to work while the new path is built and tested.

1. **PR 1 — Iframe shell + React mount + CSS injection** (no DnD, no overlay).
   Editor renders content inside iframe with the flag on. Selection rings
   render in approximate position (parent doc coordinates). Click selection
   may not work yet.
2. **PR 2 — Selection / hover overlay positioning** correctly mapped across
   the iframe boundary.
3. **PR 3 — Click / hover / keyboard parity** via React portal events.
4. **PR 4 — Drag-and-drop** cross-document relay.
5. **PR 5 — Flag flipped to default-on; remove scoper + `data-pb-page-body`
   hook from BodyEditor + the relaxed-combinator helper**. Mark
   `scopeUserStylesheetForCanvas` deprecated and delete after one release.
6. **PR 6 (stretch)** — remove NodeWrapper div; modules spread editor props
   onto their own root element.

Until PR 5 is shipped, the scoper remains in place as the fallback for the
non-flagged path.

## What this lets us delete

When the iframe path is the default:

- `src/admin/pages/site/canvas/scopeUserStylesheetForCanvas.ts` — gone.
- The `data-pb-page-body=""` attribute on `BodyEditor` — gone.
- The `> → descendant` and `body → [data-pb-page-body]` rewriting paths —
  gone. The canvas runs the same CSS bytes the publisher does.
- The CSS scoper tests — gone.

What stays: `UserStylesheetInjector` (still injects user CSS, now targeting
each iframe's document instead of the editor doc), `ClassStyleInjector` (same),
`collectUserStylesheetCss` (shared between publisher and canvas). The injector
calls `collectUserStylesheetCss(site, activePage)` so the canvas loads exactly
the stylesheets that target the active page — same scope, priority, and enable
state the published page gets.

## Remaining work

These are known issues that survive the iframe + NodeWrapper-removal cut-over.
None block the core "design a styled page on the canvas" workflow; each is
called out so it doesn't get lost.

### 1. Canvas inline editing is gone — re-design when needed

The old "double-click a text/button on the canvas to edit in place" path
was removed after the iframe move (`isInlineEditing`, `setInlineEditing`,
`inlineEditable`, the `contentEditable` branches in TextEditor /
ButtonEditor, and the shared `inlineEdit.ts` helper). The cross-frame
focus model — iframe needs system focus, body has `tabindex="0"` and
competes for the same focus, React StrictMode double-mount races the
focus call — made every attempted fix fragile, and the experience never
got close to "just works." Text and button content is currently edited
through the Properties panel only.

When this is revisited, the shape that's worth considering is **render
the editor as a parent-doc overlay positioned over the iframe element**
rather than fighting the iframe's focus model. The overlay is a real
`<input>` / `<textarea>` in the parent doc — focus lands instantly,
typing has zero race with the iframe body, and commit just writes back
to the store. The visual swap during edit is purely cosmetic
(transparent overlay + transparent text inside the iframe).

### 2. happy-dom iframe globals are polyfilled at the parent boundary

`src/__tests__/setup.ts` patches `HTMLIFrameElement.prototype.contentDocument`
so each iframe's contentWindow gets the same `SyntaxError` / `Element` /
etc. constructors the parent has. Without this, internal `querySelectorAll`
failures inside the iframe crash with "undefined is not a constructor"
instead of returning the expected null/throw. This is a test-env-only
workaround — real browsers ship those constructors on every window
natively.

### 3. Some canvas tests are not yet iframe-aware

The test files I updated as part of the refactor —
`nodeRendererLockdown.test.tsx`, `breakpointProps.test.tsx`,
`selectionToolbar.test.tsx`, `slotContentReactivity.test.tsx`,
`templatePreviewBindings.test.tsx` — all use the
`iframeCanvasQuery.ts` helper to look up nodes across iframe boundaries
when the canvas is rendered in jsdom/happy-dom. New tests that render the
canvas need to use the same helper; querying `document.querySelector('[data-node-id="..."]')`
will return null because the node lives inside an iframe.
