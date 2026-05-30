/**
 * Shared engine that turns a "framework scale" configuration (typography OR
 * spacing) into:
 *   - the flat list of CSS custom properties at `:root`,
 *   - the rendered `:root { … }` block,
 *   - the per-step utility classes (e.g. `.text-xs`, `.padding-m`, …).
 *
 * Typography and spacing are sister modules: the math, the variable-naming
 * convention, the `mode === 'fluid_manual'` branch, the class-pattern
 * expansion (`*` and `{step}`) — all identical. The only differences are:
 *
 *   - the per-group base size lives at `group.min.size` for spacing and
 *     `group.min.fontSize` for typography (`getMinBaseSize` / `getMaxBaseSize`),
 *   - the CSS property whitelist (`propertyKeymap`),
 *   - the class id prefix and the `family` discriminator in
 *     `GeneratedClassMetadata`,
 *   - the `tags` array on the emitted `StyleRule`.
 *
 * Both `framework/typography.ts` and `framework/spacing.ts` are now thin
 * adapters that call this factory with their type-specific extractors.
 */

import type { StyleRule, CSSPropertyBag } from '@core/page-tree'
import { classKindSelector } from '@core/page-tree'
import type { FrameworkScaleManualSize, FrameworkScaleMode } from './schemas'
import {
  computeFluidScale,
  convertToVariableDeclarationName,
  declarationFromStep,
  effectiveScaleRatio,
  type FrameworkPreferences,
  getVariableName,
  manualSizeVariableName,
} from './scale'
import { formatCssVariableBlock } from './cssVariables'

// ---------------------------------------------------------------------------
// Public types — shared between typography and spacing
// ---------------------------------------------------------------------------

type FrameworkScaleFamily = 'spacing' | 'typography'

/** Output shape — same for typography and spacing. */
export interface FrameworkScaleVariable {
  name: string
  value: string
  groupId: string
  groupName: string
  /** Step suffix as it appears in the user-defined `steps` string ("xs", "m"…). */
  step: string
  /** Manual sizes have an arbitrary CSS-safe name instead of a step. */
  manualName?: string
}

type FrameworkStyleTarget = keyof CSSPropertyBag | readonly (keyof CSSPropertyBag)[]

// ---------------------------------------------------------------------------
// Generic shape of a framework scale group / settings — what the factory
// actually needs to do its work, irrespective of family.
// ---------------------------------------------------------------------------

interface FrameworkScaleGroupCommon {
  id: string
  name: string
  namingConvention: string
  steps: string
  baseScaleIndex: number
  mode: FrameworkScaleMode
  manualSizes?: FrameworkScaleManualSize[]
  isDisabled?: boolean
  order: number
  updatedAt: number
}

interface FrameworkScaleSettingsCommon<TGroup, TGenerator> {
  groups: TGroup[]
  classes?: TGenerator[]
  isDisabled?: boolean
}

interface FrameworkClassGeneratorCommon {
  id: string
  name: string
  property: string[]
  tabId: string
  isDisabled?: boolean
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

interface FrameworkScaleModuleConfig<TGroup extends FrameworkScaleGroupCommon> {
  family: FrameworkScaleFamily
  /** Reads the per-breakpoint base size off a group (`size` for spacing, `fontSize` for typography). */
  getMinBaseSize: (group: TGroup) => number
  getMaxBaseSize: (group: TGroup) => number
  /** Per-breakpoint extractor for the scale ratio (lives on `min`/`max` for both families). */
  getMinScaleConfig: (group: TGroup) => {
    scaleRatio: number | string
    isCustomScaleRatio?: boolean
    scaleRatioInputValue?: number
  }
  getMaxScaleConfig: (group: TGroup) => {
    scaleRatio: number | string
    isCustomScaleRatio?: boolean
    scaleRatioInputValue?: number
  }
  /** Maps CSS property tokens (`font-size`, `padding`, …) to `CSSPropertyBag` keys. */
  propertyKeymap: Record<string, FrameworkStyleTarget>
  /** Tags applied to every generated `StyleRule` — e.g. `['framework', 'utility', 'spacing']`. */
  classTags: string[]
}

export interface FrameworkScaleModule<
  TGroup extends FrameworkScaleGroupCommon,
  TGenerator extends FrameworkClassGeneratorCommon,
> {
  generateVariables(
    settings: FrameworkScaleSettingsCommon<TGroup, TGenerator> | null | undefined,
    preferences: FrameworkPreferences,
  ): FrameworkScaleVariable[]
  generateRootCss(
    settings: FrameworkScaleSettingsCommon<TGroup, TGenerator> | null | undefined,
    preferences: FrameworkPreferences,
  ): string
  generateUtilityClasses(
    settings: FrameworkScaleSettingsCommon<TGroup, TGenerator> | null | undefined,
  ): Record<string, StyleRule>
}

export function createFrameworkScaleModule<
  TGroup extends FrameworkScaleGroupCommon,
  TGenerator extends FrameworkClassGeneratorCommon,
>(config: FrameworkScaleModuleConfig<TGroup>): FrameworkScaleModule<TGroup, TGenerator> {
  const {
    family,
    getMinBaseSize,
    getMaxBaseSize,
    getMinScaleConfig,
    getMaxScaleConfig,
    propertyKeymap,
    classTags,
  } = config

  function fluidVariables(
    group: TGroup,
    preferences: FrameworkPreferences,
    targetUnit: 'px' | 'rem',
  ): FrameworkScaleVariable[] {
    const stepLabels = stepLabelsForGroup(group)
    const min = getMinScaleConfig(group)
    const max = getMaxScaleConfig(group)
    const minRatio = effectiveScaleRatio(min.scaleRatio, min.isCustomScaleRatio, min.scaleRatioInputValue)
    const maxRatio = effectiveScaleRatio(max.scaleRatio, max.isCustomScaleRatio, max.scaleRatioInputValue)

    const fluidSteps = computeFluidScale({
      minBaseSize: Number(getMinBaseSize(group)),
      maxBaseSize: Number(getMaxBaseSize(group)),
      minScaleRatio: minRatio,
      maxScaleRatio: maxRatio,
      steps: stepLabels.length,
      baseScaleIndex: group.baseScaleIndex,
      minScreenWidth: preferences.minScreenWidth,
      maxScreenWidth: preferences.maxScreenWidth,
    })

    return fluidSteps.map((step, idx) => {
      const stepLabel = stepLabels[idx]
      return {
        name: getVariableName(group.namingConvention, stepLabel),
        value: declarationFromStep(step, targetUnit, preferences.rootFontSize),
        groupId: group.id,
        groupName: group.name,
        step: stepLabel,
      }
    })
  }

  function manualVariables(
    group: TGroup,
    preferences: FrameworkPreferences,
    targetUnit: 'px' | 'rem',
  ): FrameworkScaleVariable[] {
    const items = group.manualSizes ?? []
    const stepLabels = stepLabelsForGroup(group)
    return items.map((size, idx) => {
      const fluid = computeFluidScale({
        minBaseSize: Number(size.min),
        maxBaseSize: Number(size.max),
        minScaleRatio: 1,
        maxScaleRatio: 1,
        steps: 1,
        baseScaleIndex: 0,
        minScreenWidth: preferences.minScreenWidth,
        maxScreenWidth: preferences.maxScreenWidth,
      })[0]
      return {
        name: convertToVariableDeclarationName(manualSizeVariableName(size.name)),
        value: declarationFromStep(fluid, targetUnit, preferences.rootFontSize),
        groupId: group.id,
        groupName: group.name,
        step: stepLabels[idx] ?? size.name,
        manualName: size.name,
      }
    })
  }

  function generateVariables(
    settings: FrameworkScaleSettingsCommon<TGroup, TGenerator> | null | undefined,
    preferences: FrameworkPreferences,
  ): FrameworkScaleVariable[] {
    if (!settings || settings.isDisabled) return []
    const targetUnit = preferences.isRem ? 'rem' : 'px'
    const variables: FrameworkScaleVariable[] = []

    for (const group of orderedGroups(settings.groups)) {
      if (group.isDisabled) continue
      if (group.mode === 'fluid_manual') {
        variables.push(...manualVariables(group, preferences, targetUnit))
      } else {
        variables.push(...fluidVariables(group, preferences, targetUnit))
      }
    }

    return variables
  }

  function generateRootCss(
    settings: FrameworkScaleSettingsCommon<TGroup, TGenerator> | null | undefined,
    preferences: FrameworkPreferences,
  ): string {
    const variables = generateVariables(settings, preferences)
    return formatCssVariableBlock(':root', variables)
  }

  function generateUtilityClasses(
    settings: FrameworkScaleSettingsCommon<TGroup, TGenerator> | null | undefined,
  ): Record<string, StyleRule> {
    const classes: Record<string, StyleRule> = {}
    if (!settings || settings.isDisabled) return classes

    const groupsById = new Map(settings.groups.map((g) => [g.id, g]))
    const generators = settings.classes ?? []

    for (const generator of generators) {
      if (generator.isDisabled) continue
      if (!generator.tabId) continue
      const group = groupsById.get(generator.tabId)
      if (!group || group.isDisabled) continue

      const stepLabels = stepLabelsForGroup(group)
      for (let stepIdx = 0; stepIdx < stepLabels.length; stepIdx += 1) {
        const step = stepLabels[stepIdx]
        const className = expandClassPattern(generator.name, step)
        if (!className) continue

        const variableName =
          group.mode === 'fluid_manual'
            ? convertToVariableDeclarationName(
                manualSizeVariableName(
                  group.manualSizes?.[stepIdx]?.name ?? `${group.namingConvention}-${step}`,
                ),
              )
            : getVariableName(group.namingConvention, step)

        const styles = buildUtilityStyles(propertyKeymap, generator.property, `var(${variableName})`)
        const id = `framework:${family}:${group.id}:${generator.id}:${step}`
        const now = group.updatedAt || Date.now()
        classes[id] = {
          id,
          name: className,
          kind: 'class',
          selector: classKindSelector(className),
          order: 0,
          styles,
          contextStyles: {},
          generated: {
            origin: 'framework',
            family,
            sourceId: group.id,
            generatorId: generator.id,
            tokenName: group.namingConvention,
            step,
            locked: true,
          },
          tags: classTags,
          createdAt: now,
          updatedAt: now,
        }
      }
    }

    return classes
  }

  return { generateVariables, generateRootCss, generateUtilityClasses }
}

// ---------------------------------------------------------------------------
// Internals — independent of family
// ---------------------------------------------------------------------------

function orderedGroups<T extends { order: number }>(groups: T[]): T[] {
  return [...groups].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

function stepLabelsForGroup(group: { steps: string }): string[] {
  return group.steps
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function expandClassPattern(pattern: string, step: string): string {
  const trimmed = pattern.trim().replace(/^\./, '')
  if (!trimmed) return ''
  return trimmed.includes('*')
    ? trimmed.replace('*', step)
    : trimmed.replace('{step}', step) === trimmed
      ? `${trimmed}-${step}`
      : trimmed.replace('{step}', step)
}

function buildUtilityStyles(
  keymap: Record<string, FrameworkStyleTarget>,
  properties: string[],
  value: string,
): Partial<CSSPropertyBag> {
  const styles: Partial<CSSPropertyBag> = {}
  for (const property of properties) {
    const target = keymap[property] ?? toCamelCase(property)
    const keys = Array.isArray(target) ? target : [target]
    for (const key of keys) {
      if (!key) continue
      ;(styles as Record<string, string>)[key] = value
    }
  }
  return styles
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
}
