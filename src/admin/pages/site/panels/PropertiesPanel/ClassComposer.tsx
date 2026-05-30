/**
 * ClassComposer — CSS section content renderer for a single class.
 *
 * Renders the style property sections for the given class filtered by
 * activeStyleSectionId and styleQuery. The rail, search bar, and section
 * navigation are owned by the parent (StyleSurface).
 */

import { useCallback, useState } from 'react'
import { useEditorStore } from '@site/store/store'
import type { StyleRule, CSSPropertyBag, StyleCondition } from '@core/page-tree'
import { ClassPropertyRow } from './ClassPropertyRow'
import { Section } from '@ui/components/Section'
import { SpacingBoxControl } from './SpacingBoxControl/SpacingBoxControl'
import { BorderControl } from './BorderControl/BorderControl'
import { CustomPropertiesSection } from './CustomPropertiesSection'
import { ConditionTabs, type StyleTarget } from './ConditionTabs'
import { LayoutSection } from './LayoutSection'
import { PositionSection } from './PositionSection'
import {
  CLASS_STYLE_SECTIONS,
  cssPropertyLabel,
  getCSSPropertyDefaultValue,
  getActiveStyleTab,
  type ClassStyleSectionDefinition,
} from './cssControlTypes'
import { hasStyleValue } from './styleValueUtils'
import styles from './ClassComposer.module.css'
import sectionStyles from '@ui/components/Section/Section.module.css'

const SPACING_SECTION_ID = 'spacing'
const LAYOUT_SECTION_ID = 'layout'
const POSITION_SECTION_ID = 'position'
const BORDER_SECTION_ID = 'border'

/** Stable empty-array reference for rules with no conditional layers. */
const EMPTY_LAYERS: ReadonlyArray<import('@core/page-tree').ConditionalStyleLayer> = []

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ClassComposerProps {
  classId: string
  cls: StyleRule
  /** Search query — filters visible properties across all categories. */
  styleQuery: string
  mode?: 'contextual' | 'global'
}

// ---------------------------------------------------------------------------
// ClassComposer
// ---------------------------------------------------------------------------

export function ClassComposer({
  classId,
  cls,
  styleQuery,
  mode: _mode = 'contextual',
}: ClassComposerProps) {
  const activeBreakpointId = useEditorStore((s) => s.activeBreakpointId)
  const updateClassStyles = useEditorStore((s) => s.updateClassStyles)
  const setClassBreakpointStyles = useEditorStore((s) => s.setClassBreakpointStyles)
  const removeClassStyleProperty = useEditorStore((s) => s.removeClassStyleProperty)
  const setPreviewClassStyles = useEditorStore((s) => s.setPreviewClassStyles)
  const clearPreviewClassStyles = useEditorStore((s) => s.clearPreviewClassStyles)
  const addConditionalLayer = useEditorStore((s) => s.addConditionalLayer)
  const updateConditionalLayerStyles = useEditorStore((s) => s.updateConditionalLayerStyles)
  const removeConditionalLayer = useEditorStore((s) => s.removeConditionalLayer)

  // The active *condition* dimension (Base vs a specific conditional layer).
  // Reset to Base when the selected class changes. Orthogonal to the active
  // width-breakpoint (owned by the responsive toolbar) — a condition edits the
  // layer's flat styles, ignoring the breakpoint axis for v1.
  const [activeTarget, setActiveTarget] = useState<StyleTarget>({ kind: 'base' })
  const layers = cls.conditionalLayers ?? EMPTY_LAYERS
  // If the active layer was removed (or the class changed), fall back to Base.
  const activeLayer =
    activeTarget.kind === 'condition'
      ? layers.find((l) => l.id === activeTarget.layerId) ?? null
      : null
  const onCondition = activeTarget.kind === 'condition' && activeLayer !== null

  const activeTab = getActiveStyleTab(activeBreakpointId)

  const storedStyles: Record<string, unknown> = onCondition
    ? (activeLayer!.styles as Record<string, unknown>)
    : activeTab !== 'base'
      ? (cls.breakpointStyles[activeTab] ?? {})
      : cls.styles
  const currentStyles: Record<string, unknown> = onCondition
    ? { ...cls.styles, ...storedStyles }
    : activeTab !== 'base'
      ? { ...cls.styles, ...storedStyles }
      : cls.styles

  const visibleStyleSections = getVisibleStyleSections(styleQuery)

  const handleChange = useCallback(
    (key: keyof CSSPropertyBag, value: string | number | undefined) => {
      const patch = { [key]: value ?? null } as Partial<CSSPropertyBag>
      if (onCondition) {
        updateConditionalLayerStyles(classId, (activeTarget as { layerId: string }).layerId, patch)
      } else if (activeTab !== 'base') {
        setClassBreakpointStyles(classId, activeTab, patch)
      } else {
        updateClassStyles(classId, patch)
      }
    },
    [classId, activeTab, onCondition, activeTarget, updateClassStyles, setClassBreakpointStyles, updateConditionalLayerStyles],
  )

  const handleRemoveProperty = useCallback(
    (key: keyof CSSPropertyBag) => {
      handleChange(key, undefined)
    },
    [handleChange],
  )

  /**
   * Fully clear a property — used by visual switchers (LayoutSection) where
   * the X / clear affordance must really make a property go away regardless
   * of whether the value at the active tab is stored or inherited from base.
   * Routes through `removeClassStyleProperty` which removes the key from
   * base styles AND every breakpoint override in a single history entry.
   */
  const handleClearProperty = useCallback(
    (key: keyof CSSPropertyBag) => {
      if (onCondition) {
        // On a condition tab, "clear" removes the prop from that layer only.
        updateConditionalLayerStyles(classId, (activeTarget as { layerId: string }).layerId, {
          [key]: undefined,
        } as Partial<CSSPropertyBag>)
        return
      }
      removeClassStyleProperty(classId, key)
    },
    [classId, onCondition, activeTarget, removeClassStyleProperty, updateConditionalLayerStyles],
  )

  // ── Condition tab handlers ───────────────────────────────────────────────
  const handleAddCondition = useCallback(
    (condition: StyleCondition) => {
      const layerId = addConditionalLayer(classId, condition)
      if (layerId) setActiveTarget({ kind: 'condition', layerId })
    },
    [classId, addConditionalLayer],
  )

  const handleRemoveCondition = useCallback(
    (layerId: string) => {
      removeConditionalLayer(classId, layerId)
      setActiveTarget((cur) =>
        cur.kind === 'condition' && cur.layerId === layerId ? { kind: 'base' } : cur,
      )
    },
    [classId, removeConditionalLayer],
  )

  // Preview a transient style patch on the canvas while a property
  // control's hover-suggestion menu is open. The preview lives entirely
  // in store UI state — no class document mutation, no history entry.
  const handlePreview = useCallback(
    (patch: Partial<CSSPropertyBag>) => {
      setPreviewClassStyles({
        classId,
        breakpointId: activeTab !== 'base' ? activeTab : null,
        styles: patch,
      })
    },
    [classId, activeTab, setPreviewClassStyles],
  )

  const handleClearPreview = useCallback(() => {
    clearPreviewClassStyles(classId)
  }, [classId, clearPreviewClassStyles])

  return (
    <div className={styles.styleSections}>
      {/* Condition tabs — Base + custom @media / @container / @supports layers.
          Hidden while a style search is active (search targets the property
          sections, not the condition dimension). */}
      {!styleQuery.trim() && (
        <ConditionTabs
          layers={layers}
          active={activeTarget}
          onSelect={setActiveTarget}
          onAdd={handleAddCondition}
          onRemove={handleRemoveCondition}
        />
      )}
      {visibleStyleSections.map((section) => (
        <div key={section.id} data-style-section={section.id}>
          <ClassStyleSection
            section={section}
            currentStyles={currentStyles}
            storedStyles={storedStyles}
            activeTab={activeTab}
            onChange={handleChange}
            onRemove={handleRemoveProperty}
            onClearProperty={handleClearProperty}
            onPreview={handlePreview}
            onClearPreview={handleClearPreview}
          />
        </div>
      ))}
      {/* Custom properties — generic editor for the long tail of CSS the
          curated sections don't claim. Hidden while a style search is active
          (the search filters the curated sections; the raw editor isn't a
          search target). */}
      {!styleQuery.trim() && (
        <div data-style-section="custom">
          <CustomPropertiesSection
            key={activeTab}
            storedStyles={storedStyles}
            onChange={handleChange}
            onRemove={handleRemoveProperty}
          />
        </div>
      )}
      {visibleStyleSections.length === 0 && styleQuery.trim() && (
        <div className={styles.noStyleMatches}>No matching styles.</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ClassStyleSection
// ---------------------------------------------------------------------------

interface ClassStyleSectionProps {
  section: ClassStyleSectionDefinition
  currentStyles: Record<string, unknown>
  storedStyles: Record<string, unknown>
  activeTab: string
  onChange: (property: keyof CSSPropertyBag, value: string | number | undefined) => void
  onRemove: (property: keyof CSSPropertyBag) => void
  onClearProperty: (property: keyof CSSPropertyBag) => void
  onPreview: (patch: Partial<CSSPropertyBag>) => void
  onClearPreview: () => void
}

function ClassStyleSection({
  section,
  currentStyles,
  storedStyles,
  activeTab,
  onChange,
  onRemove,
  onClearProperty,
  onPreview,
  onClearPreview,
}: ClassStyleSectionProps) {
  const setCount = section.properties.filter((prop) => hasStyleValue(storedStyles[prop])).length

  return (
    <Section
      title={section.title}
      icon={section.icon}
      defaultOpen
      indicator={setCount > 0}
      indicatorTestId={`class-style-section-dot-${section.id}`}
      meta={setCount > 0 ? `${setCount} set` : undefined}
    >
      <div className={sectionStyles.sectionBody}>
        {section.id === SPACING_SECTION_ID ? (
          // Spacing section uses a single visual box-model widget instead of
          // a stack of 10 padding/margin rows. The widget owns shorthand
          // collapse and writes through the same onChange/onRemove pipeline.
          <SpacingBoxControl
            key={activeTab}
            storedStyles={storedStyles}
            currentStyles={currentStyles}
            onChange={onChange}
            onRemove={onRemove}
            onPreview={onPreview}
            onClearPreview={onClearPreview}
          />
        ) : section.id === LAYOUT_SECTION_ID ? (
          // Layout uses a task-shaped editor: an unlabeled segmented
          // Display switcher with a dropdown trail, plus icon switchers
          // for flex direction / wrap / alignment. Generic rows for the
          // long-tail layout properties still appear below.
          <LayoutSection
            key={activeTab}
            storedStyles={storedStyles}
            currentStyles={currentStyles}
            activeTab={activeTab}
            onChange={onChange}
            onRemove={onRemove}
            onClearProperty={onClearProperty}
          />
        ) : section.id === POSITION_SECTION_ID ? (
          // Position uses a task-shaped editor: a segmented Position
          // switcher with the four directional offsets revealed when the
          // value actually honors them, plus a z-index row that always
          // stays available inside the section.
          <PositionSection
            key={activeTab}
            storedStyles={storedStyles}
            currentStyles={currentStyles}
            activeTab={activeTab}
            onChange={onChange}
            onRemove={onRemove}
            onClearProperty={onClearProperty}
          />
        ) : section.id === BORDER_SECTION_ID ? (
          // Border uses a visual per-side editor (width / style / colour per
          // edge with a link toggle) + a radius corner editor + an outline
          // pair. The raw shorthand rows (border / borderTop / borderRadius /
          // …) live in the Advanced disclosure below for power users who want
          // to paste a shorthand string directly.
          <>
            <BorderControl
              key={activeTab}
              storedStyles={storedStyles}
              currentStyles={currentStyles}
              onChange={onChange}
              onClearProperty={onClearProperty}
            />
            <AdvancedRows
              activeTab={activeTab}
              properties={BORDER_ADVANCED_PROPERTIES}
              storedStyles={storedStyles}
              currentStyles={currentStyles}
              onChange={onChange}
              onRemove={onRemove}
            />
          </>
        ) : (
          section.properties.map((prop) => {
            const storedValue = storedStyles[prop]
            const isSet = hasStyleValue(storedValue)
            const currentValue = currentStyles[prop]
            const fallbackValue = hasStyleValue(currentValue)
              ? currentValue
              : getCSSPropertyDefaultValue(prop)

            return (
              <ClassPropertyRow
                key={`${activeTab}-${String(prop)}`}
                property={prop}
                // storedValue is narrowed to string | number by the isSet guard above
                value={isSet ? (storedValue as string | number) : undefined}
                placeholder={!isSet ? fallbackValue : undefined}
                isSet={isSet}
                onChange={onChange}
                onRemove={onRemove}
              />
            )
          })
        )}
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Border advanced rows — raw CSS shorthand props that the visual
// BorderControl deliberately doesn't surface. Kept available behind a
// disclosure for power users who paste shorthand strings.
// ---------------------------------------------------------------------------

const BORDER_ADVANCED_PROPERTIES: ReadonlyArray<keyof CSSPropertyBag> = [
  'border',
  'borderTop',
  'borderRight',
  'borderBottom',
  'borderLeft',
  'borderWidth',
  'borderStyle',
  'borderColor',
  'borderRadius',
  'appearance',
]

interface AdvancedRowsProps {
  activeTab: string
  properties: ReadonlyArray<keyof CSSPropertyBag>
  storedStyles: Record<string, unknown>
  currentStyles: Record<string, unknown>
  onChange: (property: keyof CSSPropertyBag, value: string | number | undefined) => void
  onRemove: (property: keyof CSSPropertyBag) => void
}

/**
 * A `<details>` disclosure wrapping a stack of raw property rows. Used for the
 * Border section's shorthand props. Native `<details>`/`<summary>` is semantic
 * HTML (not a bare interactive control), so it's outside the button-primitive
 * gate without needing an allowlist entry.
 */
function AdvancedRows({
  activeTab,
  properties,
  storedStyles,
  currentStyles,
  onChange,
  onRemove,
}: AdvancedRowsProps) {
  // Open by default when any advanced prop already carries a value, so an
  // imported class that set `border: 1px solid red` as a shorthand is visible.
  const anySet = properties.some((prop) => hasStyleValue(storedStyles[prop]))

  return (
    <details className={styles.advanced} open={anySet}>
      <summary className={styles.advancedSummary}>Advanced</summary>
      <div className={styles.advancedBody}>
        {properties.map((prop) => {
          const storedValue = storedStyles[prop]
          const isSet = hasStyleValue(storedValue)
          const currentValue = currentStyles[prop]
          const fallbackValue = hasStyleValue(currentValue)
            ? currentValue
            : getCSSPropertyDefaultValue(prop)
          return (
            <ClassPropertyRow
              key={`${activeTab}-${String(prop)}`}
              property={prop}
              value={isSet ? (storedValue as string | number) : undefined}
              placeholder={!isSet ? fallbackValue : undefined}
              isSet={isSet}
              onChange={onChange}
              onRemove={onRemove}
            />
          )
        })}
      </div>
    </details>
  )
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function getVisibleStyleSections(
  query: string,
): ReadonlyArray<ClassStyleSectionDefinition> {
  const normalizedQuery = query.trim().toLowerCase()

  return CLASS_STYLE_SECTIONS
    .map((section) => ({
      ...section,
      properties: section.properties.filter(
        (prop) =>
          !normalizedQuery ||
          sectionMatchesQuery(section, normalizedQuery) ||
          propertyMatchesQuery(prop, normalizedQuery),
      ),
    }))
    .filter((section) => section.properties.length > 0)
}

function sectionMatchesQuery(section: ClassStyleSectionDefinition, query: string): boolean {
  return section.id.toLowerCase().includes(query) || section.title.toLowerCase().includes(query)
}

function propertyMatchesQuery(prop: keyof CSSPropertyBag, query: string): boolean {
  const raw = String(prop).toLowerCase()
  const label = cssPropertyLabel(String(prop)).toLowerCase()
  return raw.includes(query) || label.includes(query)
}
