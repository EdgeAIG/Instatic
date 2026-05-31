# Design Tokens

The complete catalog of design tokens declared in `src/styles/globals.css`. Every color, radius, shadow, font, and z-index used by the admin / editor / UI primitives is here. CSS Modules in `src/admin/`, `src/admin/pages/site/`, and `src/ui/` MUST reference these via `var(--*)` — hardcoded hex / rgb / hsl is gated by `css-token-policy.test.ts`.

---

## TL;DR

- One file: `src/styles/globals.css`.
- Grouped by surface: editor chrome, panels, inputs, canvas, tooltips, spotlight, charts.
- **Two-layer color model**: achromatic base + semantic / categorical color layer on top. See [docs/design.md](../design.md) for the rationale.
- Add a new token by editing `globals.css`. Reference it with `var(--your-token)` in CSS Modules.
- The `src/modules/` directory is **exempt** from the no-hardcoded-color rule — module CSS ships to published pages where editor tokens aren't available.

---

## Fonts

```css
--font-sans: "Inter Variable", "Geist Variable", sans-serif;
--font-mono: "Geist Mono", "JetBrains Mono", ui-monospace, monospace;
```

Type sizes are per-component and don't yet have a token scale. If a recurring size emerges across 3+ primitives, promote it to a token.

---

## Editor surface hierarchy (achromatic base)

Six surface tones for depth. Lighter is higher in the stack.

| Token                  | Hex       | Use                                                            |
|------------------------|-----------|----------------------------------------------------------------|
| `--editor-bg`          | `#000000` | Page bottom — root, behind everything                          |
| `--editor-bg-subtle`   | `#323232` | Chips, badges inside nested surfaces                           |
| `--editor-surface`     | `#1b1b1b` | Darker parent of tile cards / sidebar fill                     |
| `--editor-surface-2`   | `#282828` | Tile cards themselves, panel bodies                            |
| `--editor-surface-3`   | `#323232` | Hover state for tiles, nested controls                         |
| `--editor-surface-4`   | `#4a4a4a` | Active state                                                   |
| `--editor-surface-5`   | `#605f5f` | Active + focused                                               |

Hover and active states change **tone**, not border. Skip levels only with intent.

---

## Borders

| Token                  | Hex       | Use                                                            |
|------------------------|-----------|----------------------------------------------------------------|
| `--editor-border`      | `#333333` | Default 1px borders on input controls, dividers                |
| `--editor-border-med`  | `#2e2e2e` | Slightly elevated borders (active states on bordered controls) |
| `--editor-panel-border`| `#1f1f1f` | Panels — quieter than `--editor-border`                        |

---

## Text hierarchy

Five tones, each a different meaning level.

| Token                       | Hex       | Means                          |
|-----------------------------|-----------|--------------------------------|
| `--editor-text-bright`      | `#f4f4f5` | Titles, headings, KPIs         |
| `--editor-text`             | `#ededed` | Primary body text              |
| `--editor-text-secondary`   | `#a1a1aa` | Labels, secondary UI           |
| `--editor-text-muted`       | `#787878` | Muted / placeholder            |
| `--editor-text-subtle`      | `#52525b` | Disabled / very subtle         |

Add a new text tone only by adding a new token here.

---

## White accents (in the base layer)

Alpha-variants of white used for selected rows, pressed states, focus rings.

| Token                     | Value                              | Use                                  |
|---------------------------|------------------------------------|--------------------------------------|
| `--editor-accent`         | `#ffffff`                          | Pure white accent (Vercel-style)     |
| `--editor-accent-light`   | `#a1a1aa`                          | Subtle accent                        |
| `--editor-accent-violet`  | `rgba(255, 255, 255, 0.8)`         | Canvas selection (despite the name — it's achromatic white) |
| `--editor-selection`      | `rgba(255, 255, 255, 0.08)`        | Selected list rows, pressed buttons  |

---

## Rail tints (categorical identity layer)

Four colors used as per-category identity — widget category, panel rail, sidebar icons, storage breakdown segments.

| Token              | Hex       | Conventional category                                                  |
|--------------------|-----------|------------------------------------------------------------------------|
| `--rail-tint-mint` | `#8ee6c8` | "Saved / system / status"                                              |
| `--rail-tint-lilac`| `#c8b6ff` | "Pages / structure"                                                    |
| `--rail-tint-sky`  | `#9bdcff` | "Storage / data / configuration"                                       |
| `--rail-tint-peach`| `#ffc7a8` | "Posts / media / activity"                                             |

Used by `Widget` (`tint` prop), `PanelRail` (`data-accent="<tint>"`), and the storage breakdown chart. Don't introduce a fifth tint as a one-off — propose it as a new token.

---

## Semantic state (meaning layer)

### Danger / error

| Token                       | Value                              | Use                                   |
|-----------------------------|------------------------------------|---------------------------------------|
| `--editor-danger`           | `#ef4444`                          | Error fill (button, badge, border)    |
| `--editor-danger-light`     | `#f87171`                          | Lighter danger for text               |
| `--editor-danger-lighter`   | `#fca5a5`                          | Very light danger tint                |
| `--editor-danger-text`      | `#fecaca`                          | Danger badge text                     |
| `--editor-danger-bg`        | `rgba(239, 68, 68, 0.1)`           | Danger pill / message surface         |
| `--editor-danger-border`    | `rgba(239, 68, 68, 0.2)`           | Danger surface border                 |

### Warning

| Token                       | Value                              | Use                                   |
|-----------------------------|------------------------------------|---------------------------------------|
| `--editor-warning`          | `#f59e0b`                          | Warning fill                          |
| `--editor-warning-text`     | `#fde68a`                          | Warning badge text                    |
| `--editor-warning-bg`       | `rgba(245, 158, 11, 0.1)`          | Warning surface                       |
| `--editor-warning-border`   | `rgba(245, 158, 11, 0.3)`          | Warning surface border                |

### Success

| Token                          | Value                              | Use                                   |
|--------------------------------|------------------------------------|---------------------------------------|
| `--editor-success-green`       | `#34d399`                          | Saved / OK indicator                  |
| `--editor-success-bright`      | `#4ade80`                          | Agent tool success                    |
| `--editor-success-text`        | `#d1fae5`                          | Success badge text                    |
| `--editor-success-text-soft`   | `#a7f3d0`                          | Success hint text                     |
| `--editor-success-bg`          | `rgba(52, 211, 153, 0.1)`          | Success pill surface                  |

### Info

| Token                  | Value         | Use                                            |
|------------------------|---------------|------------------------------------------------|
| `--editor-info-text`   | `#c4b5fd`     | Violet-tinted info text                        |

### Mint surface (canvas chrome / mode toggle)

| Token                  | Hex         | Use                                            |
|------------------------|-------------|------------------------------------------------|
| `--editor-mint-surface`| `#1a2924`   | Dark mint background for the canvas breakpoint indicator and mode toggle |

---

## Canvas (selection / hover affordances)

```css
--canvas-selection-ring:        inset 0 0 0 1px #39ff14;   /* neon green */
--canvas-hover-ring:            inset 0 0 0 1px #ff2bd6;   /* neon pink */
--canvas-selection-ring-color:  #39ff14;
--canvas-hover-ring-color:      #ff2bd6;
```

Bare colour variants (`*-ring-color`) are for surfaces that need an `outline` / `border-color` / custom shadow geometry rather than the full inset-ring shorthand. Keep them in sync with the shorthand.

### Canvas placeholder

```css
--canvas-placeholder-bg:
    repeating-linear-gradient(
        -45deg,
        color-mix(in srgb, var(--editor-text-muted) 6%, transparent) 0 6px,
        transparent 6px 12px
    ),
    color-mix(in srgb, var(--editor-text-muted) 4%, transparent);
```

The shared diagonal-stripe pattern used by every module's "empty" placeholder (image, video, container, slot-outlet, VC ref placeholders). Strictly achromatic. Edit once, retune everywhere.

---

## Code editor syntax (GitHub Dark inspired)

Used inside CodeMirror only. Don't reach for these in editor chrome.

| Token                       | Hex         | Use                          |
|-----------------------------|-------------|------------------------------|
| `--editor-syntax-keyword`   | `#ff7b72`   | Keywords (`if`, `return`)    |
| `--editor-syntax-entity`    | `#d2a8ff`   | Function names, types        |
| `--editor-syntax-property`  | `#7ee787`   | Object properties            |
| `--editor-syntax-variable`  | `#ffa657`   | Variables                    |
| `--editor-syntax-string`    | `#a5d6ff`   | String literals              |
| `--editor-syntax-constant`  | `#79c0ff`   | Numbers, constants           |
| `--editor-syntax-comment`   | `#8b949e`   | Comments                     |
| `--editor-syntax-operator`  | `#c9d1d9`   | Operators, punctuation       |
| `--editor-syntax-invalid`   | `#ffa198`   | Invalid syntax               |

---

## Border radius

| Token                | Value | Use                                                          |
|----------------------|-------|--------------------------------------------------------------|
| `--editor-radius-sm` | 3px   | Tight chips, micro-badges, segmented-control inner indicator |
| `--editor-radius`    | 6px   | Default editor controls, toolbar buttons, ghost menu items   |
| `--panel-radius`     | 12px  | Floating overlay panels                                      |
| (literal) 16px       | 16px  | Borderless tile cards (Widget). Not yet a named token — promote if a third surface adopts it. |
| `--input-radius`     | 1em   | Pill-shaped inputs, class / property chips                   |
| `--tooltip-radius`   | 6px   | Tooltips                                                     |

---

## Shadows

| Token                          | Use                                                                       |
|--------------------------------|---------------------------------------------------------------------------|
| `--editor-focus-ring`          | `0 0 0 1px rgba(255, 255, 255, 0.25)` — 1px achromatic focus ring         |
| `--panel-shadow`               | Composite (top-inset highlight + bottom-inset shadow + drop shadow)        |
| `--panel-shadow-inset-top`     | Sub-token: `inset 0 1px 0 rgba(255, 255, 255, 0.08)`                       |
| `--panel-shadow-inset-bottom`  | Sub-token: `inset 0 -1px 0 rgba(0, 0, 0, 0.35)`                            |
| `--panel-shadow-drop`          | Sub-token: `0 12px 40px rgba(0, 0, 0, 0.65)`                               |
| `--input-shadow-focus`         | Inset composite achromatic glow for focused inputs                         |
| `--tooltip-shadow`             | `0 4px 16px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.04)`   |

Use `--panel-shadow` directly when you need a floating-panel feel. Don't recompose from the sub-tokens.

---

## Floating overlay panels

```css
--panel-bg:                 rgb(30 30 30);
--panel-border:             rgba(255, 255, 255, 0.1);
--panel-radius:             12px;
--panel-blur:               24px;
```

Used by spotlight, popovers, modals — anything that floats above the editor with a blur backdrop.

---

## Inputs

```css
--input-bg:             transparent;
--input-bg-focus:       transparent;                /* yes, also transparent */
--input-border:         rgba(255, 255, 255, 0.20);
--input-border-hover:   rgba(255, 255, 255, 0.25);
--input-border-focus:   rgba(255, 255, 255, 0.50);
--input-shadow:         none;
--input-shadow-focus:   inset 0 0 5px #ffffff0f,
                        inset 0 -5px 8px #ffffff17,
                        0 0 5px #0000003d;
--input-radius:         1em;
```

Cards are filled and borderless; inputs are unfilled and bordered. That's the load-bearing visual distinction between containers and controls.

---

## Z-index layers

Three global tokens cover the three surfaces that float above everything:

```css
--z-dropdown:           20;
--tooltip-z-index:    2000;
--spotlight-z-index:  9000;
```

The visual editor uses additional raw z-index values that are **not** tokenised. They fall into two independent stacking contexts:

**Editor layout context** (shared stacking context for the editor chrome):

| Value | What occupies it |
|-------|-----------------|
| 0     | `CanvasRoot` — an isolation root; all canvas-internal values are confined here |
| 30    | Main toolbar |
| 50    | Floating panels: PropertiesPanel, AgentPanel, DomPanel |
| 55    | LeftSidebar, RightSidebar, PanelRail |
| 80    | CodeEditorPanel |
| 201   | Toolbar popovers / dropdowns |
| 400–401 | PreviewOverlay |

**Canvas-internal context** (confined inside CanvasRoot's `z-index: 0`):

| Value       | What occupies it |
|-------------|-----------------|
| 24–25       | CanvasModeToggle, CanvasNotch, CanvasContextSelector |
| 50          | PluginCanvasOverlayLayer |
| 51          | Selection ring, hover ring, selection toolbar |
| 2147483647  | Drop-indicator layer inside iframe (must beat arbitrary module stacking contexts) |

`CanvasRoot` declares `z-index: 0; position: relative` to establish the isolation. Without it, the canvas-internal z-index 51 would escape into the layout context and paint over floating panels at z-index 50. See [`docs/editor.md`](../editor.md) → "Canvas stacking context isolation" for the full explanation.

Raw canvas-internal values are intentional exceptions — they cannot be tokens because they are relative to an isolated stacking context, not the global one. Do not add new raw z-index values outside this established ladder.

---

## Tooltips

| Token                  | Value                                                                       |
|------------------------|-----------------------------------------------------------------------------|
| `--tooltip-bg`         | `#0a0a0c`                                                                   |
| `--tooltip-fg`         | `#f4f4f5`                                                                   |
| `--tooltip-border`     | `rgba(255, 255, 255, 0.06)`                                                 |
| `--tooltip-shadow`     | `0 4px 16px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.04)`    |
| `--tooltip-radius`     | `6px`                                                                       |
| `--tooltip-z-index`    | `2000`                                                                      |

---

## Spotlight (Cmd+K command palette)

Spotlight has its own token group. Don't reuse outside Spotlight.

| Token                              | Value                                  |
|------------------------------------|----------------------------------------|
| `--spotlight-backdrop`             | `rgba(0, 0, 0, 0.5)`                   |
| `--spotlight-backdrop-blur`        | `8px`                                  |
| `--spotlight-z-index`              | `9000`                                 |
| `--spotlight-width`                | `640px`                                |
| `--spotlight-row-selected-bg`      | `rgba(255, 255, 255, 0.08)`            |
| `--spotlight-mark-bg`              | `rgba(52, 211, 153, 0.20)`             |
| `--spotlight-mark-fg`              | `var(--editor-text-bright)`            |
| `--spotlight-group-header-fg`      | `var(--editor-text-subtle)`            |
| `--spotlight-footer-bg`            | `rgba(255, 255, 255, 0.03)`            |
| `--spotlight-destructive-fg`       | `var(--editor-danger-light)`           |
| `--spotlight-confirm-bg`           | `rgba(239, 68, 68, 0.08)`              |
| `--spotlight-skeleton-base`        | `rgba(255, 255, 255, 0.06)`            |
| `--spotlight-skeleton-shimmer`     | `rgba(255, 255, 255, 0.12)`            |

---

## Charts

Default chart tint, series colors, glow halos, empty-segment styling. Used by dashboard widgets and the framework scale UI.

| Token                          | Value                              | Use                                              |
|--------------------------------|------------------------------------|--------------------------------------------------|
| `--editor-chart-default-tint`  | `var(--rail-tint-peach)`           | Fallback when no per-call tint                   |
| `--chart-series-min`           | `#38bdf8` (sky 400)                | "Mobile" series                                  |
| `--chart-series-min-glow`      | `rgba(56, 189, 248, 0.40)`         | Halo for active mobile segment                   |
| `--chart-series-max`           | `#4ade80` (green 400)              | "Desktop" series                                 |
| `--chart-series-max-glow`      | `rgba(74, 222, 128, 0.40)`         | Halo for active desktop segment                  |
| `--chart-segment-empty`        | `rgba(255, 255, 255, 0.06)`        | Empty segment fill                               |
| `--chart-segment-empty-border` | `rgba(255, 255, 255, 0.04)`        | Empty segment border                             |
| `--chart-track-bg`             | `rgba(255, 255, 255, 0.04)`        | Track background behind chart segments           |

---

## Reduced motion

`globals.css` includes a non-negotiable reduced-motion override:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

The two `!important` declarations here are the **only legitimate `!important` usages** in `globals.css`. Constraint #189.

---

## Adding a new token

1. Pick the right group in `src/styles/globals.css` (color → semantic group; radius → radius group; z-index → z-index group).
2. Add the custom property with a one-line comment if the meaning isn't obvious from the name.
3. Reference it via `var(--*)` in CSS Modules.
4. Add a row to the matching table in this doc.
5. If it introduces a new concept (not a variation of an existing group), add a paragraph explaining what it's for in this doc and in [docs/design.md](../design.md).

---

## Forbidden patterns

| Pattern                                              | Use instead                              |
|------------------------------------------------------|------------------------------------------|
| `color: #ededed;` in an admin / ui CSS module        | `color: var(--editor-text);`             |
| `border: 1px solid #333;`                            | `border: 1px solid var(--editor-border);`|
| `box-shadow: 0 4px 16px rgba(0,0,0,0.5);`            | `box-shadow: var(--panel-shadow-drop);`  |
| Inventing a one-off radius                           | Use the radius scale                     |
| Inventing a one-off z-index                          | Use the existing z-index tokens          |
| Reaching for a fifth rail tint                       | Either add a token or pick from the four |
| Hardcoding the canvas selection ring color           | `var(--canvas-selection-ring)`           |

---

## Related

- [docs/design.md](../design.md) — design principles + surface systems + UI primitives
- [docs/reference/ui-primitives.md](ui-primitives.md) — which primitive uses which tokens
- Source-of-truth file: `src/styles/globals.css`
- Gate tests:
  - `src/__tests__/architecture/css-token-policy.test.ts`
  - `src/__tests__/architecture/achromatic-color-policy.test.ts` (deleted as redundant; the broader Tailwind ban catches palette names)
  - `src/__tests__/architecture/noTailwindUtilities.test.ts`
  - `src/__tests__/architecture/no-css-var-fallbacks.test.ts`
