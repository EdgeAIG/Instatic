import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { useEditorStore } from "@core/editor-store/store";
import type {
  FrameworkColorToken,
  FrameworkColorUtilityType,
} from '@core/framework/schemas'
import {
  generateFrameworkColorVariableSets,
  normalizeFrameworkColorSlug,
} from "@core/framework/colors";
import { Button } from "@ui/components/Button";
import { ColorInput } from "@ui/components/ColorInput";
import { EmptyState } from "@ui/components/EmptyState";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@ui/components/ContextMenu";
import { FilterBar, type FilterBarItem } from "@ui/components/FilterBar";
import { Input } from "@ui/components/Input";
import { Switch } from "@ui/components/Switch";
import { ChevronDownIcon } from "pixel-art-icons/icons/chevron-down";
import { ChevronUpIcon } from "pixel-art-icons/icons/chevron-up";
import { CloseIcon } from "pixel-art-icons/icons/close";
import { Copy2SharpIcon } from "pixel-art-icons/icons/copy-2-sharp";
import { DeleteIcon } from "pixel-art-icons/icons/delete";
import { FilePlusIcon } from "pixel-art-icons/icons/file-plus";
import { MinusIcon } from "pixel-art-icons/icons/minus";
import { PlusIcon } from "pixel-art-icons/icons/plus";
import { TokenizedColorField } from "../PropertyControls/TokenizedColorField";
import { PanelHeader } from "../shared/PanelHeader";
import { useFrameworkChangeConfirm } from "../shared/FrameworkChangeConfirmDialog";
import dialogStyles from "../SiteCreateDialog/SiteCreateDialog.module.css";
import styles from "./ColorsPanel.module.css";

interface ColorsPanelProps {
  variant?: "docked";
}

const EMPTY_COLORS = { tokens: [] };
const UTILITY_OPTIONS: Array<{
  key: FrameworkColorUtilityType;
  label: string;
}> = [
  { key: "text", label: "Text utility" },
  { key: "background", label: "Background utility" },
  { key: "border", label: "Border utility" },
  { key: "fill", label: "Fill utility" },
];

type ColorTokenPatch = Parameters<
  ReturnType<typeof useEditorStore.getState>["updateFrameworkColorToken"]
>[1];
type ColorPreviewVariable = ReturnType<
  typeof generateFrameworkColorVariableSets
>["light"][number];

interface TokenContextMenuState {
  x: number;
  y: number;
  tokenId: string;
}

/**
 * Categories are derived from the tokens themselves — there is no separate
 * registry. The unique set of non-empty `token.category` values, sorted
 * alphabetically (case-insensitive), forms the filter bar and autocomplete
 * suggestions. When no token references a category label, it ceases to exist.
 */
/**
 * Apply a token patch to a draft site for the *preview* path. Mirrors the
 * field-level effect that `applyFrameworkColorTokenPatch` has in the slice
 * for everything that changes class generation (utilities, transparent,
 * shades, tints, slug). Side-effect-free fields (color values, category,
 * darkValue, order) are intentionally left out — they don't affect which
 * classes the framework will generate, so the preview can skip them.
 */
function applyColorTokenPatchPreview(
  draft: import('@core/page-tree/schemas').SiteDocument,
  tokenId: string,
  patch: ColorTokenPatch,
): void {
  const token = draft.settings.framework?.colors?.tokens.find(
    (t) => t.id === tokenId,
  );
  if (!token) return;
  if (patch.slug !== undefined) token.slug = patch.slug;
  if (patch.generateUtilities) {
    token.generateUtilities = {
      ...token.generateUtilities,
      ...patch.generateUtilities,
    };
  }
  if (patch.generateTransparent !== undefined) {
    token.generateTransparent = patch.generateTransparent;
  }
  if (patch.generateShades) {
    token.generateShades = { ...token.generateShades, ...patch.generateShades };
  }
  if (patch.generateTints) {
    token.generateTints = { ...token.generateTints, ...patch.generateTints };
  }
}

/**
 * Pick a short, human-readable action label for the confirmation dialog,
 * given a color-token patch. Falls back to a generic label when the patch
 * doesn't match a known destructive shape.
 */
function deriveColorPatchActionLabel(
  patch: ColorTokenPatch,
  token: FrameworkColorToken,
): string {
  if (patch.generateTints?.enabled === false) return `Disable "${token.slug}" tints`;
  if (patch.generateShades?.enabled === false) return `Disable "${token.slug}" shades`;
  if (patch.generateTransparent === false) {
    return `Disable "${token.slug}" transparent steps`;
  }
  if (patch.generateTints?.count !== undefined) return `Update "${token.slug}" tint count`;
  if (patch.generateShades?.count !== undefined) return `Update "${token.slug}" shade count`;
  if (patch.generateUtilities) {
    const disabled = (Object.entries(patch.generateUtilities) as Array<
      [FrameworkColorUtilityType, boolean | undefined]
    >)
      .filter(([, v]) => v === false)
      .map(([k]) => k);
    if (disabled.length === 1) return `Disable "${token.slug}" ${disabled[0]} utility`;
    if (disabled.length > 1) return `Disable "${token.slug}" utilities`;
  }
  if (patch.slug !== undefined) return `Rename token to "${patch.slug}"`;
  return `Update token "${token.slug}"`;
}

function deriveCategoryLabels(tokens: FrameworkColorToken[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of tokens) {
    const label = token.category.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  return result.sort((a, b) => a.localeCompare(b));
}

export function ColorsPanel({ variant = "docked" }: ColorsPanelProps) {
  const isOpen = useEditorStore((s) => s.colorsPanelOpen);
  const site = useEditorStore((s) => s.site);
  const setColorsPanelOpen = useEditorStore((s) => s.setColorsPanelOpen);
  const createFrameworkColorToken = useEditorStore(
    (s) => s.createFrameworkColorToken,
  );
  const updateFrameworkColorToken = useEditorStore(
    (s) => s.updateFrameworkColorToken,
  );
  const duplicateFrameworkColorToken = useEditorStore(
    (s) => s.duplicateFrameworkColorToken,
  );
  const reorderFrameworkColorToken = useEditorStore(
    (s) => s.reorderFrameworkColorToken,
  );
  const deleteFrameworkColorToken = useEditorStore(
    (s) => s.deleteFrameworkColorToken,
  );
  const confirmFrameworkChange = useFrameworkChangeConfirm();

  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [expandedTokenId, setExpandedTokenId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<TokenContextMenuState | null>(
    null,
  );

  const colors = site?.settings.framework?.colors ?? EMPTY_COLORS;
  const categories = useMemo(
    () => deriveCategoryLabels(colors.tokens),
    [colors.tokens],
  );
  const filteredTokens = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return colors.tokens
      .filter(
        (token) => activeCategory === null || token.category === activeCategory,
      )
      .filter(
        (token) =>
          !normalizedQuery ||
          token.slug.toLowerCase().includes(normalizedQuery),
      )
      .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  }, [activeCategory, colors.tokens, query]);
  const contextToken = contextMenu
    ? (colors.tokens.find((token) => token.id === contextMenu.tokenId) ?? null)
    : null;

  // Drop the active category filter the moment its last token is removed —
  // categories live solely on tokens, so a filter for a vanished label would
  // permanently hide every row.
  if (activeCategory !== null && !categories.includes(activeCategory)) {
    setActiveCategory(null);
  }

  if (!isOpen || variant !== "docked") return null;

  function handleCreate(name: string, lightValue: string, category: string) {
    const token = createFrameworkColorToken({
      slug: name,
      lightValue,
      category,
      darkModeEnabled: false,
    });
    setExpandedTokenId(token.id);
    setCreateDialogOpen(false);
  }

  function openTokenContextMenu(
    tokenId: string,
    event: MouseEvent<HTMLElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, tokenId });
  }

  function handleDuplicateToken(token: FrameworkColorToken) {
    const copy = duplicateFrameworkColorToken(token.id);
    if (copy) setExpandedTokenId(copy.id);
    setContextMenu(null);
  }

  function handleMoveToken(
    token: FrameworkColorToken,
    direction: "up" | "down",
  ) {
    reorderFrameworkColorToken(token.id, direction);
    setContextMenu(null);
  }

  function handleDeleteToken(token: FrameworkColorToken) {
    setContextMenu(null);
    confirmFrameworkChange({
      actionLabel: `Delete token "${token.slug}"`,
      applyChange: (draft) => {
        const colors = draft.settings.framework?.colors;
        if (!colors) return;
        colors.tokens = colors.tokens.filter((t) => t.id !== token.id);
      },
      commit: () => {
        deleteFrameworkColorToken(token.id);
        if (expandedTokenId === token.id) setExpandedTokenId(null);
      },
    });
  }

  function handlePatchToken(token: FrameworkColorToken, patch: ColorTokenPatch) {
    confirmFrameworkChange({
      actionLabel: deriveColorPatchActionLabel(patch, token),
      applyChange: (draft) => applyColorTokenPatchPreview(draft, token.id, patch),
      commit: () => updateFrameworkColorToken(token.id, patch),
    });
  }

  return (
    <>
      <aside
        role="complementary"
        aria-label="Colors"
        data-panel=""
        data-testid="colors-panel"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={styles.panel}
      >
        <PanelHeader
          panelId="colors"
          title="Colors"
          onClose={() => setColorsPanelOpen(false)}
        >
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            aria-label="Create color"
            tooltip="Create color"
            onClick={() => setCreateDialogOpen(true)}
          >
            <FilePlusIcon size={13} aria-hidden="true" />
          </Button>
        </PanelHeader>

        <div className={styles.content}>
          <FilterBar<string | null>
            items={[
              { value: null, label: "All" },
              ...categories.map<FilterBarItem<string | null>>((category) => ({
                value: category,
                label: category,
              })),
            ]}
            value={activeCategory}
            onValueChange={setActiveCategory}
            search={{
              value: query,
              onValueChange: setQuery,
              onClear: () => setQuery(""),
              placeholder: "Search colors",
              ariaLabel: "Search colors",
            }}
            groupLabel="Color categories"
          />

          {colors.tokens.length === 0 ? (
            <EmptyState
              title="No colors yet."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCreateDialogOpen(true)}
                >
                  Create color
                </Button>
              }
            />
          ) : filteredTokens.length === 0 ? (
            <EmptyState title="No colors match the current filters." />
          ) : (
            <div className={styles.rows}>
              {filteredTokens.map((token) => (
                <ColorTokenCard
                  key={token.id}
                  token={token}
                  categories={categories}
                  expanded={expandedTokenId === token.id}
                  onToggle={() =>
                    setExpandedTokenId(
                      expandedTokenId === token.id ? null : token.id,
                    )
                  }
                  onPatch={(patch) => handlePatchToken(token, patch)}
                  onContextMenu={(event) =>
                    openTokenContextMenu(token.id, event)
                  }
                />
              ))}
            </div>
          )}
        </div>
      </aside>

      {createDialogOpen && (
        <CreateColorDialog
          categories={categories}
          defaultCategory={activeCategory ?? ""}
          onCancel={() => setCreateDialogOpen(false)}
          onSubmit={handleCreate}
        />
      )}
      {contextMenu && contextToken && (
        <ColorTokenContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          canMoveUp={canMoveToken(colors.tokens, contextToken, "up")}
          canMoveDown={canMoveToken(colors.tokens, contextToken, "down")}
          onClose={() => setContextMenu(null)}
          onDuplicate={() => handleDuplicateToken(contextToken)}
          onMoveUp={() => handleMoveToken(contextToken, "up")}
          onMoveDown={() => handleMoveToken(contextToken, "down")}
          onDelete={() => handleDeleteToken(contextToken)}
        />
      )}
    </>
  );
}

function ColorTokenCard({
  token,
  categories,
  expanded,
  onToggle,
  onPatch,
  onContextMenu,
}: {
  token: FrameworkColorToken;
  categories: string[];
  expanded: boolean;
  onToggle: () => void;
  onPatch: (patch: ColorTokenPatch) => void;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
}) {
  return (
    <div className={styles.card}>
      <div className={styles.row} onContextMenu={onContextMenu}>
        <span className={styles.swatches}>
          <ColorInput
            value={token.lightValue}
            swatchValue={token.lightValue}
            fieldSize="xs"
            aria-label={`Default color swatch ${token.slug}`}
            onChange={(event) => onPatch({ lightValue: event.target.value })}
          />
          {token.darkModeEnabled && (
            <ColorInput
              value={token.darkValue}
              swatchValue={token.darkValue}
              fieldSize="xs"
              aria-label={`Alternate color swatch ${token.slug}`}
              onChange={(event) =>
                onPatch({
                  darkValue: event.target.value,
                  darkModeEnabled: true,
                })
              }
            />
          )}
        </span>
        <button
          type="button"
          className={styles.rowToggle}
          aria-expanded={expanded}
          aria-label={`Edit color ${token.slug}`}
          onClick={onToggle}
          onContextMenu={onContextMenu}
        >
          <span className={styles.rowText}>
            <span className={styles.rowTitle}>--{token.slug}</span>
            <span className={styles.rowMeta}>
              {token.category.trim() || "Uncategorized"}
            </span>
          </span>
        </button>
      </div>

      {expanded && (
        <ColorTokenEditor
          token={token}
          categories={categories}
          onPatch={onPatch}
        />
      )}
    </div>
  );
}

function ColorTokenEditor({
  token,
  categories,
  onPatch,
}: {
  token: FrameworkColorToken;
  categories: string[];
  onPatch: (patch: ColorTokenPatch) => void;
}) {
  const [slug, setSlug] = useState(token.slug);
  const [lightValue, setLightValue] = useState(token.lightValue);
  const [alternateValue, setAlternateValue] = useState(
    token.darkModeEnabled ? token.darkValue : "",
  );
  const [category, setCategory] = useState(token.category);
  const [shadeCount, setShadeCount] = useState(
    String(token.generateShades.count),
  );
  const [tintCount, setTintCount] = useState(String(token.generateTints.count));
  const previewToken = useMemo<FrameworkColorToken>(
    () => ({
      ...token,
      lightValue: lightValue.trim() || token.lightValue,
      darkValue: alternateValue.trim() || token.darkValue,
      darkModeEnabled: alternateValue.trim().length > 0,
      generateShades: {
        ...token.generateShades,
        count: clampVariantCountInput(shadeCount),
      },
      generateTints: {
        ...token.generateTints,
        count: clampVariantCountInput(tintCount),
      },
    }),
    [alternateValue, lightValue, shadeCount, tintCount, token],
  );
  const previewVariables = generateFrameworkColorVariableSets({
    tokens: [previewToken],
  }).light;
  const shadeVariables = previewVariables.filter((variable) =>
    variable.variantName?.startsWith("d-"),
  );
  const tintVariables = previewVariables.filter((variable) =>
    variable.variantName?.startsWith("l-"),
  );

  // Resync local edit state with the upstream token whenever any of the
  // mirrored fields change (parent commit, undo/redo, external patch). Done
  // via a render-time previous-value comparison rather than useEffect+setState
  // so the form doesn't render once with stale values before snapping to the
  // new token. See React's "store information from previous renders" pattern.
  const tokenSnapshot =
    token.id +
    "|" +
    token.category +
    "|" +
    token.slug +
    "|" +
    token.lightValue +
    "|" +
    String(token.darkModeEnabled) +
    "|" +
    token.darkValue +
    "|" +
    token.generateShades.count +
    "|" +
    token.generateTints.count;
  const [lastTokenSnapshot, setLastTokenSnapshot] = useState(tokenSnapshot);
  if (lastTokenSnapshot !== tokenSnapshot) {
    setLastTokenSnapshot(tokenSnapshot);
    setSlug(token.slug);
    setLightValue(token.lightValue);
    setAlternateValue(token.darkModeEnabled ? token.darkValue : "");
    setCategory(token.category);
    setShadeCount(String(token.generateShades.count));
    setTintCount(String(token.generateTints.count));
  }

  function commitLightValue(nextValue = lightValue) {
    onPatch({ lightValue: nextValue });
  }

  function commitAlternateValue(nextValue = alternateValue) {
    const trimmed = nextValue.trim();
    onPatch({
      darkValue: trimmed,
      darkModeEnabled: trimmed.length > 0,
    });
  }

  function commitCategory(nextValue = category) {
    const trimmed = nextValue.trim();
    setCategory(trimmed);
    if (trimmed !== token.category) onPatch({ category: trimmed });
  }

  function commitVariantCount(kind: "shade" | "tint", value: string) {
    const nextCount = clampVariantCountInput(value);
    if (kind === "shade") {
      setShadeCount(String(nextCount));
      onPatch({ generateShades: { count: nextCount } });
    } else {
      setTintCount(String(nextCount));
      onPatch({ generateTints: { count: nextCount } });
    }
  }

  return (
    <div className={styles.editor}>
      <label className={styles.field}>
        <span>Token name</span>
        <Input
          fieldSize="sm"
          value={slug}
          aria-label="Token name"
          prefix="--"
          onChange={(event) => setSlug(event.target.value)}
          onBlur={() => {
            const nextSlug = normalizeFrameworkColorSlug(slug);
            setSlug(nextSlug);
            onPatch({ slug: nextSlug });
          }}
        />
      </label>

      <CategoryComboBox
        label="Category"
        suggestions={categories}
        excludeCategory={token.category}
        value={category}
        onValueChange={setCategory}
        onCommit={commitCategory}
        fieldClassName={styles.field}
      />

      <ColorValueField
        label="Default color"
        inputLabel="Default color"
        swatchLabel={`Default color swatch ${token.slug}`}
        value={lightValue}
        excludeTokenId={token.id}
        onValueChange={setLightValue}
        onCommit={commitLightValue}
      />

      <ColorValueField
        label="Alt color"
        inputLabel="Alt color"
        swatchLabel={`Alternate color swatch ${token.slug}`}
        value={alternateValue}
        excludeTokenId={token.id}
        onValueChange={setAlternateValue}
        onCommit={commitAlternateValue}
        placeholder="Optional"
      />

      <div className={styles.utilityGrid} aria-label="Generate utility classes">
        {UTILITY_OPTIONS.map((option) => (
          <SwitchRow
            key={option.key}
            label={option.label}
            checked={token.generateUtilities[option.key]}
            onCheckedChange={(checked) =>
              onPatch({
                generateUtilities: { [option.key]: checked },
              })
            }
          />
        ))}
      </div>

      <SwitchRow
        label="Transparent variants"
        checked={token.generateTransparent}
        onCheckedChange={(checked) => onPatch({ generateTransparent: checked })}
      />

      <div className={styles.variantControl}>
        <SwitchRow
          label="Generate shades"
          checked={token.generateShades.enabled}
          onCheckedChange={(checked) =>
            onPatch({ generateShades: { enabled: checked } })
          }
        />
        {token.generateShades.enabled && (
          <>
            <VariantCountStepper
              label="Shade"
              count={clampVariantCountInput(shadeCount)}
              onCountChange={(count) => commitVariantCount("shade", String(count))}
            />
            <ColorVariantPreview
              kind="Shade"
              tokenSlug={token.slug}
              variables={shadeVariables}
            />
          </>
        )}
      </div>

      <div className={styles.variantControl}>
        <SwitchRow
          label="Generate tints"
          checked={token.generateTints.enabled}
          onCheckedChange={(checked) =>
            onPatch({ generateTints: { enabled: checked } })
          }
        />
        {token.generateTints.enabled && (
          <>
            <VariantCountStepper
              label="Tint"
              count={clampVariantCountInput(tintCount)}
              onCountChange={(count) => commitVariantCount("tint", String(count))}
            />
            <ColorVariantPreview
              kind="Tint"
              tokenSlug={token.slug}
              variables={tintVariables}
            />
          </>
        )}
      </div>
    </div>
  );
}

function ColorValueField({
  label,
  inputLabel,
  swatchLabel,
  value,
  excludeTokenId,
  onValueChange,
  onCommit,
  placeholder,
  fieldClassName = styles.field,
  labelClassName,
}: {
  label: string;
  inputLabel: string;
  swatchLabel: string;
  value: string;
  excludeTokenId?: string;
  onValueChange: (value: string) => void;
  onCommit: (value: string) => void;
  placeholder?: string;
  fieldClassName?: string;
  labelClassName?: string;
}) {
  function commit(nextValue = value) {
    onCommit(nextValue);
  }

  return (
    <div className={fieldClassName}>
      <span className={labelClassName}>{label}</span>
      <TokenizedColorField
        value={value}
        inputLabel={inputLabel}
        swatchLabel={swatchLabel}
        placeholder={placeholder}
        excludeTokenId={excludeTokenId}
        onTextChange={onValueChange}
        onTextBlur={() => commit()}
        onSwatchChange={(nextValue) => {
          onValueChange(nextValue);
          commit(nextValue);
        }}
        onTokenSelect={(nextValue) => {
          onValueChange(nextValue);
          commit(nextValue);
        }}
      />
    </div>
  );
}

/**
 * Free-form category picker. Suggestions are drawn from the categories already
 * present on other tokens; the input itself accepts any string. Empty string
 * (or whitespace-only) commits as "uncategorized".
 */
function CategoryComboBox({
  label,
  suggestions,
  excludeCategory,
  value,
  onValueChange,
  onCommit,
  fieldClassName = styles.field,
  labelClassName,
}: {
  label: string;
  suggestions: string[];
  /** Current category of the editing token — kept out of the suggestion list. */
  excludeCategory?: string;
  value: string;
  onValueChange: (value: string) => void;
  onCommit: (value: string) => void;
  fieldClassName?: string;
  labelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const filteredSuggestions = useMemo(() => {
    const query = value.trim().toLowerCase();
    const exclude = excludeCategory?.trim().toLowerCase();
    return suggestions.filter((candidate) => {
      const key = candidate.toLowerCase();
      if (exclude && key === exclude) return false;
      if (!query) return true;
      return key.includes(query);
    });
  }, [excludeCategory, suggestions, value]);

  // Reset highlight when the filtered set changes.
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setActiveIndex(0);
  }

  const showMenu = open && filteredSuggestions.length > 0;

  function handleFocus() {
    setOpen(true);
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>) {
    if (
      event.relatedTarget instanceof HTMLElement &&
      event.currentTarget.parentElement?.contains(event.relatedTarget)
    ) {
      return;
    }
    onCommit(value);
    window.setTimeout(() => setOpen(false), 0);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onValueChange(event.target.value);
    setOpen(true);
  }

  function commitSuggestion(suggestion: string) {
    onValueChange(suggestion);
    onCommit(suggestion);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!showMenu) {
      if (event.key === "ArrowDown" && filteredSuggestions.length > 0) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) =>
        Math.min(index + 1, filteredSuggestions.length - 1),
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      commitSuggestion(filteredSuggestions[activeIndex]);
    }
  }

  return (
    <div className={fieldClassName}>
      <span className={labelClassName}>{label}</span>
      <div className={styles.categoryField}>
        <Input
          type="text"
          value={value}
          fieldSize="sm"
          aria-label={label}
          aria-expanded={showMenu ? true : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Uncategorized"
          onFocus={handleFocus}
          onMouseDown={() => setOpen(true)}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
        {showMenu && (
          <div
            role="listbox"
            aria-label={`${label} suggestions`}
            className={styles.categoryMenu}
          >
            {filteredSuggestions.map((suggestion, index) => (
              <button
                key={suggestion}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={styles.categoryOption}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commitSuggestion(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function VariantCountStepper({
  label,
  count,
  onCountChange,
}: {
  label: "Shade" | "Tint";
  count: number;
  onCountChange: (count: number) => void;
}) {
  const min = 0;
  const max = 12;
  const lowerLabel = label.toLowerCase();
  return (
    <div
      className={styles.stepperRow}
      role="group"
      aria-label={`${label} variants`}
    >
      <span>{label} variants</span>
      <div className={styles.stepperControl}>
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          aria-label={`Decrease ${lowerLabel} variants`}
          disabled={count <= min}
          onClick={() => onCountChange(Math.max(min, count - 1))}
        >
          <MinusIcon size={12} aria-hidden="true" />
        </Button>
        <span className={styles.stepperValue} aria-live="polite">
          {count}
        </span>
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          aria-label={`Increase ${lowerLabel} variants`}
          disabled={count >= max}
          onClick={() => onCountChange(Math.min(max, count + 1))}
        >
          <PlusIcon size={12} aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function SwitchRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className={styles.checkboxRow}>
      <span>{label}</span>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        switchSize="sm"
        aria-label={label}
      />
    </div>
  );
}

function ColorVariantPreview({
  kind,
  tokenSlug,
  variables,
}: {
  kind: "Shade" | "Tint";
  tokenSlug: string;
  variables: ColorPreviewVariable[];
}) {
  if (variables.length === 0) return null;

  return (
    <div className={styles.variantPreview} aria-label={`${kind} previews`}>
      {variables.map((variable) => (
        <ColorInput
          key={variable.name}
          value={variable.value}
          swatchValue={variable.value}
          fieldSize="xs"
          disabled
          aria-label={`${kind} preview ${tokenSlug} ${variable.variantName ?? variable.variantId}`}
        />
      ))}
    </div>
  );
}

function CreateColorDialog({
  categories,
  defaultCategory,
  onCancel,
  onSubmit,
}: {
  categories: string[];
  defaultCategory: string;
  onCancel: () => void;
  onSubmit: (name: string, lightValue: string, category: string) => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(defaultCategory);
  const [lightValue, setLightValue] = useState("hsla(238, 100%, 62%, 1)");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const canSubmit = Boolean(name.trim() && lightValue.trim());

  useEffect(() => {
    requestAnimationFrame(() => nameInputRef.current?.focus());
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit(name, lightValue, category.trim());
  }

  return createPortal(
    <div
      className={dialogStyles.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-color-dialog-title"
        className={dialogStyles.dialog}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={dialogStyles.header}>
          <h2 id="create-color-dialog-title" className={dialogStyles.title}>
            Create color
          </h2>
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            aria-label="Close dialog"
            onClick={onCancel}
          >
            <CloseIcon size={12} aria-hidden="true" />
          </Button>
        </div>
        <form className={dialogStyles.form} onSubmit={handleSubmit}>
          <label className={dialogStyles.field}>
            <span className={dialogStyles.label}>Token name</span>
            <Input
              ref={nameInputRef}
              fieldSize="sm"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-label="Token name"
              autoComplete="off"
              spellCheck={false}
              prefix="--"
            />
          </label>
          <CategoryComboBox
            label="Category"
            suggestions={categories}
            value={category}
            onValueChange={setCategory}
            onCommit={(next) => setCategory(next.trim())}
            fieldClassName={dialogStyles.field}
            labelClassName={dialogStyles.label}
          />
          <ColorValueField
            label="Default color"
            inputLabel="Default color"
            swatchLabel="Default color swatch"
            value={lightValue}
            onValueChange={setLightValue}
            onCommit={setLightValue}
            fieldClassName={dialogStyles.field}
            labelClassName={dialogStyles.label}
          />
          <div className={dialogStyles.actions}>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={!canSubmit}
            >
              Create
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function ColorTokenContextMenu({
  x,
  y,
  canMoveUp,
  canMoveDown,
  onClose,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  x: number;
  y: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onClose: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  return (
    <ContextMenu x={x} y={y} ariaLabel="Color token actions" onClose={onClose}>
      <ContextMenuItem onClick={onDuplicate}>
        <span aria-hidden="true">
          <Copy2SharpIcon size={13} />
        </span>
        Duplicate
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={!canMoveUp} onClick={onMoveUp}>
        <span aria-hidden="true">
          <ChevronUpIcon size={13} />
        </span>
        Move up
      </ContextMenuItem>
      <ContextMenuItem disabled={!canMoveDown} onClick={onMoveDown}>
        <span aria-hidden="true">
          <ChevronDownIcon size={13} />
        </span>
        Move down
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem danger onClick={onDelete}>
        <span aria-hidden="true">
          <DeleteIcon size={13} />
        </span>
        Remove
      </ContextMenuItem>
    </ContextMenu>
  );
}

function canMoveToken(
  tokens: FrameworkColorToken[],
  token: FrameworkColorToken,
  direction: "up" | "down",
): boolean {
  const group = tokens
    .filter((candidate) => candidate.category === token.category)
    .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  const index = group.findIndex((candidate) => candidate.id === token.id);
  return direction === "up"
    ? index > 0
    : index >= 0 && index < group.length - 1;
}

function clampVariantCountInput(value: string | number): number {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.max(0, Math.min(12, Math.floor(numericValue)));
}
