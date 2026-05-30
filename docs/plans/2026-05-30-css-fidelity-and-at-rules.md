# CSS Fidelity: permissive properties + arbitrary @-rules

## TL;DR

Two related upgrades that make the style engine faithfully represent *any* CSS — not just the curated subset the editor has bespoke widgets for. Both are escape hatches for "CSS we want to store and publish but don't (yet) have a visual control for."

1. **Permissive properties.** Invert the property model from an allowlist (~110 hand-listed props) to permissive storage guarded by the existing value sanitizer. The ~250 `unknown-property` import warnings disappear; every standard CSS property round-trips. The editor keeps curated widgets for common props and gains a generic **Custom properties** raw key/value editor for the long tail.

2. **Arbitrary @-rules.** Generalize the breakpoint-only responsive model so any selector can carry custom `@media` / `@container` / `@supports` conditions (not just the 3 site breakpoints), and add site-level registries for the *named* @-rules (`@keyframes`, `@font-face`). The lossy "unmatched-media-query folded into base styles" behaviour is replaced by faithful round-tripping.

## Motivation

Real-world CSS imports surface two systemic gaps:

- **Property whack-a-mole.** Each imported site finds a new batch of dropped properties — `flex-grow/shrink/basis`, `grid-auto-flow`, `grid-column-start`, `list-style-type`, `font-feature-settings`, … all standard and safe, all dropped because they aren't in `ALLOWED_PROPS`. There are ~350 standard CSS properties; we allowlist ~110. The list will never be complete.
- **Responsive model too narrow.** A rule's responsive variation is `breakpointStyles: Record<breakpointId, styles>` — keyed by one of the site's width breakpoints. Anything else — `@media (max-width: 860px)` that doesn't match a breakpoint, `@media (orientation: landscape)`, `@media print`, `@container (min-width: 400px)` — is either dropped or **silently folded into the base styles** (lossy + wrong). And `@keyframes` / `@font-face` are dropped entirely.

The unifying realization: **the property-name allowlist was never the security boundary** — `sanitiseCssValue` is. It blocks the actual injection vectors at the *value* level:

```ts
// src/core/publisher/utils.ts — the REAL guard
if (/expression\s*\(/i.test(v)) return null
if (/javascript\s*:/i.test(v)) return null
if (/behavior\s*:/i.test(v)) return null
if (/-moz-binding/i.test(v)) return null
if (/data\s*:\s*text/i.test(v)) return null
if (/[{}]/.test(v)) return null   // can't break out of the declaration block
if (/<\//.test(v)) return null    // can't break out of the <style> element
```

A property *name* cannot break out of a declaration or inject script. So the name allowlist is redundant belt-and-suspenders whose only live function today is "which properties the editor knows about" — and conflating *that* with *what we faithfully store* is the bug.

## Goals

1. Eliminate the `unknown-property` warning class — every valid CSS property round-trips through import → store → publish.
2. Keep the published CSS safe — the value sanitizer remains the boundary; a tiny denylist covers genuinely dead/dangerous property names.
3. Decouple "has a bespoke widget" from "is storable/publishable" — curated controls for common props, a generic custom-properties editor for the rest.
4. Let any selector carry arbitrary `@media` / `@container` / `@supports` conditions, not just the site's width breakpoints.
5. Faithfully round-trip `@keyframes` and `@font-face` via site-level registries.
6. No data migration that breaks existing local DBs — additive shapes with tolerant parsers.

## Non-goals

- A visual editor for *every* CSS property. The long tail uses a raw key/value editor; bespoke widgets are added opportunistically.
- A visual builder for media/container query *expressions*. v1 is a validated text field (`(max-width: 860px)`); a guided builder is a later enhancement.
- `@layer`, `@page`, `@property`, `@counter-style`, `@scope` — captured-or-dropped-with-warning in v1; promoted later if real imports need them.
- Replacing `breakpointStyles` wholesale. Breakpoints stay as the first-class responsive model (the toolbar is deeply wired to them); arbitrary conditions are *added alongside*.

---

## Part 1 — Permissive properties

### The model change

`ALLOWED_PROPS` (an allowlist in `src/core/publisher/classCss.ts`) becomes `DENIED_PROPS` (a small denylist). `bagToCSS` changes its gate from "is this prop in the allowlist?" to "is this a syntactically valid CSS property name that isn't denied?":

```ts
// Valid CSS custom-ident or vendor-prefixed property, also allows --custom-props.
const VALID_PROPERTY_RE = /^--?[a-zA-Z][a-zA-Z0-9-]*$/

// Genuinely dead / dangerous property names. Values are already sanitised,
// but these props have historically been script/behaviour vectors.
const DENIED_PROPS = new Set(['behavior', '-moz-binding', '-ms-behavior'])

function isEmittableProperty(prop: string): boolean {
  return VALID_PROPERTY_RE.test(prop) && !DENIED_PROPS.has(prop.toLowerCase())
}
```

`bagToCSS` keeps everything else identical — the per-side `padding`/`margin` collapse, `sanitiseCssValue` on every value, the `</style` neutralisation. Only the property gate widens.

### Importer

`cssToStyleRules` imports `ALLOWED_PROPS` today to pre-filter declarations and emit `unknown-property` warnings. It switches to the same `isEmittableProperty` check. Result: no more `unknown-property` warnings for standard props; the only dropped declarations are the denied handful (which *do* still warn, now as `blocked-property` — rare and meaningful).

### Editor UI — Custom properties

The visual property panel keeps its curated sections (Layout, Spacing, Typography, Border, …) for properties with bespoke widgets. A new **Custom properties** section at the bottom of the style surface renders any *set* property that isn't claimed by a curated section, as editable raw `key: value` rows, plus an "+ Add property" affordance with property-name validation and a value text field.

- Imported exotica (`grid-auto-flow: dense`) shows up here immediately, editable.
- Curated-section properties never appear here (no duplication) — the section's property list is the claim set; Custom properties = "set props minus all claimed props".
- The same `cssControlTypes` machinery decides what's curated; everything else falls through to Custom.

This is the Webflow/Framer pattern: nice controls for the common case, a raw editor escape hatch for everything else.

### Phasing (Part 1)

- **1a — Permissive storage/publisher/importer.** Flip the allowlist to a denylist; update `bagToCSS`, `cssToStyleRules`, and the two allowlist gate tests. Imported props round-trip + render; warnings gone. *No UI yet* — exotic props render but are only editable via the (future) custom editor or raw text. Smallest, highest-impact step.
- **1b — Custom properties editor.** Add the generic section + add-property affordance. Now the long tail is editable in the panel.

### Tests (Part 1)

- `bagToCSS` emits a previously-unlisted prop (`flex-grow: 2`) and drops a denied one (`behavior: url(...)`).
- `cssToStyleRules` produces no `unknown-property` warning for `flex-grow` / `grid-auto-flow` / `list-style-type`; still warns (as `blocked-property`) for `behavior`.
- Value sanitizer still blocks `javascript:` / `expression()` regardless of property.
- Custom-properties section lists set-but-uncurated props and round-trips edits; never duplicates a curated prop.
- Update `classStyleInjector.test.ts` + any architecture test asserting the allowlist shape.

---

## Part 2 — Arbitrary @-rules

> **Superseded (Category A).** The per-rule `conditionalLayers` design below was
> implemented (Phase 2a/2b) and then **replaced** by the unified editing-context
> model — see [2026-05-30-unified-condition-axis.md](2026-05-30-unified-condition-axis.md).
> `breakpointStyles` + `conditionalLayers` are now one `StyleRule.contextStyles`
> map keyed by context id, and custom conditions are a reusable site-level
> registry (`site.conditions`) rather than embedded per rule. Category B
> (`@keyframes` / `@font-face` registries) is unaffected and still pending.

### The two categories

Every `@`-rule is one of:

- **Category A — conditional wrappers** (`@media`, `@container`, `@supports`): wrap *a selector's declarations* under a condition. → belong **per-rule**.
- **Category B — named definitions** (`@keyframes`, `@font-face`, `@property`, `@counter-style`): define a *named thing referenced by value*. → belong in **site-level registries**.

### Category A — conditional style layers

Add an optional `conditionalLayers` array to `StyleRule`, alongside the existing `styles` (base) and `breakpointStyles` (the width-breakpoint model, kept as-is):

```ts
type StyleCondition =
  | { kind: 'breakpoint'; breakpointId: string }       // → @media (max-width: N), today's model
  | { kind: 'media'; query: string }                   // any media query verbatim
  | { kind: 'container'; name?: string; query: string } // @container [name] (query)
  | { kind: 'supports'; query: string }                // @supports (query)

interface ConditionalStyleLayer {
  id: string                  // stable id for the editor tab + diffing
  condition: StyleCondition
  styles: CSSPropertyBag
  order: number               // cascade position among layers
}

interface StyleRule {
  // ...existing: id, name, kind, selector, order, styles, breakpointStyles
  conditionalLayers?: ConditionalStyleLayer[]   // NEW, optional → tolerant default []
}
```

Why keep `breakpointStyles` separate rather than fold breakpoints into `conditionalLayers`:
- The responsive toolbar (mobile/tablet/desktop tabs, the canvas frame switcher) is deeply wired to `breakpointStyles` keyed by breakpoint id. A big-bang migration is high-risk for no user-visible gain.
- Breakpoints are the 90% case and deserve the first-class switcher; arbitrary conditions are the long tail.
- The two compose cleanly at emit time (see below).

**Importer** (`cssToStyleRules`): the @media matching logic changes its *fallback*:
- `@media (max-width: N)` matching a site breakpoint (±tolerance) → `breakpointStyles[id]` (today).
- Any other `@media` / every `@container` / every `@supports` → a `conditionalLayer` with the verbatim condition. **No "unmatched-media-query" warning, no folding into base.** The 860px and 800px rules from the warning list become faithful conditional layers.

**Publisher** (`generateClassCSS`): after emitting base + `breakpointStyles`, emit each conditional layer:
```
@<kind> <query> {
  <selector> { <declarations> }
}
```
ordered by the layer's `order`. `@container` with a name emits `@container <name> (<query>)`. Cascade ordering across base / breakpoints / conditional layers needs a defined precedence — proposed: base → conditional layers (source order) → breakpoint @media (width-sorted, narrowest last), so explicit width breakpoints keep winning at their widths, matching today's behaviour.

**Editor UX**: the breakpoint tab strip (Base · Mobile · Tablet · Desktop) gains a trailing **"+ Condition"** button. It opens a small dialog:
- Type: Media / Container / Supports (segmented).
- Condition text: validated against the browser's `CSSStyleSheet` (`@media <query> {}` must parse).
- Optional container name for container queries.

Adding a condition appends a tab; selecting it makes the style surface write to that layer. Each custom tab has a remove affordance. *Every selector can now carry arbitrary, per-element conditions* — the core ask.

### Category B — site-level @-rule registries

- **`@keyframes` → `site.animations: Record<id, AnimationDefinition>`** where a definition holds `{ id, name, css }` (the raw `@keyframes` body, or a structured keyframe list). Importer captures them; publisher emits each once at the top of the stylesheet (before rules that reference them); an **Animations panel** (sibling to Selectors) lists/edits/renames; `animation` / `animation-name` values reference them by name. Replaces today's "dropped @keyframes" warning.

- **`@font-face` → `site.fonts` registry** (extend the existing fonts model). The font-import work already uploads the binary to the media library; the missing piece is storing the `@font-face` declaration (family, weight, style, the rewritten `src` url) and emitting it at publish. Closes the loop so imported web fonts actually render.

- **`@property` / `@counter-style`** → same registry pattern, deferred to a follow-up.

- **`@import`** → resolved at import time (we already have the linked file), never stored. **`@layer`** → deferred (maps to cascade `order` or a named-layer registry).

### Phasing (Part 2)

- **2a — Faithful @media/@container/@supports storage (no editor UI).** Add `conditionalLayers` to the schema + tolerant parser; importer stores unmatched conditions as layers instead of folding into base; publisher emits them. Imported responsive/container CSS round-trips and renders correctly. *This alone removes the lossy folding and the unmatched-media-query warnings.*
- **2b — "+ Condition" editor.** The tab strip affordance + condition dialog + per-layer editing + remove. Now users author custom conditions by hand.
- **2c — `@keyframes` registry + Animations panel.** Capture, store, emit, edit.
- **2d — `@font-face` registry.** Capture + store + emit; render imported fonts.

### Tests (Part 2)

- Importer: `@media (max-width: 860px)` with no matching breakpoint → one conditional layer (kind `media`, verbatim query), zero `unmatched-media-query` warnings, nothing in base styles.
- Importer: `@container (min-width: 400px)` and `@supports (display: grid)` → respective layers.
- Publisher: a rule with base + breakpointStyles + conditionalLayers emits all three in the defined cascade order; container query emits `@container <name> (<query>)`.
- Schema round-trip: a StyleRule with conditionalLayers survives `parseStyleRule`; legacy rules without the field default to `[]`.
- `@keyframes pulse { ... }` → captured into `site.animations`; published once; `animation-name: pulse` resolves.
- Editor: adding a media condition creates a tab; editing under it writes to the layer; removing it deletes the layer.

---

## Combined sequencing

The two parts are independent but share the "faithful escape hatch" theme. Recommended order by impact-per-effort:

1. **Part 1a** — permissive storage. One file's gate flips, ~250 warnings vanish, every standard prop renders. Highest impact, smallest change.
2. **Part 2a** — faithful @-condition storage. Kills the lossy media folding + unmatched warnings; imported responsive CSS becomes correct.
3. **Part 1b** — custom-properties editor. Makes the long-tail props editable.
4. **Part 2b** — "+ Condition" editor. Makes custom conditions authorable.
5. **Part 2c / 2d** — keyframes + font-face registries. Independent, schedule as needed.

## Open questions

- **Q-A — Cascade precedence** between base / breakpoint @media / conditional layers when multiple match. Proposed: base → conditional layers (source order) → breakpoint @media (width-sorted). Needs confirmation against real multi-condition imports.
- **Q-B — Container query naming.** Container queries need a named container ancestor (`container-name` on a parent + `@container <name>`). v1 stores the name verbatim from import; authoring a *new* container query in-editor needs a way to designate the container element. Defer the authoring half to 2b's follow-up?
- **Q-C — `@keyframes` storage shape** — raw CSS body (simple, opaque) vs structured keyframe list (editable, more work). Proposed: raw body in 2c, structuring later when the Animations panel needs visual editing.
- **Q-D — Custom-properties editor scope** — does it also expose CSS custom properties (`--foo: bar`)? They're valid and would round-trip under the permissive model; surfacing them in the same editor is natural but adds a "variables" mental model. Proposed: yes, same editor, no special treatment in v1.

## Related

- [`docs/reference/css-class-registry.md`](../reference/css-class-registry.md) — the StyleRule registry this extends.
- [`docs/plans/2026-05-29-super-import.md`](2026-05-29-super-import.md) — the import pipeline whose warnings motivated this; Part 2a directly removes its `unmatched-media-query` folding.
- [`docs/features/publisher.md`](../features/publisher.md) — `generateClassCSS` / `bagToCSS`, touched by both parts.
- `src/core/publisher/classCss.ts` — `ALLOWED_PROPS` → `DENIED_PROPS`, `@media` emission → conditional-layer emission.
- `src/core/publisher/utils.ts` — `sanitiseCssValue`, the actual security boundary (unchanged).
- `src/core/siteImport/cssToStyleRules.ts` — importer property filter + @-rule routing.
- `src/core/page-tree/styleRule.ts` / `breakpoint.ts` — schema home for `conditionalLayers`; breakpoint model kept as-is.
