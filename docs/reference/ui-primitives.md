# UI Primitives

Cookbook for `src/ui/components/` — when to use each primitive, what its props mean, and the most common patterns.

Every interactive control in `src/admin/` goes through one of these. Bare `<button>` is banned (gated by `button-primitive-usage.test.ts`). Bare `<input>` / `<select>` / `<textarea>` in admin code should be replaced with the matching primitive.

---

## TL;DR

- Import from `@ui/components/<Name>` — each primitive lives in its own folder with `Component.tsx`, `Component.module.css`, and `index.ts`.
- The 30 primitives below cover every interactive control in the admin. If something's missing, add a new primitive (see "Adding a new primitive" below) — don't reach for a third-party library.
- Composition uses `cn` from `@ui/cn` — a 3-line in-house helper. **Never** `clsx` / `tailwind-merge` / `cva` / `@radix-ui/*` — gated by `no-tailwind-deps.test.ts`.
- All colors / radii come from CSS custom properties in `src/styles/globals.css` — see [docs/reference/design-tokens.md](design-tokens.md).
- Forbidden: Tailwind classes, hardcoded hex, inline `style` (except dynamic CSS custom properties), `!important`, native `title=` tooltips, native `alert()` / `confirm()`.

---

## Primitive catalog

### Action / interactive

| Primitive          | When to use                                                          | Key props                                                  |
|--------------------|----------------------------------------------------------------------|------------------------------------------------------------|
| `Button`           | **Every** action button                                              | `variant: 'ghost' \| 'secondary' \| 'primary' \| 'destructive'`, `size: 'micro' \| 'xs' \| 'sm' \| 'md' \| 'lg'`, `iconOnly`, `pressed`, `tooltip` |
| `Switch`           | Boolean toggle (on / off)                                            | `checked`, `onChange`, `disabled`                          |
| `Checkbox`         | Boolean inside a list / form                                         | `checked`, `onChange`, `indeterminate`                     |
| `SegmentedControl` | A few mutually exclusive options shown inline                        | `options`, `value`, `onChange`                             |
| `Tabs`             | Top-level tab navigation within a workspace                          | `tabs`, `activeId`, `onChange`                             |
| `RangeTabs`        | Tabbed numeric range selectors (spacing scales, etc.)                | `ranges`, `value`, `onChange`                              |

### Form controls

| Primitive          | When to use                                                          | Key props                                                  |
|--------------------|----------------------------------------------------------------------|------------------------------------------------------------|
| `Input`            | Single-line text input. Pill radius, transparent fill                | `value`, `onChange`, `placeholder`, `type`, `error`        |
| `Textarea`         | Multi-line text input (exported from same module as `Input`)         | `value`, `onChange`, `rows`                                |
| `Select`           | Dropdown selection of fixed options                                  | `options`, `value`, `onChange`                             |
| `ColorInput`       | Color picker — swatch + hex input                                    | `value`, `onChange`                                        |
| `DateTimePicker`   | Date / time inputs                                                   | `value`, `onChange`, `mode: 'date' \| 'datetime'`          |
| `FileUpload`       | Drop-zone + browse                                                   | `onSelect`, `accept`, `multiple`                           |
| `SearchBar`        | Search input with magnifier icon + clear affordance                  | `value`, `onChange`, `placeholder`                         |
| `FilterBar`        | Panel filter strip: filter chips + optional search bar + action slots | `items`, `value`, `onValueChange`, `search?`, `searchLeading?`, `searchTrailing?`, `inlineActions?`, `trailing?`, `groupLabel?` |

### Layout / structural

| Primitive          | When to use                                                          | Key props                                                  |
|--------------------|----------------------------------------------------------------------|------------------------------------------------------------|
| `Section`          | Titled section block inside a panel                                  | `title`, `description`, `actions`, `children`              |
| `ControlRow`       | Label + control row in property panels                               | `label`, `description`, `children`                         |
| `Separator`        | Visual divider between sections                                      | `orientation: 'horizontal' \| 'vertical'`                  |
| `Widget`           | Borderless tile card on a darker parent (the dashboard pattern)      | `tint`, `title`, `children`                                |
| `WidgetList`       | List of widgets (dashboard grid wrapper)                             |                                                            |
| `EmptyState`       | Empty list / page placeholder                                        | `icon`, `title`, `description`, `actions`                  |

### Overlay / feedback

| Primitive          | When to use                                                          | Key props                                                  |
|--------------------|----------------------------------------------------------------------|------------------------------------------------------------|
| `Dialog`           | Modal dialog with title + content                                    | `open`, `onClose`, `title`, `children`                     |
| `Tooltip`          | Hover hint — replaces `title=`                                       | `content`, `side: 'top' \| 'bottom' \| 'left' \| 'right' \| 'auto'`, `children` |
| `Toast`            | Transient confirmation / error notification                          | Used via `pushToast({ kind, title, body, location? })`     |
| `ContextMenu`      | Right-click and overflow (`…`) menus                                 | `ariaLabel`, `onClose`, `children`; `x`/`y` (point) or `anchorRef` (anchor) |
| `FloatingActionBar`| Multi-select bulk-action bar                                         | `selection`, `actions`                                     |
| `ErrorBoundary`    | Component-level error containment                                    | `location: string`, `resetKeys?`, `children`               |

### Data / display

| Primitive                  | When to use                                                  | Key props                                                |
|----------------------------|--------------------------------------------------------------|----------------------------------------------------------|
| `DataTable`                | Tabular data with sorting + selection                        | `columns`, `rows`, `selection`, `onSelect`               |
| `TagPill`                  | Compact tinted labels, selector chips, removable tag pills   | `label`, `active`, `muted`, `onClick`, `onRemove`        |
| `Image`                    | Image with built-in blurhash fallback                        | `src`, `blurhash`, `alt`, `width`, `height`              |
| `CanvasModulePlaceholder`  | Diagonal-stripe placeholder for empty modules on the canvas  | `label`                                                  |
| `Kbd`                      | Single keyboard keycap. Use anywhere a key name appears as a hint. | `children`, `className`                             |
| `ShortcutKeys`             | Full shortcut sequence ("⌘K", "Ctrl+Shift+P") — splits the label into individual `Kbd` spans. | `label`, `aria-hidden`, `className` |

### Loading / skeleton

Three named shapes cover nearly every loading region in the admin:

| Primitive       | When to use                                                                               | Key props                          |
|-----------------|-------------------------------------------------------------------------------------------|------------------------------------|
| `SkeletonBlock` | A single three-bar (title / sub / fill) block. For confined surfaces: widget body, dialog body, inline slot. | `minHeight?`, `className?`, `ariaLabel?` |
| `SkeletonCards` | Stack of N card-shaped containers, each with a three-bar block. For full-page loads and card lists (Plugins, Users, Posts pages). `<AdminPageLayout loading>` renders this automatically. | `count?` (default 3), `className?`, `ariaLabel?` |
| `SkeletonRows`  | Stack of N thin shimmer rows. For list-style sidebars (Data tables, Content collections), table rows, and compact item lists. | `count?` (default 6), `rowHeight?` (default 24), `className?`, `ariaLabel?` |

Low-level escape hatches (use only when the three named shapes don't fit):

| Primitive       | When to use                                                  | Key props                                    |
|-----------------|--------------------------------------------------------------|----------------------------------------------|
| `Skeleton`      | A single shimmer bar with configurable width, height, radius | `width?`, `height?`, `radius?`, `className?`, `ariaLabel?` |
| `SkeletonText`  | N stacked text lines, last line narrower (paragraph shape)   | `lines?` (default 3), `lineHeight?`, `className?` |
| `SkeletonCircle`| Circular skeleton — avatars, status dots, round thumbnails   | `size` (px diameter), `className?`           |

### Charts (`@ui/components/charts`)

A small chart kit used by dashboard widgets and the framework scale UI. Strictly achromatic by default; consumer provides a `tint`.

| Component   | What it draws                          |
|-------------|----------------------------------------|
| `Bars`      | Horizontal / vertical bar chart        |
| `Sparkline` | Inline sparkline                       |
| `StackedBar`| Stacked horizontal segments (storage breakdown) |

---

## `Skeleton` — loading states

All six exports live at `@ui/components/Skeleton`. The shimmer uses `--editor-surface-3` / `--editor-surface-4` tokens directly, so it respects the editor palette automatically.

```tsx
import { SkeletonBlock, SkeletonCards, SkeletonRows, Skeleton } from '@ui/components/Skeleton'

// Full-page list of cards loading — use SkeletonCards
<SkeletonCards count={4} />

// Single card / widget body loading — use SkeletonBlock
<SkeletonBlock minHeight={120} />

// Sidebar list loading — use SkeletonRows
<SkeletonRows count={8} rowHeight={24} />

// Bespoke bar (escape hatch) — use Skeleton
<Skeleton width="60%" height={14} />
```

**Picking the right shape:**

| Surface type                                     | Use                |
|--------------------------------------------------|--------------------|
| Full-page card list (Plugins, Users, Posts)      | `SkeletonCards`    |
| Single confined region (widget body, dialog)     | `SkeletonBlock`    |
| Sidebar list, table rows, compact item list      | `SkeletonRows`     |
| One-off bar that doesn't fit any of the above    | `Skeleton`         |
| Paragraph of text                                | `SkeletonText`     |
| Avatar / round image placeholder                 | `SkeletonCircle`   |

**Accessibility:** The three named shapes forward `ariaLabel` → `aria-label` + `role="status"` on the wrapper. The underlying `<Skeleton>` span is `aria-hidden` by default (pure visual chrome). The **surrounding host** (`Widget`, `Dialog`, `AdminPageLayout`) is responsible for setting `aria-busy="true"` — don't duplicate that on the skeleton itself.

**`AdminPageLayout loading` prop:** When the page-level layout receives `loading={true}`, it renders `<SkeletonCards>` automatically. Don't add a skeleton below `AdminPageLayout` for full-page loads.

---

## `Button` deep-dive

Every action button. Replaces the 33+ one-off button classes that used to live in admin CSS. Mandatory `variant`, sane size default, full ARIA / tooltip / focus support.

```tsx
import { Button } from '@ui/components/Button'

<Button variant="primary" onClick={onPublish}>Publish</Button>
<Button variant="ghost" iconOnly aria-label="Close"><CloseIcon /></Button>
<Button variant="secondary" size="md" pressed={isActive} tooltip="Toggle preview">
  <PreviewIcon /> Preview
</Button>
<Button variant="destructive" onClick={onDelete}>Delete</Button>
```

### Variants

| Variant       | Use for                                                              |
|---------------|----------------------------------------------------------------------|
| `primary`     | The dominant action on the screen (Publish, Save, Confirm)           |
| `secondary`   | Same-tier alternative (Cancel, Discard)                              |
| `ghost`       | Toolbar buttons, list-row actions, low-emphasis controls             |
| `destructive` | Delete, Remove, Revoke (irreversible-feeling actions)                |

### Sizes

| Size    | Height | Use for                                                            |
|---------|--------|--------------------------------------------------------------------|
| `micro` | 18px   | Inline chips                                                       |
| `xs`    | 26px   | Property panel rows                                                |
| `sm`    | 28px   | **Default** — toolbar, dialogs                                     |
| `md`    | 32px   | Primary CTAs in modals                                             |
| `lg`    | 44px   | Touch targets, mobile                                              |

### Flags

| Flag          | Effect                                                              |
|---------------|---------------------------------------------------------------------|
| `iconOnly`    | Square button. **Requires `aria-label`.**                           |
| `pressed`     | Toolbar-toggle state — sets `aria-pressed` + active background      |
| `active`      | Active state for nav items                                          |
| `fullWidth`   | Stretches to container width                                        |
| `menuItem`    | Style override for dropdown menu rows                               |
| `navItem`     | Style override for top-level nav items                              |
| `dangerHover` | Ghost buttons only: hover brightens the foreground without adding a background box — use for inline remove/close controls on tinted chips where a colored background would clash with the chip tint |
| `tooltip`     | Wraps with `Tooltip` — works even when disabled                     |

`type="button"` is the default — Button never accidentally submits a form. Pass `type="submit"` explicitly when needed.

---

## `Input` and `Textarea`

Bordered transparent inputs with a pill radius (`--input-radius`). Focus adds an inset achromatic glow (`--input-shadow-focus`).

```tsx
import { Input, Textarea } from '@ui/components/Input'

<Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Page title" />
<Input type="number" value={price} onChange={...} numeric />
<Input value={email} type="email" error={emailError} aria-invalid={Boolean(emailError)} />

<Textarea value={body} onChange={...} rows={6} />
```

Standard `<input>` props pass through. Notable additions:

- `error` — when truthy, applies the danger border + sets `aria-invalid`.
- `prefix` / `suffix` — render an icon or unit inline (e.g. `px`, `$`).

---

## `Switch`

```tsx
import { Switch } from '@ui/components/Switch'

<Switch checked={autoSave} onChange={setAutoSave} />
<Switch checked={...} disabled />
```

Renders an accessible toggle that announces its state. **Always** pair with a visible label (use `<ControlRow label="..."><Switch ... /></ControlRow>` or a sibling `<label>` with `htmlFor`).

---

## `Select`

```tsx
import { Select } from '@ui/components/Select'

<Select
  value={size}
  onChange={setSize}
  options={[
    { value: '', label: 'Choose size', placeholder: true },
    { value: 'sm', label: 'Small' },
    { value: 'md', label: 'Medium' },
    { value: 'lg', label: 'Large' },
  ]}
/>
```

Use `placeholder: true` for an empty/default option that should stay selectable but read
as placeholder text in the open menu. When the `Select` itself has a non-empty
`placeholder`, its empty-value option is treated this way automatically.

For long lists or async options, use `SearchBar` + a custom dropdown built with `ContextMenu`. `Select` is for short fixed lists.

---

## `TagPill`

Compact tinted labels and removable chips. The accent comes from the first meaningful alphanumeric character of `colorKey` or `label`, so `.hero`, `#hero`, and `hero` share a tint. Each Latin letter has its own token-backed tint; digits use their own stable slots.

```tsx
import { TagPill } from '@ui/components/TagPill'

<TagPill label="div" size="xs" monospace />
<TagPill label=".hero" active onClick={editClass} onRemove={removeClass} />
<TagPill label="Owner account" muted />
```

Use `active` for selected/editing chips, `muted` when the label is informational rather than identity-colored, and `onRemove` for the inline close button. The remove action uses the shared `Button` primitive internally.

---

## `Dialog`

```tsx
import { Dialog } from '@ui/components/Dialog'

<Dialog open={open} onClose={onClose} title="Delete page?">
  <p>Are you sure? This can't be undone.</p>
  <Dialog.Actions>
    <Button variant="ghost" onClick={onClose}>Cancel</Button>
    <Button variant="destructive" onClick={onConfirm}>Delete</Button>
  </Dialog.Actions>
</Dialog>
```

`Dialog` traps focus, restores it on close, escape-closes, click-outside-closes (configurable). Modal by default. Replaces native `alert()` / `confirm()` (which are banned by `no-native-browser-dialogs.test.ts`).

---

## `Tooltip`

```tsx
import { Tooltip } from '@ui/components/Tooltip'

<Tooltip content="Toggle preview mode">
  <Button variant="ghost" iconOnly aria-label="Preview"><PreviewIcon /></Button>
</Tooltip>
```

Replaces native `title="..."` (gated by `no-native-title-tooltips.test.ts`). Works on disabled buttons because `mouseenter` fires on disabled `<button>` elements.

`Button` accepts a `tooltip` prop and wraps itself — prefer that over composing `<Tooltip><Button .../></Tooltip>` for buttons.

`CursorTooltip` lives in the same module for canvas/editor chrome that must follow a pointer coordinate instead of anchoring to a trigger element.

---

## `Toast`

```tsx
// 1. Mount once in your app root
<ToastProvider />

// 2. Push from anywhere
import { pushToast } from '@ui/components/Toast'

pushToast({
  kind: 'success',           // 'success' | 'error' | 'info' | 'warning'
  title: 'Page published',
  body: 'Live at /about',
  location: 'toolbar',       // optional source tag for logs
})
```

Toasts auto-dismiss after a few seconds. Errors stay longer. Each kind picks the matching semantic token (`--editor-success-*`, `--editor-danger-*`, etc.).

For inline page-level errors, prefer `role="alert"` content over a toast — toasts are for **transient** feedback.

---

## `ContextMenu`

Two positioning modes:

**Point mode** — right-click at a viewport coordinate. Pass `animateExit` so the menu fades out before the caller unmounts it:

```tsx
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@ui/components/ContextMenu'

{menu && (
  <ContextMenu
    x={menu.x}
    y={menu.y}
    ariaLabel="Layer actions"
    animateExit
    onClose={() => setMenu(null)}
  >
    <ContextMenuItem onClick={onRename}>Rename</ContextMenuItem>
    <ContextMenuItem onClick={onDuplicate}>Duplicate</ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem danger onClick={onDelete}>Delete</ContextMenuItem>
  </ContextMenu>
)}
```

**Anchor mode** — overflow `…` button that opens a dropdown below its trigger. Skip `animateExit` for instant close (the default):

```tsx
const triggerRef = useRef<HTMLButtonElement>(null)

<Button ref={triggerRef} onClick={() => setOpen(true)}>…</Button>
{open && (
  <ContextMenu
    anchorRef={triggerRef}
    ariaLabel="Row actions"
    onClose={() => setOpen(false)}
  >
    <ContextMenuItem onClick={onEdit}>Edit</ContextMenuItem>
    <ContextMenuItem danger onClick={onDelete}>Delete</ContextMenuItem>
  </ContextMenu>
)}
```

**Exit animation (`animateExit`).** When `true`, a Dismiss (Escape / outside-click) plays a brief `data-closing` fade-out keyframe before `onClose` unmounts the menu. Item-selection always closes instantly regardless. Reopening the menu at a new coordinate cancels any in-flight exit. Default `false` keeps the instant close that anchored dropdowns (Select, combobox) rely on. Use `animateExit` for all point-anchored right-click context menus.

**Dismiss handling.** Outside `mousedown` and `contextmenu` events (capture phase) dismiss the menu without cancelling the underlying event — the first outside click both closes the menu and reaches the clicked element. Dismiss listeners attach to the parent document **and every same-origin iframe document** (`collectSameOriginDocuments` in `src/ui/lib/sameOriginDocuments.ts`), so clicking inside the canvas's per-breakpoint iframes correctly dismisses open menus. `anchorRef` gates dismiss handling (clicks inside the anchor element don't close the menu) and provides the rect for auto-flip positioning. `triggerRef` is dismiss-gate only — use it when the trigger is an editable input that must stay focused while the menu is open (e.g. `ClassPicker`). Items use `ContextMenuItem`, separators use `ContextMenuSeparator`, and nested menus use `ContextMenuSubmenu`.

**Submenus (`ContextMenuSubmenu`).** Opens a positioned flyout to the right of the trigger row (flips left when it doesn't fit). Hover or `ArrowRight` opens; `ArrowLeft` / `Escape` closes the submenu only (not the parent). Clicking a submenu item calls `onClose` to close the parent menu:

```tsx
import { ContextMenu, ContextMenuItem, ContextMenuSubmenu } from '@ui/components/ContextMenu'
import { PlusIcon } from 'pixel-art-icons/icons/plus'

<ContextMenu x={menu.x} y={menu.y} ariaLabel="Insert" animateExit onClose={close}>
  <ContextMenuSubmenu label="Insert here" icon={<PlusIcon size={12} />} onClose={close}>
    <ContextMenuItem onClick={onInsertText}>Text block</ContextMenuItem>
    <ContextMenuItem onClick={onInsertImage}>Image</ContextMenuItem>
  </ContextMenuSubmenu>
  <ContextMenuItem danger onClick={onDelete}>Delete</ContextMenuItem>
</ContextMenu>
```

For searchable submenus that host a non-menuitem widget (e.g. a search input), pass `closeOnItemClickOnly` so only actual `[role="menuitem"]` clicks close the panel — clicking the input doesn't dismiss it.

---

## `Section`, `ControlRow`

Layout primitives for property panels.

```tsx
import { Section } from '@ui/components/Section'
import { ControlRow } from '@ui/components/ControlRow'

<Section title="Spacing" description="Margin and padding for this node">
  <ControlRow label="Margin top">
    <Input value={mt} onChange={setMt} suffix="px" />
  </ControlRow>
  <ControlRow label="Margin bottom">
    <Input value={mb} onChange={setMb} suffix="px" />
  </ControlRow>
</Section>
```

---

## `Widget`

The borderless tile-card pattern used by the dashboard. Borderless on a darker parent surface with a 1px grid gap.

```tsx
import { Widget } from '@ui/components/Widget'

<Widget tint="mint" title="VISITORS">
  <div>2 unique</div>
  <Sparkline data={...} tint="mint" />
</Widget>
```

| `tint`    | Color           | Typical category                        |
|-----------|-----------------|-----------------------------------------|
| `mint`    | `#8ee6c8`       | "Saved / system / status"                |
| `lilac`   | `#c8b6ff`       | "Pages / structure"                     |
| `sky`     | `#9bdcff`       | "Storage / data / configuration"        |
| `peach`   | `#ffc7a8`       | "Posts / media / activity"              |

`Widget` is the **canonical implementation** of the tile-card pattern — see [docs/design.md](../design.md). Build any equivalent tile by reusing `Widget`, not by recreating the pattern.

---

## `Kbd` and `ShortcutKeys`

Single keycap and full shortcut-sequence primitives. The one canonical keycap style across the admin — used by the Spotlight footer, module inserter legend, and keybindings help screen.

```tsx
import { Kbd, ShortcutKeys } from '@ui/components/Kbd'

// Single keycap
<Kbd>⌘</Kbd>
<Kbd>esc</Kbd>

// Full shortcut — splits "⌘K" into [⌘][K], "Ctrl+Shift+P" into [Ctrl][Shift][P]
<ShortcutKeys label="⌘K" />
<ShortcutKeys label="Ctrl+Shift+P" />
```

`ShortcutKeys` is marked `aria-hidden="true"` by default because the surrounding element usually labels the action. Pass `aria-hidden={false}` (or `"false"`) when there is no other label.

`splitShortcut` is also exported for cases where you only need the token array:

```ts
import { splitShortcut } from '@ui/components/Kbd'
splitShortcut('⌘⇧P') // → ['⌘', '⇧', 'P']
```

---

## `Tree*` (canvas / DOM panel rows)

Tree rows live in `src/admin/pages/site/ui/Tree/`, not in `src/ui/components/`. They're admin-specific (DOM panel, site explorer, layers panel).

```tsx
import { TreeContainer, TreeRow, TreeChevron, TreeIconSlot, TreeLabel } from '@site/ui/Tree'
```

Use these for any hierarchical row list. The DOM panel and Site Explorer both rely on this contract for tree semantics, drag/drop row affordances, depth indentation, chevrons, selection highlight (`--canvas-selection-ring`), and density (`data-editor-density='comfortable'`).

---

## Composition: `cn`

```ts
import { cn } from '@ui/cn'

<button className={cn(styles.btn, isActive && styles.active, props.className)} />
```

`cn` accepts strings, falsy values, and arrays. Returns a single string. 3 lines of source. **Do not** add `clsx`, `tailwind-merge`, `class-variance-authority`, or `@radix-ui/*`.

---

## Dynamic CSS via custom properties

The only legitimate use of inline `style` is **dynamic CSS custom properties** the static CSS Module reads back:

```tsx
<div
  className={styles.surface}
  style={{ '--surface-min-h': `${minHeight}px` } as CSSProperties}
/>
```

```css
.surface {
  min-height: var(--surface-min-h);
}
```

Use this when the value is genuinely runtime (resize handle drag, computed bbox, user input). Don't use it as a Tailwind escape hatch.

---

## Adding a new primitive

1. Create `src/ui/components/<Name>/<Name>.tsx`, `<Name>.module.css`, `index.ts`.
2. Re-export from `src/ui/components/index.ts` so consumers import from `@ui/components`.
3. CSS uses tokens from `src/styles/globals.css` — never hardcoded colors.
4. Composition uses `cn` from `@ui/cn`.
5. Icons come from `pixel-art-icons/icons/<name>` (deep-imported).
6. If it replaces a bare HTML control (`<button>` etc.), update the matching architecture test (e.g. `button-primitive-usage.test.ts`).
7. Add a row to the table above in this doc.
8. Add a one-line entry to [docs/design.md](../design.md) "Components" table.

The primitive must work entirely with existing design tokens. If you need a new token, add it to `globals.css` first and update [docs/reference/design-tokens.md](design-tokens.md).

---

## Forbidden patterns

| Pattern                                          | Use instead                                  |
|--------------------------------------------------|----------------------------------------------|
| `<button>` in admin code                         | `<Button variant="...">`                     |
| `react-loading-skeleton` / `<Skeleton>` from a third-party package | `Skeleton*` from `@ui/components/Skeleton` — the local primitive owns the shimmer animation |
| `<input className="...">`                        | `<Input>`                                    |
| `<input type="checkbox">`                        | `<Checkbox>` or `<Switch>`                   |
| `<select>`                                       | `<Select>`                                   |
| Native `alert('...')` / `confirm('...')`         | `<Dialog>` or `pushToast({ kind: 'error' })` |
| `title="..."` for a hover hint                   | `<Tooltip>` or Button's `tooltip` prop       |
| `lucide-react`, `heroicons`, inline SVG strings  | `pixel-art-icons/icons/<name>`               |
| `clsx`, `tailwind-merge`, `cva`, `@radix-ui/*`   | `cn` from `@ui/cn`                           |
| `style={{ color: 'white' }}`                     | CSS Module class                             |
| `style={{ '--x': value }}` for static values     | Use a CSS Module class — `--x` is for runtime-only values |
| Recreating the tile-card look manually           | `<Widget tint="...">`                        |
| Building tree rows from scratch                  | `Tree*` from `@site/ui/Tree`                 |

---

## Related

- [docs/design.md](../design.md) — design principles, surface systems, design rules
- [docs/reference/design-tokens.md](design-tokens.md) — complete token catalog
- [docs/architecture.md](../architecture.md) — primitive layer in the system
- [docs/features/canvas-iframe-per-frame.md](../features/canvas-iframe-per-frame.md) — cross-realm iframe dismiss (why `ContextMenu` attaches to iframe documents)
- Source-of-truth files:
  - `src/ui/components/` — all primitive folders
  - `src/ui/cn.ts` — class composition helper
  - `src/styles/globals.css` — all design tokens
  - `src/ui/components/Widget/Widget.module.css` — canonical tile-card implementation
  - `src/ui/components/Button/Button.module.css` — canonical button (with `!important` exception)
  - `src/ui/lib/sameOriginDocuments.ts` — `collectSameOriginDocuments`, `isNode`
  - `src/ui/components/ContextMenu/useDeferredClose.ts` — exit-animation deferred close hook
  - `src/ui/components/ContextMenu/useAnchorPosition.ts` — anchor-based auto-flip positioning hook
  - `src/ui/components/ContextMenu/usePointPosition.ts` — point-anchored viewport-fit positioning hook
- Gate tests:
  - `src/__tests__/architecture/button-primitive-usage.test.ts`
  - `src/__tests__/architecture/ui-primitives-location.test.ts`
  - `src/__tests__/architecture/no-native-browser-dialogs.test.ts`
  - `src/__tests__/architecture/no-native-title-tooltips.test.ts`
  - `src/__tests__/architecture/no-third-party-icons.test.ts`
  - `src/__tests__/architecture/direct-icon-imports.test.ts`
  - `src/__tests__/architecture/no-tailwind-deps.test.ts`
  - `src/__tests__/architecture/noTailwindUtilities.test.ts`
  - `src/__tests__/architecture/css-token-policy.test.ts`
