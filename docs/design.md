# Design

The visual design system for Page Builder CMS — principles, tokens, surfaces, components.

The design is a **two-layer color model**: an achromatic base (surfaces, borders, default text) with a deliberate semantic and categorical color layer on top (rail tints for identity, state tokens for meaning, canvas neon for selection). Everything is tokenized in `src/styles/globals.css`. Every primitive lives in `src/ui/components/`.

---

## TL;DR

- **Base is achromatic; color is the layer on top.** Surfaces, borders, and default text are neutral. Color is used to convey **identity** (rail tints — mint, lilac, sky, peach) and **state** (danger, warning, success, info, canvas selection / hover). Color is never decorative — every colored pixel carries meaning.
- **Borderless tile cards.** Dashboard widgets and equivalent surfaces sit on a darker parent (`--editor-surface`) with a 1px grid gap, no border, 16px radius. The gap reveals the parent and reads as a divider. Hover lifts the surface tone, never the border. Canonical implementation: `src/ui/components/Widget/Widget.module.css`.
- **Bordered transparent inputs.** Inputs have a 1px white-alpha border, transparent background, and a pill 1em radius. Focus adds an inset achromatic glow.
- **Floating overlay panels.** Spotlight, popovers, modals use `--panel-*` tokens: panel background, 12px radius, blur backdrop, 3-layer composite shadow.
- **Editor controls** (toolbar buttons, chips) use `--editor-radius` (6px) for default and `--editor-radius-sm` (3px) for tight badges.
- **One source of truth: `src/styles/globals.css`.** No hardcoded hex / rgb / hsl in admin / ui CSS modules — gated by `css-token-policy.test.ts`.
- **CSS Modules only.** No Tailwind utility classes — gated by `noTailwindUtilities.test.ts`. No Tailwind ecosystem deps — gated by `no-tailwind-deps.test.ts`.
- **Every interactive control goes through a UI primitive** from `src/ui/components/`. Bare `<button>` is gated.
- **Icons come from `pixel-art-icons`.** Deep-imported for tree-shaking. No `lucide-react`, no inline SVG strings.

---

## Principles

### 1. The base disappears, the meaning appears

The chrome is dark, neutral, and quiet so the user's content and the system's signals are the only things competing for attention. Surfaces, borders, default text — all achromatic. Color is reserved for things that mean something: a green dot says "saved", a peach widget header says "this card is about posts", a neon ring says "the canvas selected this node".

If a color isn't carrying information, it doesn't belong in the chrome.

### 2. Two layers, sharp separation

```text
┌────────────────────────────────────────────────────────────────┐
│  Layer 2 — SEMANTIC + CATEGORICAL COLOR                        │
│  rail tints (mint/lilac/sky/peach), state (danger/warning/     │
│  success/info), canvas neon (selection/hover)                  │
├────────────────────────────────────────────────────────────────┤
│  Layer 1 — ACHROMATIC BASE                                     │
│  --editor-bg / --editor-surface / --editor-surface-2..5        │
│  --editor-text / --editor-text-bright / --editor-text-muted    │
│  --editor-border / --editor-border-med                         │
└────────────────────────────────────────────────────────────────┘
```

Both layers are tokenized. Layer 1 is the base every primitive paints itself with. Layer 2 is added by the primitive when there's a reason — a tint dot on a widget title, a colored row on a panel rail, a status pill, a focus ring on the canvas.

### 3. Surfaces have a hierarchy

The base layer uses six surface tones to convey depth without shadows or gradients on inline content. Lighter surfaces are higher in the stack:

```text
--editor-bg          #000000   ← page bottom (root, behind everything)
--editor-surface     #1b1b1b   ← darker parent of tile cards / sidebar fill
--editor-surface-2   #282828   ← tile cards themselves, panel bodies
--editor-surface-3   #323232   ← hover state for tiles, nested controls
--editor-surface-4   #4a4a4a   ← active state
--editor-surface-5   #605f5f   ← active + focused
--editor-bg-subtle   #323232   ← chips, badges inside nested surfaces
```

Hover and active states change **tone**, not border. Reach for the closest tone above the current surface; skip levels only with intent.

### 4. Cards are tiles, not boxes

The dashboard pattern — and any surface that wants to read as a unit — is a **borderless tile** sitting on a darker parent with a 1px grid gap. The gap reveals the parent and visually separates the cards without a stroke. The card has no border, just a background and a 16px radius. Hover lifts the surface, never the edge.

```text
Parent surface  ── --editor-surface
                   ┌──────────┐ ┌──────────┐ ┌──────────┐
                   │  tile 1  │ │  tile 2  │ │  tile 3  │   ← --editor-surface-2
                   └──────────┘ └──────────┘ └──────────┘
                   ▲           ▲           ▲
                   └────── 1px grid gap ───┘
                   (no border, just a sliver of the parent showing through)
```

This is implemented by `Widget` (`src/ui/components/Widget/`) and `DashboardGrid` (`src/admin/pages/dashboard/components/DashboardGrid.module.css`). Use the same pattern for any equivalent tile surface.

### 5. Inputs wear their borders. Cards don't.

Inputs are the inverse of cards: transparent background with a 1px white-alpha border. Pill radius (1em ≈ 16px). On focus, an inset achromatic glow appears. The border is what defines the input; no fill.

This split (cards = filled & borderless, inputs = unfilled & bordered) is the load-bearing visual distinction between containers and controls.

### 6. Identity is a color, not a label

Categories of things have an associated color drawn from the **rail tints**. Each widget category has a tint; each panel rail icon has a tint; each storage breakdown segment has a tint. Color is the at-a-glance label that lets the eye sort the screen.

| Token              | Hex       | Role                                                    |
|--------------------|-----------|---------------------------------------------------------|
| `--rail-tint-mint` | `#8ee6c8` | "Saved / system / status" categories                    |
| `--rail-tint-lilac`| `#c8b6ff` | "Pages / structure" categories                          |
| `--rail-tint-sky`  | `#9bdcff` | "Storage / data / configuration" categories             |
| `--rail-tint-peach`| `#ffc7a8` | "Posts / media / activity" categories                   |
| `--rail-tint-rose` | `#ffb6cd` | Fifth-hue overflow — used by breakdowns that need 5 categorical chips (e.g. Storage: images/videos/documents/plugins/database) |

Rail tints don't live in `src/styles/globals.css` to be decorative — they're part of the design system, and primitives like `Widget` accept a `tint` prop that maps to one of them. New rail tints are added by extending the token group, not by inlining a color.

### 7. The canvas owns its own palette

The canvas — where the user's page renders — has two and only two chromatic rings used purely as affordance:

- `--canvas-selection-ring` (neon green `#39ff14`) — node selected by the user
- `--canvas-hover-ring` (neon pink `#ff2bd6`) — node hovered

These are bright on purpose so they read against any user content, including content that itself uses the chrome palette.

A shared diagonal-stripe placeholder (`--canvas-placeholder-bg`) marks empty modules across every block type — image, video, content, loop, container, slot-outlet, VC reference. Edit once, retune everywhere.

### 8. Motion respects the reader

Animations are short, purposeful, and never block content. The `@media (prefers-reduced-motion: reduce)` rule in `globals.css` zeroes animation and transition durations and disables smooth scroll for users who opt out. This is a non-negotiable accessibility floor (Constraint #189), not a polish item.

---

## Tokens

All tokens live in `src/styles/globals.css`. Anywhere you need a color, radius, shadow, font, or z-index, use a token. If the right token doesn't exist, **add one to `globals.css`** — never inline a value.

### Color tokens

```text
Base surfaces (achromatic):
  --editor-bg, --editor-bg-subtle
  --editor-surface, --editor-surface-2..5
  --editor-border, --editor-border-med
  --editor-panel-border

Base text (achromatic):
  --editor-text-bright, --editor-text, --editor-text-secondary,
  --editor-text-muted, --editor-text-subtle

White accent (still in the base layer — alpha variants of white):
  --editor-accent (= #ffffff)
  --editor-accent-light (= #a1a1aa)
  --editor-accent-violet (= white at 0.8 alpha, despite the name)
  --editor-selection (= white at 0.08, used for selected rows / pressed states)

Rail tints (categorical identity layer):
  --rail-tint-mint, --rail-tint-lilac, --rail-tint-sky, --rail-tint-peach

Semantic state (meaning layer):
  --editor-danger, --editor-danger-light, --editor-danger-lighter,
  --editor-danger-text, --editor-danger-bg, --editor-danger-border
  --editor-warning, --editor-warning-text, --editor-warning-bg,
  --editor-warning-border
  --editor-success-green, --editor-success-bright,
  --editor-success-text, --editor-success-text-soft, --editor-success-bg
  --editor-info-text
  --editor-mint-surface  ← dark mint background for "saved / active" chrome
                          (breakpoint indicator, mode toggle)

Canvas (selection / hover affordances):
  --canvas-selection-ring          (inset 1px neon green)
  --canvas-hover-ring              (inset 1px neon pink)
  --canvas-selection-ring-color    (bare colour for outline / border-color)
  --canvas-hover-ring-color
  --canvas-placeholder-bg          (diagonal-stripe pattern for empty modules)

Code editor (GitHub Dark inspired — used inside CodeMirror only):
  --editor-syntax-keyword, --editor-syntax-entity,
  --editor-syntax-property, --editor-syntax-variable,
  --editor-syntax-string, --editor-syntax-constant,
  --editor-syntax-comment, --editor-syntax-operator, --editor-syntax-invalid

Charts:
  --editor-chart-default-tint (= --rail-tint-peach)
  --chart-series-min / --chart-series-min-glow
  --chart-series-max / --chart-series-max-glow
  --chart-segment-empty, --chart-segment-empty-border
  --chart-track-bg
```

### Text tokens — meaning hierarchy

| Token                       | Hex       | Means                          |
|-----------------------------|-----------|--------------------------------|
| `--editor-text-bright`      | `#f4f4f5` | Titles, headings, KPIs         |
| `--editor-text`             | `#ededed` | Primary body text              |
| `--editor-text-secondary`   | `#a1a1aa` | Labels, secondary UI           |
| `--editor-text-muted`       | `#787878` | Muted / placeholder            |
| `--editor-text-subtle`      | `#52525b` | Disabled / very subtle         |

These five are the entire text palette. Add a new tone only by adding a new token.

### Radius

| Token                | Value | Use                                                          |
|----------------------|-------|--------------------------------------------------------------|
| `--editor-radius-sm` | 3px   | Tight chips, micro-badges, segmented control inner indicator |
| `--editor-radius`    | 6px   | Default editor controls, toolbar buttons, ghost menu items   |
| `--panel-radius`     | 12px  | Floating overlay panels (Spotlight, modals, popovers)        |
| (literal) 16px       | 16px  | Borderless tile cards (Widget, dashboard cells)              |
| `--input-radius`     | 1em   | Pill-shaped inputs, classes / property chips                 |
| `--tooltip-radius`   | 6px   | Tooltips                                                     |

Do not introduce ad-hoc radius values. The "16px tile" value isn't yet a named token — it appears in `Widget.module.css` and `DashboardGrid.module.css` as a literal. If a third surface adopts the tile pattern, promote it to `--card-radius`.

### Shadow and elevation

| Token                       | Use                                                     |
|-----------------------------|---------------------------------------------------------|
| `--editor-focus-ring`       | Achromatic 1px focus ring (`0 0 0 1px rgba(255,255,255,0.25)`) |
| `--panel-shadow`            | Composite for floating panels: inset-top highlight + inset-bottom shadow + drop shadow |
| `--panel-shadow-inset-top`  | Sub-token: top inner highlight                          |
| `--panel-shadow-inset-bottom`| Sub-token: bottom inner shadow                         |
| `--panel-shadow-drop`       | Sub-token: drop shadow                                  |
| `--input-shadow-focus`      | Inset composite for focused inputs (achromatic glow)    |
| `--tooltip-shadow`          | Tooltip drop + inner highlight                          |

Use `--panel-shadow` directly when you need a floating-panel feel; don't recompose from the sub-tokens.

### Typography

```css
--font-sans: "Inter Variable", "Geist Variable", sans-serif;
--font-mono: "Geist Mono", "JetBrains Mono", ui-monospace, monospace;
```

Type **sizes** are per-component and don't yet have a token scale. The patterns in actual use:

- Widget titles: 11px, weight 600, uppercase, letter-spacing 0.07em, color `--editor-text-muted`
- Widget KPI values: very large (~48–72px), weight 600, color `--editor-text-bright`
- Body text: 13–14px, weight 400, color `--editor-text`
- Captions / labels: 11–12px, weight 500, color `--editor-text-secondary`
- Monospace (paths, code chips): same size as surrounding text, `--font-mono`, often with `--editor-bg-subtle` background

If a size recurs across three or more primitives, promote it to a token.

### Z-index

```text
--z-dropdown:           20
--tooltip-z-index:    2000
--spotlight-z-index:  9000
```

Use these for all dropdowns, tooltips, and the command palette. The visual editor has additional raw z-index values for the layout chrome (sidebars, floating panels) and a separate internal ladder inside the canvas's isolating stacking context — those are intentional exceptions documented in [`docs/reference/design-tokens.md`](reference/design-tokens.md) → "Z-index layers".

### Spotlight

The Cmd+K command palette has its own token group (`--spotlight-*`) covering backdrop, row highlight, mark color, group header, footer, destructive row, confirm state, and skeleton shimmer. Spotlight-only surfaces use those tokens; chrome elsewhere shouldn't.

---

## Surface systems

The editor composes four kinds of surfaces. Each has its own token group, geometry, and rules.

### 1. Tile cards (`--editor-surface-2` on `--editor-surface`)

The dashboard pattern. Borderless tiles on a darker parent, 1px grid gap, 16px radius.

```css
.parent {
  background: var(--editor-surface);
  display: grid;
  gap: 1px;              /* the gap that becomes the visual divider */
}

.tile {
  background: var(--editor-surface-2);
  border: 0;
  border-radius: 16px;
  /* hover lifts the tone, never the border */
}
.tile:hover {
  background: var(--editor-surface-3);
}
```

Each tile usually carries:

- A **title row** with a small rail-tint dot (7px, `--editor-radius-sm`) + uppercase 11px label
- A **value** rendered large with `--editor-text-bright`
- Optional micro-trend, chart, or list body

This is what reads as the Page Builder dashboard aesthetic. Same pattern is used by the storage breakdown, posts widget, activity feed, etc. The "Add block" tile uses `box-shadow: inset 0 0 0 1px ...` to convey emptiness without breaking the borderless rule.

### 2. Floating overlay panels (`--panel-*`)

Spotlight, popovers, modals, and command palettes. These sit above the editor with a blur backdrop:

```css
.panel {
  background: var(--panel-bg);              /* rgb(30 30 30) */
  border: 1px solid var(--panel-border);    /* rgba(255,255,255,0.10) */
  border-radius: var(--panel-radius);       /* 12px */
  backdrop-filter: blur(var(--panel-blur)); /* 24px */
  box-shadow: var(--panel-shadow);          /* composite */
}
```

Floating panels are the only surface that uses a visible border + blur — they're explicitly stacked above the editor, so they advertise themselves with the border and the slight transparency that the blur reveals.

### 3. Inputs (`--input-*`)

Bordered, transparent, pill-shaped:

```css
.input {
  background: var(--input-bg);              /* transparent */
  border: 1px solid var(--input-border);    /* rgba(255,255,255,0.20) */
  border-radius: var(--input-radius);       /* 1em */
  color: var(--editor-text);
}
.input:hover  { border-color: var(--input-border-hover); }
.input:focus  { border-color: var(--input-border-focus); box-shadow: var(--input-shadow-focus); }
```

The border is the input's identity. Don't fill them. Don't square the corners.

### 4. Panel rail (the colored sidebar)

42px-wide vertical rail of icon buttons. Each button declares a `data-accent="mint|lilac|sky|peach"` attribute that picks its tint, semi-transparent hover/active background, and glow:

```css
.railButton[data-accent="mint"] {
  --rail-icon-color: var(--rail-tint-mint);
  --rail-icon-active-bg: rgba(142, 230, 200, 0.16);
  --rail-icon-hover-bg:  rgba(142, 230, 200, 0.10);
  --rail-icon-glow:      rgba(142, 230, 200, 0.28);
}
```

Icons in the rail get a `drop-shadow` glow matching their tint. The active rail item has a 2px tinted indicator on its left edge. Canonical implementation: `src/admin/pages/site/sidebars/PanelRail/PanelRail.module.css`.

This pattern (per-item rail tint via `data-accent`) is the recipe for any equivalent sidebar — media sidebar, data sidebar, etc.

---

## Components

Every interactive control in the admin and editor goes through a primitive from `src/ui/components/`. Bare `<button>` in `src/admin/*` is gated by `button-primitive-usage.test.ts` — the allowlist in that file documents the §8 exceptions.

| Primitive            | When to use                                                                 |
|----------------------|-----------------------------------------------------------------------------|
| `Button`             | Every action button. Variants for primary / secondary / ghost / danger.     |
| `Input`              | Single-line text input. Pill radius, transparent fill, bordered.            |
| `Switch`             | Boolean toggle.                                                             |
| `Checkbox`           | Boolean within a list / form.                                               |
| `Select`             | Dropdown selection of fixed options.                                        |
| `SearchBar`          | Search input with magnifier icon and clear affordance.                      |
| `ColorInput`         | Color picker with swatch + hex.                                             |
| `FileUpload`         | Drop-zone + browse for file inputs.                                         |
| `DateTimePicker`     | Date / time inputs.                                                         |
| `RangeTabs`          | Tabbed numeric range selectors (e.g. spacing scales).                       |
| `SegmentedControl`   | A few mutually exclusive options shown inline.                              |
| `Tabs`               | Top-level tab navigation within a workspace.                                |
| `Separator`          | Visual divider between sections.                                            |
| `Section`            | Titled section block in panels.                                             |
| `ControlRow`         | Standard label + control row in property panels.                            |
| `ContextMenu`        | Right-click and `…` overflow menus.                                         |
| `FilterBar`          | Compound filter row (type + folder + date + query).                         |
| `FloatingActionBar`  | Multi-select bulk-action bar.                                               |
| `EmptyState`         | Empty-list / empty-page placeholder.                                        |
| `Dialog`             | Modal dialog with a title and content.                                      |
| `Tooltip`            | Hover tooltips. Replaces the native `title` attribute (gated).              |
| `Toast`              | Transient confirmation / error notifications.                               |
| `DataTable`          | Tabular data with sorting and selection.                                    |
| `Widget`, `WidgetList`| Borderless tile card (the dashboard pattern). Accepts a `tint`.            |
| `Image`              | Image with built-in blurhash fallback.                                      |
| `CanvasModulePlaceholder`| Diagonal-stripe placeholder for empty modules.                          |
| `ErrorBoundary`      | Component-level error containment.                                          |

For tree-shaped controls (DOM panel, layers panel, site tree), use `Tree*` from `src/admin/pages/site/ui/Tree/`.

### Composition helper

Class composition uses `cn` from `@ui/cn` — a 3-line helper in `src/ui/cn.ts`. **Do not** add `clsx`, `tailwind-merge`, `class-variance-authority`, or `@radix-ui/*`. Gated by `no-tailwind-deps.test.ts`.

```ts
import { cn } from '@ui/cn'

<button className={cn(styles.btn, isActive && styles.active, props.className)} />
```

---

## Icons

Icons are TSX components from the vendored `pixel-art-icons` package. Each icon is its own file; deep-import to keep the bundle small:

```tsx
import { ChevronRight } from 'pixel-art-icons/icons/ChevronRight'

<ChevronRight />
```

Rules:

- No barrel import (`import { X } from 'pixel-art-icons'`) — always `pixel-art-icons/icons/<name>`.
- No `lucide-react`, `heroicons`, `phosphor-icons`, or other catalogs. Gated by `no-third-party-icons.test.ts`.
- No inline SVG strings in components. Gated by `direct-icon-imports.test.ts`.
- Icons in the panel rail or equivalent identity surfaces are colored via `--rail-icon-color` (which is set from a rail tint by `data-accent`). Don't hardcode `color` on the icon itself.
- Adding a new icon: import it normally, then run `bun run icons:sync`. The vendored set is gated for freshness by `vendor-icons-fresh.test.ts`.

The full set (~4,053 icons) lives in the sibling repo `../pixel-art-icons`; the CMS vendors only the icons it actually imports.

---

## CSS rules

### CSS Modules only

Files named `Component.module.css` next to `Component.tsx`. Class names are `camelCase`. No Tailwind utility classes in `src/admin/`, `src/modules/`, or `src/ui/` — gated by `noTailwindUtilities.test.ts`. Tailwind ecosystem dependencies are banned outright — gated by `no-tailwind-deps.test.ts`. This includes all palette names (`bg-zinc-100`, `text-blue-400`, etc.), arbitrary-value syntax (`min-h-[44px]`), and `@tailwind` / `@apply` directives.

```text
src/ui/components/Button/
├── Button.tsx
├── Button.module.css
└── index.ts
```

### No hardcoded colors in admin / ui CSS modules

Every color, gradient, and shadow in `src/admin/`, `src/admin/pages/site/`, and `src/ui/` CSS modules is a `var(--*)` reference. If the right token doesn't exist, add it to `globals.css` first. Gated by `css-token-policy.test.ts`.

❌ `color: #ededed;`
✅ `color: var(--editor-text);`

**Exception:** `src/modules/*` is intentionally exempt — those CSS files ship to the published page output where editor tokens aren't available.

### No inline `style={{...}}` (with one exception)

Inline `style` is banned. The only legitimate use is **dynamic CSS custom properties** that the static module reads back via `var(--*)`:

```tsx
<div
  className={styles.module}
  style={{ '--module-min-height': `${minHeight}px` } as CSSProperties}
/>
```

```css
.module { min-height: var(--module-min-height); }
```

### No `!important`

Banned in component CSS modules. The only legitimate exceptions are:

- `globals.css` for the `prefers-reduced-motion` override
- `Button.module.css` for specificity reset on variant overrides

If you find yourself reaching for `!important`, the cascade is wrong — fix the selector.

---

## Accessibility

### Reduced motion

`@media (prefers-reduced-motion: reduce)` in `globals.css` zeroes animation / transition durations and disables smooth scroll. Every animated component must respect this — see `Widget.module.css`, `DashboardGrid.module.css`, and `PanelRail.module.css` for the pattern. Non-negotiable (Constraint #189).

### Focus

The achromatic focus ring is `--editor-focus-ring` (1px white at 25% alpha). Inputs use a stronger composite focus glow via `--input-shadow-focus`. Never remove focus indicators without replacing them with a visible alternative.

### Color contrast

The text tokens (`--editor-text-bright` → `--editor-text-subtle`) pass WCAG AA against `--editor-bg`. The semantic state tokens have a `*-text` variant (e.g. `--editor-danger-text`, `--editor-success-text`) chosen for use **on a tinted background** — use those instead of pairing a raw `--editor-danger` with `--editor-bg`.

### No native browser dialogs

`alert()`, `confirm()`, `prompt()` are banned — gated by `no-native-browser-dialogs.test.ts`. Use the `Dialog` primitive or component state with `role="alert"` / `role="status"`.

### No native title tooltips

The HTML `title` attribute is banned for hover hints — gated by `no-native-title-tooltips.test.ts`. Use the `Tooltip` primitive.

---

## Forbidden patterns

| Pattern                                                  | Use instead                                              |
|----------------------------------------------------------|----------------------------------------------------------|
| `<button>` in editor / admin code                        | `<Button>` from `src/ui/components/Button`               |
| `color: #ededed;` (hardcoded color)                      | `color: var(--editor-text);`                             |
| `border: 1px solid #333;` (hardcoded border)             | `border: 1px solid var(--editor-border);`                |
| `className="text-zinc-400"` (Tailwind utility)           | CSS Module class                                         |
| `className="bg-blue-500"`, `min-h-[44px]`, etc.          | CSS Module class with a token                            |
| `import { cn } from 'clsx'`                              | `import { cn } from '@ui/cn'`                            |
| `import { X } from 'lucide-react'`                       | `import { X } from 'pixel-art-icons/icons/X'`            |
| `style={{ color: 'white' }}`                             | CSS Module class — `style` is only for CSS custom properties |
| `!important` in a component CSS module                   | Restructure selectors                                    |
| `alert('Saved!')`                                        | Toast or `role="status"` element                         |
| `<input title="Help text">` (hover hint)                 | `<Tooltip>` primitive                                    |
| Inline SVG icon string                                   | `pixel-art-icons/icons/<name>`                           |
| Card with a colored border                               | Borderless tile on a darker parent (1px gap pattern)     |
| Hover that changes a card's border color                 | Hover that lifts the surface tone (`-surface-2` → `-3`)  |
| Filling an input with a tinted background                | Transparent fill, white-alpha border                     |
| Inventing a one-off color for a category                 | Pick a rail tint, or add a new tint token in `globals.css`|

---

## Adding a new design token

1. Add the CSS custom property to `src/styles/globals.css` in the appropriate group.
2. Add a one-line comment if the meaning isn't obvious from the name.
3. Use it via `var(--*)` in CSS modules.
4. If it represents a new concept (not a variation of an existing group), update [docs/reference/design-tokens.md](reference/design-tokens.md).

## Adding a new UI primitive

1. Create `src/ui/components/<Name>/<Name>.tsx`, `<Name>.module.css`, and `index.ts`.
2. Re-export from `src/ui/components/index.ts` so consumers import from `@ui/components`.
3. The primitive must work with the existing tokens — do not introduce new colors or radii to support it. If you need new tokens, see "Adding a new design token" first.
4. If it replaces a bare HTML control (`button`, `input`, etc.), update the matching architecture test's allowlist or gate.
5. Document it in the components table above and (if it has non-obvious usage) write a short [docs/reference/ui-primitives.md](reference/ui-primitives.md) entry.

## Adding a new tile-card surface

1. Use `--editor-surface` on the parent container with `display: grid` and `gap: 1px`.
2. The tile body is `background: var(--editor-surface-2)`, `border: 0`, `border-radius: 16px`.
3. Hover lifts to `--editor-surface-3` — never recolor the border.
4. Add a title row with a rail-tint dot (7px, `--editor-radius-sm` (3px), `background: var(--tint)`).
5. Pick a rail tint per the table in §6 (Identity is a color).
6. Reuse `Widget` from `src/ui/components/Widget/` unless the surface fundamentally differs.

---

## Related

- [docs/CONVENTIONS.md](CONVENTIONS.md) — how docs in this repo are structured
- [docs/architecture.md](architecture.md) — system overview
- [docs/reference/design-tokens.md](reference/design-tokens.md) — complete token catalog
- [docs/reference/ui-primitives.md](reference/ui-primitives.md) — primitive usage cookbook
- Source-of-truth files:
  - `src/styles/globals.css` — all tokens
  - `src/ui/components/` — all primitives
  - `src/ui/cn.ts` — class composition helper
  - `src/ui/components/Widget/Widget.module.css` — canonical tile-card implementation
  - `src/admin/pages/dashboard/components/DashboardGrid.module.css` — canonical 1px-gap grid
  - `src/admin/pages/site/sidebars/PanelRail/PanelRail.module.css` — canonical tinted rail
  - `vendor/pixel-art-icons/` — vendored icon set
- Gate tests:
  - `src/__tests__/architecture/css-token-policy.test.ts` — no hardcoded colors in admin / ui CSS modules
  - `src/__tests__/architecture/noTailwindUtilities.test.ts` — no Tailwind utility classes (covers all palette names)
  - `src/__tests__/architecture/no-tailwind-deps.test.ts` — no Tailwind ecosystem dependencies
  - `src/__tests__/architecture/button-primitive-usage.test.ts` — every button goes through `Button`
  - `src/__tests__/architecture/ui-primitives-location.test.ts` — primitives live in `src/ui/components/`
  - `src/__tests__/architecture/no-third-party-icons.test.ts` — icons come from `pixel-art-icons`
  - `src/__tests__/architecture/direct-icon-imports.test.ts` — no inline SVG strings
  - `src/__tests__/architecture/vendor-icons-fresh.test.ts` — vendored icon set is fresh
  - `src/__tests__/architecture/no-native-browser-dialogs.test.ts` — no `alert` / `confirm` / `prompt`
  - `src/__tests__/architecture/no-native-title-tooltips.test.ts` — no `title=` hover hints
  - `src/__tests__/architecture/close-icon-correctness.test.ts` — close icons render the right glyph
