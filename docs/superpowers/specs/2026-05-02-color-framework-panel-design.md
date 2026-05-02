# Color Framework Panel Design

## Goal

Add a dedicated Colors panel to the site editor for managing the color part of the site framework. Users can create core color tokens, generate Core Framework-style CSS variables and utility classes from those tokens, and reuse the generated utilities from the existing class picker.

This feature should be clean, minimal, and modular because typography will use the same generated-variable and generated-utility foundation later.

## Current Context

The editor already has several pieces this feature should reuse:

- Left-rail panels are mounted through `PanelRail` and `LeftSidebar`.
- Docked panels use shared `PanelHeader` and compact CSS module styling.
- The Selectors panel manages reusable classes from `site.classes`.
- The Properties panel uses `ClassPicker` to assign classes and `ClassComposer` to edit normal reusable classes.
- `CSSClass` records are the shared class registry.
- The publisher already emits `site.settings.colorTokens` into `:root` CSS variables.

The current color token model is a flat `Record<string, string>`. That is enough for publishing simple variables, but it cannot represent categories, light/dark values, shade/tint generation, transparent variants, or generated utility classes.

## Scope

In scope:

- Add a dedicated Colors panel in the left rail.
- Store color tokens in a structured framework color model.
- Create, rename, duplicate, delete, search, and filter colors.
- Create, rename, and delete color categories.
- Edit light and dark color values.
- Generate dark values by default, then allow manual editing.
- Generate Core Framework-style variables for base colors, transparency variants, shades, and tints.
- Generate locked utility classes from color variables.
- Show generated utilities in the existing class picker as assignable locked classes.
- Block generated utility class editing in the Properties panel.
- Emit `.theme-dark` / `.theme-light` scoped color variables.
- Keep runtime theme switching out of scope.

Out of scope:

- Typography, spacing, radius, shadow, layout, and other framework token families.
- Runtime UI for toggling a site between light and dark themes.
- Raw CSS editing in the Colors panel.
- Arbitrary custom selector generation beyond the defined utility types.
- A full usage browser for every generated utility class.

## Architecture

The implementation should split the work into two layers:

1. Shared generated class foundation.
2. Color framework token model and panel.

The shared foundation belongs in the class system so typography and future framework utilities can reuse it. It should not be implemented as color-specific checks inside the Colors panel.

Generated utility classes should be normal `CSSClass` records with metadata that marks them as locked and generated. Use this shape unless implementation discovers a concrete conflict with existing persistence:

```ts
interface CSSClass {
  id: string
  name: string
  styles: Partial<CSSPropertyBag>
  breakpointStyles: Record<string, Partial<CSSPropertyBag>>
  scope?: { type: 'node'; nodeId: string; role: 'module-style' }
  generated?: {
    origin: 'framework'
    family: 'color'
    sourceId: string
    utility: 'text' | 'background' | 'border' | 'fill'
    tokenName: string
    variantName?: string
    locked: true
  }
}
```

The model must support:

- Distinguishing user-authored classes from generated framework classes.
- Showing generated classes in pickers.
- Preventing direct style editing of generated classes.
- Rebuilding generated classes deterministically when token settings change.
- Reusing the same mechanism for typography utilities later.

Because generated framework utilities can include color-related properties that are not currently exposed in the user-editable class composer, the implementation should extend the safe `CSSPropertyBag` for those properties. `fill` is required for the color framework. User-authored class editing should stay limited to the existing supported controls unless the implementation intentionally broadens the controls.

## Color Data Model

Structured color settings should live under a framework namespace instead of extending the current flat `settings.colorTokens` record directly.

Representative shape:

```ts
interface FrameworkColorSettings {
  categories: FrameworkColorCategory[]
  tokens: FrameworkColorToken[]
}

interface FrameworkColorCategory {
  id: string
  name: string
  order: number
}

interface FrameworkColorToken {
  id: string
  categoryId: string | null
  slug: string
  lightValue: string
  darkValue: string
  darkModeEnabled: boolean
  generateUtilities: {
    text: boolean
    background: boolean
    border: boolean
    fill: boolean
  }
  generateTransparent: boolean
  generateShades: {
    enabled: boolean
    count: number
  }
  generateTints: {
    enabled: boolean
    count: number
  }
  order: number
  createdAt: number
  updatedAt: number
}
```

The current flat `settings.colorTokens` can remain for backwards compatibility and migration, but the Colors panel should edit the structured framework color model. Publisher/editor CSS generation should derive output variables from the structured model.

## Panel Placement

Add `Colors` as a dedicated left-rail panel alongside existing panels. It should follow the current docked panel conventions:

- Mount in `LeftSidebar`.
- Add a `PanelRail` item.
- Use shared `PanelHeader`.
- Participate in left sidebar width behavior.
- Use CSS modules only.
- Avoid inline styles, Tailwind classes, and `!important`.
- Keep the layout compact and consistent with the existing editor UI.

Use an existing color/style icon from the current icon catalog, preferably the same family as Selectors if appropriate. Do not introduce a new icon dependency.

## UI Layout

The panel uses the flat color-first structure selected during design:

1. Header
   - Title: `Colors`
   - Create color button.
   - Close button from `PanelHeader`.

2. Toolbar
   - Search input.
   - Compact category filter chips.
   - Category management affordance from a small menu or dialog.

3. Color list
   - Each color token appears as one row.
   - Rows show paired light/dark swatches when dark mode is enabled.
   - Rows show slug/name, category, and generated output summary.
   - Example summary: `Text · Bg · Border · 18 vars`.

4. Expanded color accordion
   - Opens inline from the selected row.
   - Uses compact controls similar to Properties panel sections.
   - Includes slug, category, light color, dark color, dark mode toggle, utility toggles, transparent variants toggle, shade count, tint count, and preview strips.

5. Empty states
   - No colors yet.
   - No search results.
   - No colors in selected category.

Color creation should default to the active category filter when one is selected.

## Color Editing

Each color has a light value and a dark value.

When dark mode is enabled for a color:

- The UI shows two swatches/inputs side by side.
- The light value remains the main/base value.
- The dark value is generated initially from the light value.
- The generated dark value is editable manually.

Invalid color input should not commit. The UI can use existing `ColorInput` and text input primitives, but should support HSLA strings because Core Framework-style output uses HSLA.

## Generated Variables

Variable names should mirror Core Framework color naming without the current `--color-` prefix:

- Base: `--primary`
- Transparent: `--primary-5`, `--primary-10`, ..., `--primary-90`
- Shades: `--primary-d-1`, `--primary-d-2`, ...
- Tints: `--primary-l-1`, `--primary-l-2`, ...

The generated variable set depends on the token settings:

- `generateTransparent` controls alpha variants.
- `generateShades.enabled` and `count` control darker variants.
- `generateTints.enabled` and `count` control lighter variants.

The output should preserve predictable ordering:

1. Base token.
2. Transparent variants.
3. Shades.
4. Tints.

## Theme Scopes

The feature should emit theme-scoped variables, but should not add theme switching UI.

Use `.theme-dark` and `.theme-light`, with no `cf-` prefix:

```css
html.theme-dark {
  color-scheme: dark;
}

:root,
:root.theme-dark .theme-inverted,
:root.theme-dark .theme-always-light,
:root.theme-light .theme-inverted .theme-always-light {
  --primary: hsla(...light...);
}

:root.theme-dark,
:root.theme-light .theme-inverted,
:root.theme-light .theme-always-dark,
:root.theme-dark .theme-inverted .theme-always-dark {
  --primary: hsla(...dark...);
}
```

Only colors with dark mode enabled need dark-scope overrides. Colors without dark mode enabled can emit the same value through the base scope only.

## Generated Utility Classes

The color generator should create locked utility classes from generated variables.

Utility types:

- Text: `.text-primary { color: var(--primary); }`
- Background: `.bg-primary { background-color: var(--primary); }`
- Border: `.border-primary { border-color: var(--primary); }`
- Fill: `.fill-primary { fill: var(--primary); }`

When variants are generated, utilities should be generated for those variants too when the utility type is enabled:

- `.bg-primary-20`
- `.text-primary-d-1`
- `.border-primary-l-2`

Generated classes must be available in `ClassPicker` and assignable to nodes. They should be visually marked as generated utilities or token utilities.

Generated classes must not be editable in `ClassComposer`. If a generated utility is opened in Properties, the panel should show a compact locked state explaining that the class is generated from framework tokens and can be changed from the Colors panel.

## Synchronization Rules

When a color token changes:

- Regenerate its variable declarations.
- Regenerate its utility classes.
- Preserve node assignments to generated class IDs when possible.
- Remove generated classes for variants or utility types that are no longer enabled.
- Do not remove or mutate normal user-authored classes.

Generated utility class IDs should stay stable for a given source token, variant, and utility type. Prefer deterministic IDs derived from those fields. If deterministic IDs conflict with existing class ID assumptions, maintain an explicit source map so changing a color value does not break existing node assignments.

When a color is deleted:

- Remove its generated variables.
- Remove its generated utility classes.
- Remove deleted generated class IDs from node assignments.
- Leave user-authored classes untouched.

When a color slug changes:

- Generated variable names and class names update.
- Existing assignments should remain valid through stable class IDs when possible.

## Migration

Sites with existing flat `settings.colorTokens` should be migrated into framework color tokens where safe.

Migration rules:

- `--color-primary` can become slug `primary`.
- `--primary` can become slug `primary`.
- Unknown custom properties can become uncategorized tokens if they are valid color values.
- Non-color variables should remain in the legacy flat token map or be ignored by the color framework migration.

The publisher should continue to handle sites without framework color settings.

## Accessibility

The panel should follow existing panel accessibility patterns:

- `role="complementary"` and `aria-label="Colors"`.
- Keyboard navigation for rows and accordions.
- `Enter` / `Space` opens or toggles a color row.
- `Escape` closes menus/dialogs.
- Inputs have explicit labels.
- Swatches have text inputs so color is not color-only information.
- Locked utility classes in Properties include clear text, not only a disabled state.

## Testing

Focused tests should cover:

- Color token CRUD and category filtering.
- Slug normalization and duplicate slug handling.
- Light/dark color editing and generated dark default.
- Transparent variant generation.
- Shade and tint generation counts.
- `.theme-dark` / `.theme-light` scoped CSS output.
- Generated utility class creation and removal.
- Generated utility class assignment through `ClassPicker`.
- Properties panel locked state for generated utility classes.
- Publisher output includes generated variables and utility CSS.
- Migration from flat `settings.colorTokens`.
- No inline styles, Tailwind class strings, or `!important` in new panel files.

## Acceptance Criteria

- The Colors panel appears in the left rail and follows existing panel styling.
- Users can create colors, assign categories, and edit light/dark values.
- Users can enable utilities, transparent variants, shades, and tints per color.
- Generated variables mirror Core Framework color naming.
- Theme scopes use `.theme-dark` and `.theme-light`, not `cf-*` class names.
- Generated utility classes appear in the class picker and can be assigned to nodes.
- Generated utility classes are locked from direct style editing in Properties.
- The safe `CSSPropertyBag` supports `fill` so generated fill utilities use the same class pipeline as other utilities.
- The locked/generated class metadata is reusable for typography utilities later.
- Published pages include the generated color variables and assigned utility class CSS.
