# Unified condition axis — one "editing context" switcher

## TL;DR

Today the editor has **two parallel systems for "styles that apply under a
condition"**:

1. **Width breakpoints** — `StyleRule.breakpointStyles`, driven by the canvas
   toolbar's `CanvasBreakpointSelector`. First-class, reframes the canvas,
   deeply wired. (Mobile / Tablet / Desktop.)
2. **Conditional layers** — `StyleRule.conditionalLayers`, driven by the
   `ConditionTabs` strip + the `ConditionDialog` modal in the properties panel.
   A buried, cramped, raw-text-only escape hatch for custom `@media` /
   `@container` / `@supports`.

A width breakpoint **is** just `@media (max-width: N)`. The publisher already
proves this: `conditionPrelude()` emits a `breakpoint`-kind condition by
looking up the width and producing `@media (max-width: Npx)` — the exact same
output `breakpointStyles` produces. The two systems are the *same concept*
implemented twice, and the second implementation got the worse UX.

**This plan collapses them into one axis: a single "editing context" switcher
that lives where the breakpoint selector already lives.** Base, the site
breakpoints, and any custom conditions are entries in one list. Selecting an
entry reframes the canvas (for width conditions) and routes every style edit to
that context. Authoring a new condition becomes an inline, guided builder in the
switcher — not a disconnected modal. Custom conditions become **site-level,
reusable definitions** (a registry parallel to `site.breakpoints`), so the model
is genuinely modular instead of ad-hoc per class.

> Scope note: **non-conditional at-rules are out of scope.** `@keyframes`,
> `@font-face`, `@property`, `@counter-style` are *named site-level resources*
> referenced by value — not conditions. They belong in their own panels
> (Animations, Fonts) and are handled in a later job. This plan is only about
> the *conditional* at-rules: `@media`, `@container`, `@supports`, plus the
> width breakpoints that are a special case of `@media`.

---

## Why now / the user-facing complaint

> "You created a way for custom media queries and other things that are called
> with @ in css, but you made this very limited, and quite unfitting place to
> do it. … not modular enough, and it's useless design that adds friction, by
> limiting only to these three options."

Three real defects underlie that:

- **Architectural duplication.** Breakpoints and custom conditions are the same
  axis. Having two switchers (toolbar dropdown + properties-panel tab strip +
  modal) for one concept is the root friction. The schema even admits the
  intent to merge — `StyleConditionSchema` carries a `breakpoint` kind whose
  comment says it "exists so a future migration could unify them."
- **Wrong home + friction.** The condition author flow is a small modal with a
  single raw-text field (`(max-width: 860px)`). No presets, no guided builder,
  no canvas reframe, disconnected from the context switcher you actually think
  in.
- **Not modular.** Conditions are embedded per-`StyleRule`. There's no notion of
  a reusable, named condition — every class re-types its own. Breakpoints, by
  contrast, *are* a reusable site-level registry. Conditions should work the
  same way.

---

## Target model

### One axis: the editing context

Define an **editing context** = "the condition under which I am currently
editing styles." Exactly one is active at a time (today's `activeBreakpointId`
generalises to `activeContextId`). The set of contexts:

```
Base                        ← unconditional (StyleRule.styles)
─ Mobile      375px         ← breakpoint context (preset, reframes canvas)
─ Tablet      768px
─ Desktop    1440px
─ Landscape                 ← custom @media (orientation: landscape)
─ Dark                      ← custom @media (prefers-color-scheme: dark)
─ Card ≥400                 ← custom @container (min-width: 400px)
─ Grid supported            ← custom @supports (display: grid)
+ Add condition…
```

All of these live in **one switcher** in the canvas toolbar (where
`CanvasBreakpointSelector` is today). Selecting one:

- **width condition** (a breakpoint, or a custom `@media` with a width bound) →
  reframes the canvas to that width, as breakpoints do today.
- **non-width condition** (`@container`, `@supports`, `@media (orientation:…)`,
  `prefers-color-scheme`, …) → the canvas can't physically reframe, so it shows
  a clear **context badge** ("editing: @supports (display:grid)") and routes
  edits. (A later enhancement can simulate `prefers-color-scheme` etc.; v1 just
  badges.)
- routes **all** style-panel edits to that context's override bag.

This deletes the per-class `ConditionTabs` strip and the `ConditionDialog`
modal entirely. The properties panel stops owning a condition dimension; it
just edits "the active context's styles," exactly as it already edits "the
active breakpoint's styles."

### Storage: collapse the two maps into one

This is the central decision. Two options, in increasing cleanliness / blast
radius:

#### Option A2 — UI-only unification (lower risk)

Keep `breakpointStyles` and `conditionalLayers` as separate storage. The new
switcher merely *also* lists custom conditions and routes edits to the matching
`conditionalLayer`; the `ConditionDialog` modal is replaced by an inline
popover. Breakpoint frame logic is untouched.

- **Pros:** smallest change, the deeply-wired breakpoint frame code is
  untouched, no data migration.
- **Cons:** keeps the dual storage and dual store-action sets — the exact
  duplication CLAUDE.md tells us to delete. It fixes the *UI* friction but
  leaves the architecture forked.

#### Option A1 — Full storage unification (recommended)

Collapse both maps into **one** per-context override map on `StyleRule`, and
promote custom conditions to a **site-level registry** parallel to
`site.breakpoints`:

```ts
// site document
interface SiteDocument {
  breakpoints: Breakpoint[]        // unchanged — width presets, drive the frame
  conditions: ConditionDef[]       // NEW — reusable custom @media/@container/@supports
  // …
}

interface ConditionDef {
  id: string
  label: string                    // "Dark", "Card ≥400" — shown in the switcher
  condition: StyleCondition        // { kind:'media'|'container'|'supports', … }
}

// StyleRule — breakpointStyles AND conditionalLayers both GO AWAY, replaced by:
interface StyleRule {
  id; name; kind; selector; order; styles /* = Base */;
  contextStyles: Record<string, CSSPropertyBag>   // keyed by contextId
  // a contextId is either a breakpoint.id OR a condition.id
}
```

Every context — breakpoint or custom — is a **named site-level definition**;
each `StyleRule` stores a flat `contextId → bag` map of overrides. The publisher
already knows how to emit either kind (`conditionPrelude`), so emission collapses
to: for each non-empty `contextStyles[id]`, look up the context (breakpoint →
`@media (max-width)`, condition → verbatim prelude) and wrap.

- **Pros:** one storage shape, one set of store actions, one emit path, one
  importer target, zero duplication. Custom conditions become reusable +
  modular for free (define "Dark" once, every class overrides under it). This is
  the architecturally honest endpoint and matches the repo's "no parallel
  old/new paths" rule.
- **Cons:** large blast radius (see below) + a local-data migration. Acceptable
  because the project is pre-release and local DBs are disposable, but it is the
  bigger lift.

**Recommendation: A1.** It's the only option that actually *removes the
duplicate system* the user is objecting to. A2 is a fallback if we want to ship
the UX win first and unify storage in a follow-up — but per CLAUDE.md I'd rather
not leave the fork in place.

The remainder of this plan assumes **A1** and notes where A2 would differ.

### The cascade stays defined

Emission order (already established, preserved): `base → custom conditions
(registry order) → breakpoint @media (width-sorted, narrowest last)`. With one
`contextStyles` map we partition keys by "is this id a breakpoint?" and emit in
that order. No behavioural change to published CSS.

---

## UX design

### 1. The context switcher (canvas toolbar)

Replace `CanvasBreakpointSelector`'s breakpoint-only `Select` with a
**context Select** whose options are grouped:

- **Base** (always first)
- **Breakpoints** group — Mobile / Tablet / Desktop, with width + device icon
  (today's rendering).
- **Conditions** group — each `site.conditions` entry, with a kind glyph
  (`@media` / `@container` / `@supports`) and its label.
- A footer action **"+ Add condition…"** opening the builder popover (below).

Each custom-condition row gets an inline edit/remove affordance (rename the
label, delete the definition). Deleting a condition definition drops its
`contextStyles[id]` from every rule (with a confirm, since it's destructive
across classes) — mirrors `deleteClass`.

A small **"X set"** indicator per row (like the properties panel's section dots)
shows which contexts the *currently selected element's* class actually overrides
under, so authors can see at a glance where a class is responsive.

### 2. The guided condition builder (replaces the modal)

An inline popover anchored to the switcher (not a centred modal), with a
type segmented control and a **guided builder per kind** instead of one raw
text field:

- **@media**
  - One-click **preset chips**: `orientation: landscape/portrait`,
    `prefers-color-scheme: dark/light`, `prefers-reduced-motion`, `print`,
    `hover: hover`, `pointer: fine/coarse`.
  - A **width-range** builder: min-width / max-width numeric inputs + unit. (The
    common case — and the bridge to "this is just a breakpoint.")
  - A **raw expression** escape hatch with the existing live
    `CSSStyleSheet`-based validation (`isValidConditionQuery`).
- **@container**
  - A **container picker**: choose which ancestor is the query container
    (designates `container-name`/`container-type` on that node). This closes
    open question **Q-B** from the css-fidelity plan ("authoring a new container
    query needs a way to designate the container element").
  - A size builder (min/max width/height) + raw escape hatch.
- **@supports**
  - A **property:value tester** with presets (`display: grid`, `display: flex`,
    `gap`, `backdrop-filter`, …) that live-checks `CSS.supports()`, + raw.

A **label** field (defaulting to a humanised summary of the condition, e.g.
"Dark", "Card ≥400") names the registry entry. Submitting creates a
`ConditionDef` in `site.conditions` and selects it as the active context.

This is the Webflow/Framer pattern: nice guided controls for the common case, a
raw escape hatch for the long tail. It directly answers "adds friction by
limiting to three options" — the three *kinds* are correct (they are the only
conditional at-rules), but authoring each is now guided and reusable rather than
a raw-text modal.

### 3. Canvas indication for non-width contexts

When a non-width context is active, the canvas can't reframe. Show a compact,
dismissable **context badge** near the frame ("Editing @supports (display:
grid)") so it's obvious edits aren't going to Base. Reuse existing editor
state/token styling; no new color identity.

---

## Data migration

`StyleRule.breakpointStyles` + `conditionalLayers` → `contextStyles`:

- In the tolerant parser (`parseStyleRule`), read legacy `breakpointStyles`
  (key = breakpoint id) and legacy `conditionalLayers` (synthesise a
  `ConditionDef` per distinct condition, key by a deterministic id) and fold
  both into `contextStyles`. Drop the legacy fields after.
- For `conditionalLayers` whose `condition.kind === 'breakpoint'`, the contextId
  is just the breakpoint id (they merge with `breakpointStyles`).
- Seed `site.conditions = []` when absent.

Because the project is pre-release with disposable local DBs, we do **not** keep
both shapes alive — the parser migrates on read and the writer only ever emits
`contextStyles` (CLAUDE.md: no parallel old/new paths). A throwaway local DB
re-import is acceptable if needed.

---

## Blast radius (Option A1) — file by file

**Schema / core**
- `src/core/page-tree/styleRule.ts` — remove `breakpointStyles` +
  `conditionalLayers` + `ConditionalStyleLayer*`; add `contextStyles`. Keep
  `StyleConditionSchema` (now used by `ConditionDef`). Update `parseStyleRule`
  (migration + new shape).
- `src/core/page-tree/` (new) `condition.ts` — `ConditionDefSchema`,
  `parseCondition`, parallel to `breakpoint.ts`.
- `src/core/page-tree/index.ts` + `SiteDocument` schema — add `conditions`.
- `src/core/persistence/validate.ts` — validate `site.conditions`; migrate rule
  shape.

**Publisher**
- `src/core/publisher/classCss.ts` — `generateClassCSS` iterates `contextStyles`
  partitioned into breakpoint vs condition; `conditionPrelude` stays (already
  handles both). Resolve condition contexts via the `site.conditions` registry.

**Canvas injector**
- `src/admin/pages/site/canvas/ClassStyleInjector.tsx` /
  `UserStylesheetInjector.tsx` — emit from `contextStyles`; preview channel
  (`previewClassStyles.breakpointId`) generalises to `contextId`.

**Store**
- `src/admin/pages/site/store/slices/classSlice.ts` — collapse
  `setClassBreakpointStyles` + `updateConditionalLayerStyles` →
  `setClassContextStyles(classId, contextId, patch)`; drop `addConditionalLayer`
  / `removeConditionalLayer` (replaced by site-level condition CRUD);
  `removeClassStyleProperty` clears across `contextStyles`; `duplicateClass`
  clones `contextStyles`.
- New `conditionSlice` (or extend `canvasSlice`/site slice) — `addCondition`,
  `renameCondition`, `removeCondition`; `activeBreakpointId` → `activeContextId`
  (+ `setActiveContext`).
- `src/admin/pages/site/store/slices/canvasSlice.ts` — rename
  `activeBreakpointId`/`setActiveBreakpoint`.

**Importer**
- `src/core/siteImport/cssToStyleRules.ts` — emit into `contextStyles`; matched
  width @media → breakpoint contextId; custom conditions → create/reuse a
  `ConditionDef` and write under its id. `NewStyleRule` shape + `types.ts`
  follow. `applyImport.ts` merges `site.conditions`.

**Properties panel UI**
- `ClassComposer.tsx` — drop `ConditionTabs`; edit `contextStyles[activeContext]`
  driven by the toolbar switcher. `getActiveStyleTab` → context-based.
- **Delete** `ConditionTabs.tsx` (+ `.module.css`) and the modal.
- `StyleSurface.tsx`, `SelectorInspector.tsx`,
  `SpacingBoxControl`/`LayoutSection`/`PositionSection` (keyed on `activeTab`) —
  re-key on `activeContextId`.

**Canvas toolbar**
- `CanvasBreakpointSelector.tsx` → `CanvasContextSelector.tsx` (grouped options +
  "Add condition" builder popover). `CanvasModeToggle.tsx`,
  `CanvasRoot.tsx` wiring follows.
- New `ConditionBuilder` popover component + guided sub-builders.

**Settings**
- `Settings/sections/BreakpointsSection.tsx` — optionally a sibling
  "Conditions" section to manage the registry (or manage inline in the
  switcher; decide in review).

**Spotlight**
- `spotlight/scopes/breakpointsScope.ts` — extend to contexts, or add a
  conditions scope.

**Architecture / tests**
- Update/replace: `canvasBreakpointSelector.test.tsx`, `breakpointProps.test.tsx`,
  publisher class-CSS tests, importer @media/@container/@supports tests,
  `parseStyleRule` round-trip tests, any test asserting `breakpointStyles` /
  `conditionalLayers` shape, `migration-parity` is unaffected (no DB columns
  change — this is all inside the site-document JSON).

**Docs**
- `docs/editor.md` (the `CanvasBreakpointSelector` row + responsive model),
  `docs/plans/2026-05-30-css-fidelity-and-at-rules.md` (Part 2b is superseded —
  cross-link this plan), `docs/reference/css-class-registry.md`,
  `docs/features/publisher.md`.

---

## Phasing

1. **P1 — schema + migration + publisher (no UI).** Add `site.conditions` +
   `StyleRule.contextStyles`; migrate `breakpointStyles`/`conditionalLayers` on
   read; flip the publisher + injector to `contextStyles`. Importer writes the
   new shape. *Existing sites round-trip; published CSS identical.* No visible
   UI change yet — internal unification.
2. **P2 — context switcher.** `CanvasBreakpointSelector` → `CanvasContextSelector`
   listing Base + breakpoints + conditions; route panel edits via
   `activeContextId`. Delete `ConditionTabs` + modal. The properties panel now
   follows the toolbar context for *all* conditions, not just breakpoints.
3. **P3 — guided condition builder.** The "+ Add condition" popover with preset
   chips + width/size/feature builders + raw escape hatch + label. Site-level
   condition CRUD (rename/remove) in the switcher.
4. **P4 — polish.** Non-width context badge on the canvas; per-context "set"
   indicators; container-picker for `@container` authoring (Q-B); optional
   Settings → Conditions management section.

P1 is invisible-but-foundational; P2 delivers the headline UX (one switcher, no
modal); P3 removes the friction; P4 is refinement.

---

## Tests

- **Migration:** a legacy rule with `breakpointStyles` + `conditionalLayers`
  parses into `contextStyles` with the right keys; a synthesised `ConditionDef`
  appears in `site.conditions`. Legacy-free rules default to `{}`.
- **Publisher:** a rule with base + breakpoint context + custom condition context
  emits all three in the defined cascade order; `@container <name> (query)` and
  `@supports (query)` preludes resolve from the registry.
- **Importer:** width `@media` matching a breakpoint → `contextStyles[bpId]`;
  unmatched `@media`/`@container`/`@supports` → a `ConditionDef` + override under
  its id; zero `unmatched-media-query` warnings.
- **Store:** `setClassContextStyles` writes/clears a context bag;
  `addCondition`/`removeCondition` manage the registry and removing a condition
  clears it from every rule; `duplicateClass` clones `contextStyles`.
- **Switcher:** selecting a breakpoint context reframes; selecting a non-width
  context badges + routes edits; "+ Add condition" creates a `ConditionDef` and
  activates it.
- **Builder:** preset chips produce valid conditions; raw expression validates
  via `CSSStyleSheet`; container picker designates the container node.

---

## Decisions needed before building

1. **Storage model — A1 (full unification, recommended) vs A2 (UI-only).** A1
   removes the duplicate system but is the bigger refactor + a local-data
   migration; A2 ships the UX win without touching breakpoint storage.
2. **Condition scope — site-level reusable registry (recommended, part of A1)
   vs per-class.** Site-level is the modular answer and mirrors breakpoints;
   per-class keeps conditions local to one rule.
3. **Condition management home — inline in the switcher only, or also a
   Settings → Conditions section** (parallel to Breakpoints).

---

## Related

- `docs/plans/2026-05-30-css-fidelity-and-at-rules.md` — Part 2b ("+ Condition"
  editor) is superseded by this unified design.
- `docs/plans/2026-05-29-super-import.md` — the import pipeline whose
  round-tripping this improves.
- `src/core/page-tree/styleRule.ts`, `breakpoint.ts` — schema home.
- `src/core/publisher/classCss.ts` — `generateClassCSS` / `conditionPrelude`.
- `src/admin/pages/site/canvas/CanvasBreakpointSelector.tsx` — the switcher to
  generalise.
- `src/admin/pages/site/panels/PropertiesPanel/ConditionTabs.tsx` — the modal to
  delete.
