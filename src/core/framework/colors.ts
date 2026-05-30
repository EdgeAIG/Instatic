import type { StyleRule, CSSPropertyBag } from '@core/page-tree'
import { classKindSelector } from '@core/page-tree'
import type {
  FrameworkColorSettings,
  FrameworkColorToken,
  FrameworkColorUtilityType,
} from './schemas'
import { formatCssVariableBlock } from './cssVariables'

export type {
  FrameworkColorSettings,
  FrameworkColorUtilityType,
} from './schemas'

export interface FrameworkColorVariable {
  name: string
  value: string
  tokenId: string
  slug: string
  variantId: string
  variantName?: string
}

export interface FrameworkColorVariableSets {
  light: FrameworkColorVariable[]
  dark: FrameworkColorVariable[]
}

interface ColorChannels {
  h: number
  s: number
  l: number
  a: number
}

interface FrameworkColorVariant {
  id: string
  suffix: string
  variantName?: string
  variableName: (slug: string) => string
  value: (base: string) => string
}

const TRANSPARENT_STEPS = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90] as const
const UTILITY_ORDER: FrameworkColorUtilityType[] = ['text', 'background', 'border', 'fill']
const HSLA_RE = /^hsla?\(\s*([-+]?\d*\.?\d+)(?:deg)?\s*,\s*([-+]?\d*\.?\d+)%\s*,\s*([-+]?\d*\.?\d+)%(?:\s*,\s*([-+]?\d*\.?\d+))?\s*\)$/i
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

export function normalizeFrameworkColorSlug(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/^--+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'color'
}

export function generateFrameworkColorVariableSets(
  settings: FrameworkColorSettings | null | undefined,
): FrameworkColorVariableSets {
  if (!settings) return { light: [], dark: [] }

  const light: FrameworkColorVariable[] = []
  const dark: FrameworkColorVariable[] = []

  for (const token of orderedTokens(settings)) {
    const slug = normalizeFrameworkColorSlug(token.slug)
    const variants = buildColorVariants(token)
    for (const variant of variants) {
      light.push(toVariable(token, slug, variant, token.lightValue))
      if (token.darkModeEnabled) {
        dark.push(toVariable(token, slug, variant, token.darkValue))
      }
    }
  }

  return { light, dark }
}

export function generateFrameworkColorRootCss(
  settings: FrameworkColorSettings | null | undefined,
): string {
  const sets = generateFrameworkColorVariableSets(settings)
  return [
    formatCssVariableBlock(':root', sets.light),
    formatFrameworkColorThemeCss(sets),
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function formatFrameworkColorThemeCss(sets: FrameworkColorVariableSets): string {
  if (sets.dark.length === 0) return ''

  return [
    sets.light.length > 0
      ? formatCssVariableBlock(DEFAULT_THEME_OVERRIDE_SELECTOR, sets.light)
      : '',
    formatCssVariableBlock(ALT_THEME_SELECTOR, sets.dark),
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function generateDefaultDarkColor(lightValue: string): string {
  return shiftLightness(lightValue, 1, 1, 'shade')
}

export function generateFrameworkColorUtilityClasses(
  settings: FrameworkColorSettings | null | undefined,
): Record<string, StyleRule> {
  const classes: Record<string, StyleRule> = {}
  if (!settings) return classes

  for (const token of orderedTokens(settings)) {
    const slug = normalizeFrameworkColorSlug(token.slug)
    const variants = buildColorVariants(token)
    for (const variant of variants) {
      const tokenName = variant.suffix ? `${slug}-${variant.suffix}` : slug
      const variableRef = `var(${variant.variableName(slug)})`
      for (const utility of UTILITY_ORDER) {
        if (!token.generateUtilities[utility]) continue
        const id = frameworkColorClassId(token.id, variant.id, utility)
        const now = token.updatedAt || token.createdAt || 0
        const name = utilityClassName(utility, tokenName)
        classes[id] = {
          id,
          name,
          kind: 'class',
          selector: classKindSelector(name),
          order: 0,
          styles: utilityStyles(utility, variableRef),
          contextStyles: {},
          generated: {
            origin: 'framework',
            family: 'color',
            sourceId: token.id,
            utility,
            tokenName: slug,
            variantName: variant.variantName,
            locked: true,
          },
          tags: ['framework', 'utility', 'color'],
          createdAt: token.createdAt || now,
          updatedAt: now,
        }
      }
    }
  }

  return classes
}

export function frameworkColorClassId(
  tokenId: string,
  variantId: string,
  utility: FrameworkColorUtilityType,
): string {
  return `framework:color:${tokenId}:${variantId}:${utility}`
}

function orderedTokens(settings: FrameworkColorSettings): FrameworkColorToken[] {
  return [...settings.tokens].sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug))
}

function toVariable(
  token: FrameworkColorToken,
  slug: string,
  variant: FrameworkColorVariant,
  baseValue: string,
): FrameworkColorVariable {
  return {
    name: variant.variableName(slug),
    value: variant.value(baseValue),
    tokenId: token.id,
    slug,
    variantId: variant.id,
    variantName: variant.variantName,
  }
}

function buildColorVariants(token: FrameworkColorToken): FrameworkColorVariant[] {
  const variants: FrameworkColorVariant[] = [
    {
      id: 'base',
      suffix: '',
      variableName: (slug) => `--${slug}`,
      value: (base) => normalizeColorValue(base),
    },
  ]

  if (token.generateTransparent) {
    for (const step of TRANSPARENT_STEPS) {
      variants.push({
        id: `transparent-${step}`,
        suffix: String(step),
        variantName: String(step),
        variableName: (slug) => `--${slug}-${step}`,
        value: (base) => withAlpha(base, step / 100),
      })
    }
  }

  if (token.generateShades.enabled) {
    const count = clampVariantCount(token.generateShades.count)
    for (let index = 1; index <= count; index += 1) {
      variants.push({
        id: `shade-${index}`,
        suffix: `d-${index}`,
        variantName: `d-${index}`,
        variableName: (slug) => `--${slug}-d-${index}`,
        value: (base) => shiftLightness(base, index, count, 'shade'),
      })
    }
  }

  if (token.generateTints.enabled) {
    const count = clampVariantCount(token.generateTints.count)
    for (let index = 1; index <= count; index += 1) {
      variants.push({
        id: `tint-${index}`,
        suffix: `l-${index}`,
        variantName: `l-${index}`,
        variableName: (slug) => `--${slug}-l-${index}`,
        value: (base) => shiftLightness(base, index, count, 'tint'),
      })
    }
  }

  return variants
}

function clampVariantCount(count: number): number {
  return Math.max(0, Math.min(12, Math.floor(count)))
}

function utilityClassName(utility: FrameworkColorUtilityType, tokenName: string): string {
  switch (utility) {
    case 'text':
      return `text-${tokenName}`
    case 'background':
      return `bg-${tokenName}`
    case 'border':
      return `border-${tokenName}`
    case 'fill':
      return `fill-${tokenName}`
  }
}

function utilityStyles(
  utility: FrameworkColorUtilityType,
  value: string,
): Partial<CSSPropertyBag> {
  switch (utility) {
    case 'text':
      return { color: value }
    case 'background':
      return { backgroundColor: value }
    case 'border':
      return { borderColor: value }
    case 'fill':
      return { fill: value }
  }
}

function normalizeColorValue(value: string): string {
  const channels = parseColor(value)
  return channels ? formatHsla(channels) : value.trim()
}

function withAlpha(value: string, alpha: number): string {
  const channels = parseColor(value)
  if (!channels) return value.trim()
  return formatHsla({ ...channels, a: alpha })
}

function shiftLightness(
  value: string,
  index: number,
  count: number,
  mode: 'shade' | 'tint',
): string {
  const channels = parseColor(value)
  if (!channels) return value.trim()
  const ratio = index / (count + 1)
  const nextLightness = mode === 'shade'
    ? channels.l * (1 - ratio * 0.8)
    : channels.l + (100 - channels.l) * ratio * 0.8
  return formatHsla({ ...channels, l: nextLightness })
}

function parseColor(value: string): ColorChannels | null {
  const input = value.trim()
  const hslaMatch = input.match(HSLA_RE)
  if (hslaMatch) {
    return {
      h: normalizeHue(Number(hslaMatch[1])),
      s: clamp(Number(hslaMatch[2]), 0, 100),
      l: clamp(Number(hslaMatch[3]), 0, 100),
      a: hslaMatch[4] === undefined ? 1 : clamp(Number(hslaMatch[4]), 0, 1),
    }
  }

  const hexMatch = input.match(HEX_RE)
  if (hexMatch) {
    return rgbToHsl(...hexToRgb(hexMatch[1]))
  }

  return null
}

function hexToRgb(hex: string): [number, number, number] {
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16)
    const g = parseInt(hex[1] + hex[1], 16)
    const b = parseInt(hex[2] + hex[2], 16)
    return [r, g, b]
  }
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ]
}

function rgbToHsl(r: number, g: number, b: number): ColorChannels {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) {
    return { h: 0, s: 0, l: l * 100, a: 1 }
  }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === rn
      ? (gn - bn) / d + (gn < bn ? 6 : 0)
      : max === gn
        ? (bn - rn) / d + 2
        : (rn - gn) / d + 4
  return { h: h * 60, s: s * 100, l: l * 100, a: 1 }
}

function formatHsla({ h, s, l, a }: ColorChannels): string {
  return `hsla(${formatNumber(normalizeHue(h))}, ${formatNumber(clamp(s, 0, 100))}%, ${formatNumber(clamp(l, 0, 100))}%, ${formatNumber(clamp(a, 0, 1))})`
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}

function normalizeHue(value: number): number {
  return ((value % 360) + 360) % 360
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

const DEFAULT_THEME_OVERRIDE_SELECTOR = [
  ':root.theme-alt .theme-inverted',
  ':root.theme-alt .theme-always-default',
  ':root.theme-default .theme-inverted .theme-always-default',
].join(',\n')

const ALT_THEME_SELECTOR = [
  ':root.theme-alt',
  ':root.theme-default .theme-inverted',
  ':root.theme-default .theme-always-alt',
  ':root.theme-alt .theme-inverted .theme-always-alt',
].join(',\n')
