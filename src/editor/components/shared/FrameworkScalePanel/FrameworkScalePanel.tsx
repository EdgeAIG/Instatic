/**
 * FrameworkScalePanel — shared docked-panel UI for fluid Typography & Spacing.
 *
 * The visual / interaction layer is identical between the two modules: a tab
 * row of groups, a mode toggle (Automatic / Manual), the per-step preview list,
 * and the Class Generator section underneath. The two modules differ only in
 *   - what numeric "base size" field they edit (`fontSize` vs `size`),
 *   - their default scale ratio options,
 *   - the rendered preview row (text vs spacing bar),
 *   - the supported CSS properties in the Class Generator.
 *
 * Those three differences are passed in via props so the same component can
 * back both `TypographyPanel` and `SpacingPanel` without duplicating the
 * tab/mode/manual/class-generator logic.
 */

import { type MouseEvent, useMemo, useState } from 'react'
import { Button } from '@ui/components/Button'
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@ui/components/ContextMenu'
import { EmptyState } from '@ui/components/EmptyState'
import { FilterBar, type FilterBarItem } from '@ui/components/FilterBar'
import { Input } from '@ui/components/Input'
import { Select } from '@ui/components/Select'
import { Switch } from '@ui/components/Switch'
import { BracesIcon } from 'pixel-art-icons/icons/braces'
import { Copy2SharpIcon } from 'pixel-art-icons/icons/copy-2-sharp'
import { DeleteIcon } from 'pixel-art-icons/icons/delete'
import { EditIcon } from 'pixel-art-icons/icons/edit'
import { FilePlusIcon } from 'pixel-art-icons/icons/file-plus'
import { MinusIcon } from 'pixel-art-icons/icons/minus'
import { PlusIcon } from 'pixel-art-icons/icons/plus'
import { ReloadIcon } from 'pixel-art-icons/icons/reload'
import type { IconComponent } from 'pixel-art-icons/types'
import { ControlRow } from '../../PropertyControls/ControlRow'
import { Section } from '../../PropertiesPanel/Section'
import { useEditorStore } from '@core/editor-store/store'
import {
  computeFluidScale,
  declarationFromStep,
  effectiveScaleRatio,
  type FluidScaleStep,
} from '@core/framework/scale'
import { resolveFrameworkPreferences } from '@core/framework/preferences'
import type {
  FrameworkScaleManualSize,
  FrameworkScaleMode,
  FrameworkSpacingClassGenerator,
  FrameworkSpacingGroup,
  FrameworkTypographyClassGenerator,
  FrameworkTypographyGroup,
} from '@core/framework/schemas'
import { PanelHeader } from '../PanelHeader'
import styles from './FrameworkScalePanel.module.css'

// ─── Shape ──────────────────────────────────────────────────────────────────

export interface ScaleAdapter<G, C> {
  /** Public name used in the panel header and aria labels. */
  title: 'Typography' | 'Spacing'
  /** Stable id passed to PanelHeader. */
  panelId: 'typography' | 'spacing'
  /** Read the active group list from the store. */
  selectGroups: (state: ReturnType<typeof useEditorStore.getState>) => G[]
  /** Read the class generators list from the store. */
  selectClasses: (state: ReturnType<typeof useEditorStore.getState>) => C[]
  /** Read the disabled flag from the store. */
  selectIsDisabled: (state: ReturnType<typeof useEditorStore.getState>) => boolean
  /** Numeric ratio options shown in the min/max scale selectors. */
  ratioOptions: ReadonlyArray<{ value: string; label: string }>
  /** Available kebab-case CSS properties for the Class Generator. */
  classGeneratorProperties: ReadonlyArray<{ value: string; label: string }>
  /** Fluid-min / fluid-max field label ("Min Font Size" vs "Min Size"). */
  baseSizeLabel: string
  /** Read the base size from a group min/max breakpoint config. */
  readBaseSize: (group: G, side: 'min' | 'max') => number
  /** Patch the base size on a group min/max breakpoint config. */
  patchBaseSize: (side: 'min' | 'max', value: number) => Record<string, unknown>
  /**
   * Render the per-step preview for a single breakpoint.
   * Used as the default visualization when `renderStepBody` is not supplied.
   */
  renderPreview: (sizePx: number) => React.ReactNode
  /**
   * Optional richer per-step visualization. When supplied, replaces the simple
   * two-column min/max preview row with whatever the adapter returns. Receives
   * both endpoints and the largest size in the entire scale so adapters can
   * draw proportional charts.
   */
  renderStepBody?: (args: {
    minPx: number
    maxPx: number
    maxInScale: number
    stepLabel: string
    variableName: string
  }) => React.ReactNode
  /**
   * Optional unified visualisation rendered ONCE above the per-step list.
   * Receives the full series so an adapter can draw a single stream / area /
   * line chart that spans the entire scale, instead of (or in addition to)
   * the per-step rows. Useful for showing how min and max grow across the
   * whole scale at a glance.
   */
  renderChart?: (args: {
    points: Array<{
      stepLabel: string
      variableName: string
      minPx: number
      maxPx: number
      /** True when this step's index matches the group's baseScaleIndex —
       * i.e. the step whose value equals the user-configured min/max base
       * size verbatim. Adapters use this to highlight the base in the chart. */
      isBase: boolean
    }>
    maxInScale: number
    /** Index of the base step in the points array (mirrors `isBase`). */
    baseStepIndex: number
    /**
     * Step add/remove callbacks. Wired up by the FluidEditor so an adapter can
     * embed `+ / −` buttons directly in the chart card (when the chart fully
     * replaces the per-step list, the controls have to live somewhere).
     */
    onPrependStep: () => void
    onAppendStep: () => void
    onRemoveFirstStep: () => void
    onRemoveLastStep: () => void
    canRemoveStep: boolean
  }) => React.ReactNode
  /**
   * Optional legend rendered at the bottom of the step list. Useful when
   * `renderStepBody` / `renderChart` introduce colour-coded series that
   * need a key.
   */
  chartLegend?: React.ReactNode
  /** Action to toggle the disabled flag. */
  onToggleDisabled: () => void
  /** Create a new group / tab. Returns the new group. */
  onCreateGroup: () => G
  /** Update fields on an existing group. */
  onUpdateGroup: (groupId: string, patch: Record<string, unknown>) => void
  /** Duplicate / reset / delete on a group. */
  onDuplicateGroup: (groupId: string) => G | null
  onResetGroup: (groupId: string) => void
  onDeleteGroup: (groupId: string) => void
  /** Update a manual size entry on a group. */
  onUpsertManualSize: (groupId: string, sizeId: string, patch: Partial<FrameworkScaleManualSize>) => void
  /** Replace the whole class-generators list. */
  onSetClassGenerators: (next: C[]) => void
  /**
   * Icon shown in the "Scales" Section header. Conventionally the same icon
   * the panel rail uses for this family — `text-start-t` for typography,
   * `ruler-dimension` for spacing — so the rail → panel → section chain
   * shares a consistent visual identity.
   */
  scalesSectionIcon?: IconComponent
  /**
   * Optional extra collapsible sections rendered alongside the built-in
   * "Scales" + "Utilities" sections. Used by TypographyPanel to host the
   * "Fonts" section (Google + custom font library). Each entry is its own
   * Section with its own collapse state.
   *
   * `position`: 'top' renders BEFORE the built-in Scales section (e.g. fonts
   *   live above scales for typography). 'bottom' renders AFTER Utilities
   *   (the original behaviour). Default: 'bottom'.
   */
  extraSections?: ReadonlyArray<{
    id: string
    title: string
    icon?: IconComponent
    defaultOpen?: boolean
    position?: 'top' | 'bottom'
    render: (group: G) => React.ReactNode
  }>
}

interface FrameworkScalePanelProps {
  variant?: 'docked'
  isOpen: boolean
  onClose: () => void
}

type GroupShape = FrameworkTypographyGroup | FrameworkSpacingGroup
type GeneratorShape = FrameworkTypographyClassGenerator | FrameworkSpacingClassGenerator

// ─── Component ──────────────────────────────────────────────────────────────

export function FrameworkScalePanel<G extends GroupShape, C extends GeneratorShape>({
  adapter,
  isOpen,
  onClose,
  variant = 'docked',
}: FrameworkScalePanelProps & { adapter: ScaleAdapter<G, C> }) {
  const groups = useEditorStore(adapter.selectGroups)
  const classGenerators = useEditorStore(adapter.selectClasses)
  const isDisabled = useEditorStore(adapter.selectIsDisabled)
  const preferencesRaw = useEditorStore((s) => s.site?.settings.framework?.preferences ?? null)
  const preferences = useMemo(() => resolveFrameworkPreferences(preferencesRaw), [preferencesRaw])

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.order - b.order),
    [groups],
  )
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const activeGroup = useMemo(() => {
    if (!sortedGroups.length) return null
    return sortedGroups.find((g) => g.id === activeTabId) ?? sortedGroups[0]
  }, [activeTabId, sortedGroups])

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    groupId: string
  } | null>(null)
  const isFirstTab = activeGroup ? sortedGroups[0]?.id === activeGroup.id : true

  if (!isOpen || variant !== 'docked') return null

  function handleTabContextMenu(groupId: string, event: MouseEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ x: event.clientX, y: event.clientY, groupId })
  }

  function handleAddGroup() {
    const created = adapter.onCreateGroup()
    setActiveTabId(created.id)
  }

  function handleDuplicate(groupId: string) {
    const created = adapter.onDuplicateGroup(groupId)
    if (created) setActiveTabId(created.id)
    setContextMenu(null)
  }

  function handleReset(groupId: string) {
    adapter.onResetGroup(groupId)
    setContextMenu(null)
  }

  function handleDelete(groupId: string) {
    adapter.onDeleteGroup(groupId)
    if (activeGroup?.id === groupId) setActiveTabId(null)
    setContextMenu(null)
  }

  return (
    <>
      <aside
        role="complementary"
        aria-label={adapter.title}
        data-panel=""
        data-testid={`${adapter.panelId}-panel`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={styles.panel}
      >
        <PanelHeader
          panelId={adapter.panelId}
          title={adapter.title}
          onClose={onClose}
        >
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            aria-label={`Add ${adapter.title.toLowerCase()} scale`}
            tooltip={`Add ${adapter.title.toLowerCase()} scale`}
            onClick={handleAddGroup}
            disabled={isDisabled}
          >
            <FilePlusIcon size={13} aria-hidden="true" />
          </Button>
        </PanelHeader>

        <div className={styles.content}>
          {isDisabled ? (
            <EmptyState
              title={`${adapter.title} module is disabled.`}
              action={
                <Button variant="secondary" size="sm" onClick={adapter.onToggleDisabled}>
                  Enable
                </Button>
              }
            />
          ) : sortedGroups.length === 0 ? (
            <EmptyState
              title={`No ${adapter.title.toLowerCase()} scales yet.`}
              action={
                <Button variant="secondary" size="sm" onClick={handleAddGroup}>
                  Create scale
                </Button>
              }
            />
          ) : activeGroup ? (
            <GroupEditor<G, C>
              key={activeGroup.id}
              group={activeGroup as G}
              groups={sortedGroups as G[]}
              adapter={adapter}
              preferences={preferences}
              onContextMenu={(e) => handleTabContextMenu(activeGroup.id, e)}
              onActivateGroup={(value) => setActiveTabId(value)}
              onAddGroup={handleAddGroup}
              classGenerators={classGenerators}
            />
          ) : null}
        </div>
      </aside>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          ariaLabel={`${adapter.title} scale actions`}
          onClose={() => setContextMenu(null)}
        >
          <ContextMenuItem onClick={() => handleDuplicate(contextMenu.groupId)}>
            <span aria-hidden="true">
              <Copy2SharpIcon size={13} />
            </span>
            Duplicate
          </ContextMenuItem>
          <ContextMenuItem onClick={() => handleReset(contextMenu.groupId)}>
            <span aria-hidden="true">
              <ReloadIcon size={13} />
            </span>
            Reset to defaults
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            danger
            disabled={isFirstTab && sortedGroups.length === 1}
            onClick={() => handleDelete(contextMenu.groupId)}
          >
            <span aria-hidden="true">
              <DeleteIcon size={13} />
            </span>
            Remove
          </ContextMenuItem>
        </ContextMenu>
      )}
    </>
  )
}

// ─── Group editor ───────────────────────────────────────────────────────────

interface GroupEditorProps<G extends GroupShape, C extends GeneratorShape> {
  group: G
  /** All scale groups, sorted — needed for the in-section FilterBar tab list. */
  groups: G[]
  adapter: ScaleAdapter<G, C>
  preferences: ReturnType<typeof resolveFrameworkPreferences>
  onContextMenu: (event: MouseEvent<HTMLElement>) => void
  /** Switch the active scale (called by the FilterBar inside the Scales section). */
  onActivateGroup: (groupId: string) => void
  /** Append a new scale and switch to it. */
  onAddGroup: () => void
  classGenerators: C[]
}

function GroupEditor<G extends GroupShape, C extends GeneratorShape>({
  group,
  groups,
  adapter,
  preferences,
  onContextMenu,
  onActivateGroup,
  onAddGroup,
  classGenerators,
}: GroupEditorProps<G, C>) {
  // Split extra sections by position so we can render the 'top' ones before
  // the built-in Scales section and the 'bottom' ones after Utilities.
  const topExtraSections = adapter.extraSections?.filter((s) => s.position === 'top') ?? []
  const bottomExtraSections = adapter.extraSections?.filter((s) => s.position !== 'top') ?? []

  return (
    <div className={styles.editor}>
      {/* Top-positioned extra sections — e.g. Typography → Fonts library lives
          above the Scales section so the user encounters fonts first. */}
      {topExtraSections.map((section) => (
        <Section
          key={section.id}
          title={section.title}
          defaultOpen={section.defaultOpen ?? false}
          icon={section.icon}
        >
          <div className={styles.sectionBody}>{section.render(group)}</div>
        </Section>
      ))}

      {/* Scales section — scale picker (FilterBar), name + prefix, mode toggle,
          fluid/manual editor with chart. The scale picker lives inside the
          section because it's part of managing scales. The icon comes from
          the adapter so each panel reuses its rail icon (text-start-t /
          ruler-dimension). */}
      <Section title="Scales" defaultOpen icon={adapter.scalesSectionIcon}>
        <div className={styles.sectionBody}>
          <FilterBar<string>
            items={groups.map<FilterBarItem<string>>((g) => ({
              value: g.id,
              label: g.name,
            }))}
            value={group.id}
            onValueChange={onActivateGroup}
            groupLabel={`${adapter.title} scales`}
            inlineActions={
              <Button
                variant="ghost"
                size="xs"
                aria-label={`Add ${adapter.title.toLowerCase()} scale`}
                onClick={onAddGroup}
              >
                Add scale
              </Button>
            }
          />

          <div className={styles.tabHeading} onContextMenu={onContextMenu}>
            <Input
              fieldSize="sm"
              aria-label="Scale name"
              value={group.name}
              onChange={(event) => adapter.onUpdateGroup(group.id, { name: event.target.value })}
            />
            <Input
              fieldSize="sm"
              aria-label="Variable prefix"
              value={group.namingConvention}
              onChange={(event) =>
                adapter.onUpdateGroup(group.id, { namingConvention: event.target.value })
              }
              monospace
            />
          </div>

          <ModeToggle
            mode={group.mode}
            onChange={(mode) => adapter.onUpdateGroup(group.id, { mode })}
          />

          {group.mode === 'fluid_manual' ? (
            <ManualEditor group={group} adapter={adapter} preferences={preferences} />
          ) : (
            <FluidEditor group={group} adapter={adapter} preferences={preferences} />
          )}
        </div>
      </Section>

      {/* Utilities section — class generator (utility class patterns).
          Same icon for both panels: utility classes are CSS rules, so the
          braces icon (`{ }`) reads as "code that gets generated". */}
      <Section title="Utilities" defaultOpen icon={BracesIcon}>
        <div className={styles.sectionBody}>
          <ClassGeneratorList<C>
            groupId={group.id}
            groupNamingConvention={group.namingConvention}
            adapter={adapter as unknown as ScaleAdapter<GroupShape, C>}
            classes={classGenerators}
          />
        </div>
      </Section>

      {/* Bottom-positioned extra sections (default placement). */}
      {bottomExtraSections.map((section) => (
        <Section
          key={section.id}
          title={section.title}
          defaultOpen={section.defaultOpen ?? false}
          icon={section.icon}
        >
          <div className={styles.sectionBody}>{section.render(group)}</div>
        </Section>
      ))}
    </div>
  )
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: FrameworkScaleMode
  onChange: (mode: FrameworkScaleMode) => void
}) {
  return (
    <FilterBar<FrameworkScaleMode>
      items={[
        { value: 'fluid', label: 'Automatic' },
        { value: 'fluid_manual', label: 'Manual' },
      ]}
      value={mode}
      onValueChange={onChange}
      groupLabel="Mode"
    />
  )
}

// ─── Fluid mode editor ──────────────────────────────────────────────────────

function FluidEditor<G extends GroupShape, C extends GeneratorShape>({
  group,
  adapter,
  preferences,
}: {
  group: G
  adapter: ScaleAdapter<G, C>
  preferences: ReturnType<typeof resolveFrameworkPreferences>
}) {
  const stepLabels = useMemo(
    () => group.steps.split(',').map((s) => s.trim()).filter(Boolean),
    [group.steps],
  )
  const baseScaleIndex = Math.max(0, Math.min(group.baseScaleIndex, stepLabels.length - 1))
  const fluid = useMemo<FluidScaleStep[]>(() => {
    return computeFluidScale({
      minBaseSize: adapter.readBaseSize(group, 'min'),
      maxBaseSize: adapter.readBaseSize(group, 'max'),
      minScaleRatio: effectiveScaleRatio(
        group.min.scaleRatio,
        group.min.isCustomScaleRatio,
        group.min.scaleRatioInputValue,
      ),
      maxScaleRatio: effectiveScaleRatio(
        group.max.scaleRatio,
        group.max.isCustomScaleRatio,
        group.max.scaleRatioInputValue,
      ),
      steps: stepLabels.length,
      baseScaleIndex,
      minScreenWidth: preferences.minScreenWidth,
      maxScreenWidth: preferences.maxScreenWidth,
    })
  }, [adapter, baseScaleIndex, group, preferences.maxScreenWidth, preferences.minScreenWidth, stepLabels.length])

  // Compute the largest endpoint across the entire scale so per-step charts
  // can scale their bar widths relative to a single shared baseline.
  const largestSizeInScale = useMemo(() => {
    let max = 0
    for (const step of fluid) {
      const min = Number(step.min)
      const stepMax = Number(step.max)
      if (Number.isFinite(min) && min > max) max = min
      if (Number.isFinite(stepMax) && stepMax > max) max = stepMax
    }
    return max
  }, [fluid])

  // Build stable input IDs per group so the ControlRow `<label htmlFor>` linkage
  // points to the right field even when the user switches between groups/tabs.
  const fieldId = (key: string) => `scale-${adapter.panelId}-${group.id}-${key}`
  const baseSizeLabel = adapter.baseSizeLabel.toLowerCase()

  return (
    <div className={styles.fluidGrid}>
      <div className={styles.baseSettings}>
        <ControlRow
          propKey="min-base-size"
          inputId={fieldId('min-base-size')}
          label={`Min ${baseSizeLabel}`}
          layout="stacked"
        >
          <NumericInput
            inputId={fieldId('min-base-size')}
            value={adapter.readBaseSize(group, 'min')}
            ariaLabel={`Min ${baseSizeLabel}`}
            onChange={(next) => adapter.onUpdateGroup(group.id, adapter.patchBaseSize('min', next))}
            unit="px"
          />
        </ControlRow>
        <ControlRow
          propKey="max-base-size"
          inputId={fieldId('max-base-size')}
          label={`Max ${baseSizeLabel}`}
          layout="stacked"
        >
          <NumericInput
            inputId={fieldId('max-base-size')}
            value={adapter.readBaseSize(group, 'max')}
            ariaLabel={`Max ${baseSizeLabel}`}
            onChange={(next) => adapter.onUpdateGroup(group.id, adapter.patchBaseSize('max', next))}
            unit="px"
          />
        </ControlRow>

        <ControlRow
          propKey="min-ratio"
          inputId={fieldId('min-ratio')}
          label="Min ratio"
          layout="stacked"
          labelSuffix={
            <RatioModeToggle
              isCustom={Boolean(group.min.isCustomScaleRatio)}
              ariaLabel="Toggle custom min scale ratio"
              onToggle={() =>
                adapter.onUpdateGroup(group.id, {
                  min: {
                    ...group.min,
                    isCustomScaleRatio: !group.min.isCustomScaleRatio,
                    scaleRatioInputValue:
                      group.min.scaleRatioInputValue ?? Number(group.min.scaleRatio),
                  },
                })
              }
            />
          }
        >
          <RatioField
            inputId={fieldId('min-ratio')}
            scaleRatio={group.min.scaleRatio}
            isCustom={group.min.isCustomScaleRatio}
            customValue={group.min.scaleRatioInputValue}
            options={adapter.ratioOptions}
            ariaLabel="Min scale ratio"
            onChange={(patch) =>
              adapter.onUpdateGroup(group.id, { min: { ...group.min, ...patch } })
            }
          />
        </ControlRow>
        <ControlRow
          propKey="max-ratio"
          inputId={fieldId('max-ratio')}
          label="Max ratio"
          layout="stacked"
          labelSuffix={
            <RatioModeToggle
              isCustom={Boolean(group.max.isCustomScaleRatio)}
              ariaLabel="Toggle custom max scale ratio"
              onToggle={() =>
                adapter.onUpdateGroup(group.id, {
                  max: {
                    ...group.max,
                    isCustomScaleRatio: !group.max.isCustomScaleRatio,
                    scaleRatioInputValue:
                      group.max.scaleRatioInputValue ?? Number(group.max.scaleRatio),
                  },
                })
              }
            />
          }
        >
          <RatioField
            inputId={fieldId('max-ratio')}
            scaleRatio={group.max.scaleRatio}
            isCustom={group.max.isCustomScaleRatio}
            customValue={group.max.scaleRatioInputValue}
            options={adapter.ratioOptions}
            ariaLabel="Max scale ratio"
            onChange={(patch) =>
              adapter.onUpdateGroup(group.id, { max: { ...group.max, ...patch } })
            }
          />
        </ControlRow>

        <div className={styles.fieldRowWide}>
          <ControlRow
            propKey="base-step"
            inputId={fieldId('base-step')}
            label="Base step"
            layout="stacked"
          >
            <Select
              id={fieldId('base-step')}
              fieldSize="sm"
              aria-label="Base scale index"
              value={String(baseScaleIndex)}
              options={stepLabels.map((label, idx) => ({ value: String(idx), label }))}
              onChange={(event) =>
                adapter.onUpdateGroup(group.id, { baseScaleIndex: Number(event.currentTarget.value) })
              }
            />
          </ControlRow>
        </div>
        <div className={styles.fieldRowWide}>
          <ControlRow
            propKey="steps"
            inputId={fieldId('steps')}
            label="Steps"
            layout="stacked"
          >
            <Input
              id={fieldId('steps')}
              fieldSize="sm"
              aria-label="Step labels"
              value={group.steps}
              onChange={(event) => adapter.onUpdateGroup(group.id, { steps: event.target.value })}
              monospace
            />
          </ControlRow>
        </div>
      </div>

      {adapter.renderChart && stepLabels.length > 0 && (
        <div className={styles.streamChartHost}>
          {adapter.renderChart({
            points: fluid.map((step, idx) => ({
              stepLabel: stepLabels[idx] ?? '',
              variableName: `--${group.namingConvention}-${stepLabels[idx] ?? ''}`,
              minPx: Number(step.min),
              maxPx: Number(step.max),
              isBase: idx === baseScaleIndex,
            })),
            maxInScale: largestSizeInScale,
            baseStepIndex: baseScaleIndex,
            onPrependStep: () =>
              adapter.onUpdateGroup(group.id, {
                steps: prependStep(group.steps),
                baseScaleIndex: Math.min(baseScaleIndex + 1, stepLabels.length),
              }),
            onAppendStep: () =>
              adapter.onUpdateGroup(group.id, { steps: appendStep(group.steps) }),
            onRemoveFirstStep: () => {
              const next = stepLabels.slice(1).join(',')
              adapter.onUpdateGroup(group.id, {
                steps: next,
                baseScaleIndex: Math.max(0, baseScaleIndex - 1),
              })
            },
            onRemoveLastStep: () => {
              const next = stepLabels.slice(0, -1).join(',')
              adapter.onUpdateGroup(group.id, {
                steps: next,
                baseScaleIndex: Math.max(0, Math.min(baseScaleIndex, next.split(',').length - 1)),
              })
            },
            canRemoveStep: stepLabels.length > 1,
          })}
        </div>
      )}

      {!adapter.renderChart && (
      <div className={styles.stepList}>
        <div className={styles.stepListHeader}>
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            aria-label="Add step before"
            onClick={() =>
              adapter.onUpdateGroup(group.id, {
                steps: prependStep(group.steps),
                baseScaleIndex: Math.min(baseScaleIndex + 1, stepLabels.length),
              })
            }
          >
            <PlusIcon size={12} />
          </Button>
          <span className={styles.stepListHeaderLabel}>Steps</span>
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            aria-label="Remove first step"
            disabled={stepLabels.length <= 1}
            onClick={() => {
              const next = stepLabels.slice(1).join(',')
              adapter.onUpdateGroup(group.id, {
                steps: next,
                baseScaleIndex: Math.max(0, baseScaleIndex - 1),
              })
            }}
          >
            <MinusIcon size={12} />
          </Button>
        </div>

        <ul className={styles.steps} role="list">
          {fluid.map((step, idx) => {
            const stepLabel = stepLabels[idx] ?? ''
            const variableName = `--${group.namingConvention}-${stepLabel}`
            const previewMin = Number(step.min)
            const previewMax = Number(step.max)
            const tooltip = `${variableName} → ${declarationFromStep(step, preferences.isRem ? 'rem' : 'px', preferences.rootFontSize)}`
            const stepBody = adapter.renderStepBody?.({
              minPx: previewMin,
              maxPx: previewMax,
              maxInScale: largestSizeInScale,
              stepLabel,
              variableName,
            })
            return (
              <li
                key={`${stepLabel}-${idx}`}
                className={styles.stepRow}
                data-active={idx === baseScaleIndex ? 'true' : undefined}
              >
                <div className={styles.stepHeader}>
                  <Button
                    variant="ghost"
                    size="xs"
                    className={styles.stepName}
                    tooltip={tooltip}
                    aria-label={`Copy ${variableName}`}
                    onClick={() => copyToClipboard(`var(${variableName})`)}
                  >
                    {variableName}
                  </Button>
                  <span className={styles.stepHeaderMeta}>
                    {step.min} / {step.max} px
                  </span>
                </div>
                {stepBody !== undefined ? (
                  stepBody
                ) : (
                  <div className={styles.stepBreakpoints}>
                    <div className={styles.stepPreviewCol}>
                      <span className={styles.stepNumeric}>{step.min}px</span>
                      <span className={styles.stepPreviewSlot}>
                        {adapter.renderPreview(previewMin)}
                      </span>
                    </div>
                    <div className={styles.stepPreviewCol}>
                      <span className={styles.stepNumeric}>{step.max}px</span>
                      <span className={styles.stepPreviewSlot}>
                        {adapter.renderPreview(previewMax)}
                      </span>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        {adapter.chartLegend && (
          <div className={styles.chartLegend}>{adapter.chartLegend}</div>
        )}

        <div className={styles.stepListFooter}>
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            aria-label="Add step after"
            onClick={() =>
              adapter.onUpdateGroup(group.id, {
                steps: appendStep(group.steps),
              })
            }
          >
            <PlusIcon size={12} />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            aria-label="Remove last step"
            disabled={stepLabels.length <= 1}
            onClick={() => {
              const next = stepLabels.slice(0, -1).join(',')
              adapter.onUpdateGroup(group.id, {
                steps: next,
                baseScaleIndex: Math.max(0, Math.min(baseScaleIndex, next.split(',').length - 1)),
              })
            }}
          >
            <MinusIcon size={12} />
          </Button>
        </div>
      </div>
      )}
    </div>
  )
}

function ManualEditor<G extends GroupShape, C extends GeneratorShape>({
  group,
  adapter,
}: {
  group: G
  adapter: ScaleAdapter<G, C>
  preferences: ReturnType<typeof resolveFrameworkPreferences>
}) {
  const items = group.manualSizes ?? []
  return (
    <div className={styles.manualList}>
      {items.length === 0 ? (
        <EmptyState plain compact title="No manual sizes yet." />
      ) : (
        items.map((size) => (
          <div key={size.id} className={styles.manualRow}>
            <Input
              fieldSize="sm"
              aria-label="Variable name"
              value={size.name}
              onChange={(event) =>
                adapter.onUpsertManualSize(group.id, size.id, { name: event.target.value })
              }
              monospace
            />
            <NumericInput
              value={size.min}
              ariaLabel="Min size"
              onChange={(next) => adapter.onUpsertManualSize(group.id, size.id, { min: next })}
              unit="px"
            />
            <NumericInput
              value={size.max}
              ariaLabel="Max size"
              onChange={(next) => adapter.onUpsertManualSize(group.id, size.id, { max: next })}
              unit="px"
            />
          </div>
        ))
      )}
    </div>
  )
}

// ─── Class Generator list ───────────────────────────────────────────────────

function ClassGeneratorList<C extends GeneratorShape>({
  groupId,
  groupNamingConvention,
  adapter,
  classes,
}: {
  groupId: string
  groupNamingConvention: string
  adapter: ScaleAdapter<GroupShape, C>
  classes: C[]
}) {
  const localClasses = useMemo(() => classes.filter((c) => c.tabId === groupId), [classes, groupId])

  function patchClasses(next: C[]) {
    // Replace just the rows belonging to this group; preserve other groups'.
    const others = classes.filter((c) => c.tabId !== groupId)
    adapter.onSetClassGenerators([...others, ...next])
  }

  function handleAdd() {
    const fresh = {
      id: cryptoRandomId(),
      name: `${groupNamingConvention}-*`,
      property: [adapter.classGeneratorProperties[0]?.value ?? ''],
      tabId: groupId,
    } as unknown as C
    patchClasses([...localClasses, fresh])
  }

  function handlePatch(id: string, patch: Partial<C>) {
    patchClasses(localClasses.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  function handleDelete(id: string) {
    patchClasses(localClasses.filter((c) => c.id !== id))
  }

  return (
    <div className={styles.classGenerator} aria-label="Class generator">
      <header className={styles.classGeneratorHeader}>
        <Button variant="ghost" size="xs" onClick={handleAdd}>
          Add class
        </Button>
      </header>
      <div className={styles.classGeneratorRows}>
        {localClasses.length === 0 ? (
          <EmptyState
            plain
            compact
            title="No utility classes generated for this scale."
          />
        ) : (
          localClasses.map((generator) => (
            <div className={styles.classGeneratorRow} key={generator.id}>
              <Input
                fieldSize="sm"
                aria-label="Class pattern"
                value={generator.name}
                onChange={(event) => handlePatch(generator.id, { name: event.target.value } as Partial<C>)}
                monospace
              />
              <Select
                fieldSize="sm"
                aria-label="CSS property"
                value={generator.property[0] ?? ''}
                options={adapter.classGeneratorProperties.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
                onChange={(event) =>
                  handlePatch(generator.id, {
                    property: [event.currentTarget.value],
                  } as Partial<C>)
                }
              />
              <Switch
                checked={generator.isDisabled !== true}
                onCheckedChange={(checked) =>
                  handlePatch(generator.id, { isDisabled: !checked } as Partial<C>)
                }
                switchSize="sm"
                aria-label="Enabled"
              />
              <Button
                variant="ghost"
                size="xs"
                iconOnly
                aria-label="Delete class"
                onClick={() => handleDelete(generator.id)}
              >
                <DeleteIcon size={12} />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ─── Utility components / helpers ───────────────────────────────────────────

function NumericInput({
  value,
  onChange,
  ariaLabel,
  unit,
  inputId,
}: {
  value: number
  onChange: (next: number) => void
  ariaLabel: string
  unit?: string
  inputId?: string
}) {
  // Input now owns the unit + spinner affordances internally. We just pass
  // them through; the value-stepping spinner buttons replace the native
  // browser arrows automatically.
  return (
    <Input
      id={inputId}
      fieldSize="sm"
      aria-label={ariaLabel}
      type="number"
      step="0.1"
      unit={unit}
      value={Number.isFinite(value) ? String(value) : ''}
      onChange={(event) => {
        const next = Number(event.target.value)
        if (Number.isFinite(next)) onChange(next)
      }}
    />
  )
}

/**
 * Renders just the input — Select for preset ratios, NumericInput when the
 * "use custom" mode is on. The toggle that flips between modes lives next
 * to the field's *label* (passed to ControlRow's labelSuffix slot) so it
 * never eats horizontal space inside the input row.
 */
function RatioField({
  scaleRatio,
  isCustom,
  customValue,
  options,
  ariaLabel,
  onChange,
  inputId,
}: {
  scaleRatio: number | string
  isCustom?: boolean
  customValue?: number
  options: ReadonlyArray<{ value: string; label: string }>
  ariaLabel: string
  inputId?: string
  onChange: (patch: {
    scaleRatio?: number | string
    isCustomScaleRatio?: boolean
    scaleRatioInputValue?: number
  }) => void
}) {
  if (isCustom) {
    return (
      <NumericInput
        inputId={inputId}
        value={customValue ?? Number(scaleRatio)}
        ariaLabel={`Custom ${ariaLabel.toLowerCase()}`}
        onChange={(next) => onChange({ scaleRatioInputValue: next })}
      />
    )
  }
  return (
    <Select
      id={inputId}
      fieldSize="sm"
      aria-label={ariaLabel}
      value={String(scaleRatio)}
      options={options.map((option) => ({ value: option.value, label: option.label }))}
      onChange={(event) => onChange({ scaleRatio: Number(event.currentTarget.value) })}
    />
  )
}

/**
 * Compact "switch the ratio field between preset list and custom number"
 * toggle. Designed to sit in the labelSuffix slot of a ControlRow so it
 * never competes with the input for horizontal space.
 */
function RatioModeToggle({
  isCustom,
  ariaLabel,
  onToggle,
}: {
  isCustom: boolean
  ariaLabel: string
  onToggle: () => void
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      iconOnly
      className={styles.ratioToggle}
      aria-label={ariaLabel}
      tooltip={isCustom ? 'Choose preset ratio' : 'Enter custom ratio'}
      pressed={isCustom}
      onClick={onToggle}
    >
      <EditIcon size={11} aria-hidden="true" />
    </Button>
  )
}

function copyToClipboard(value: string) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return
  void navigator.clipboard.writeText(value).catch(() => {})
}

function appendStep(steps: string): string {
  const arr = steps.split(',').filter(Boolean)
  const last = arr[arr.length - 1] ?? 'm'
  const sized = nextSizeAfter(last)
  return [...arr, sized].join(',')
}

function prependStep(steps: string): string {
  const arr = steps.split(',').filter(Boolean)
  const first = arr[0] ?? 'm'
  const sized = nextSizeBefore(first)
  return [sized, ...arr].join(',')
}

const SIZE_RING = ['25xs', '24xs', '23xs', '22xs', '21xs', '20xs', '19xs', '18xs', '17xs', '16xs',
  '15xs', '14xs', '13xs', '12xs', '11xs', '10xs', '9xs', '8xs', '7xs', '6xs',
  '5xs', '4xs', '3xs', '2xs', 'xs', 's', 'm', 'l', 'xl', '2xl', '3xl', '4xl',
  '5xl', '6xl', '7xl', '8xl', '9xl', '10xl', '11xl', '12xl', '13xl', '14xl',
  '15xl', '16xl', '17xl', '18xl', '19xl', '20xl', '21xl', '22xl', '23xl',
  '24xl', '25xl']

function nextSizeAfter(label: string): string {
  const idx = SIZE_RING.indexOf(label)
  return SIZE_RING[Math.min(idx + 1, SIZE_RING.length - 1)] ?? `${label}+`
}

function nextSizeBefore(label: string): string {
  const idx = SIZE_RING.indexOf(label)
  return SIZE_RING[Math.max(idx - 1, 0)] ?? `pre-${label}`
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2, 10)
}
