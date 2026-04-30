import type { ModuleStyleBinding, PropertyControl } from '../../core/module-engine/types'
import type { CSSPropertyBag } from '../../core/page-tree/types'

type CSSValue = string | number

function getValue(styles: Partial<CSSPropertyBag>, property: keyof CSSPropertyBag): CSSValue | undefined {
  return styles[property] as CSSValue | undefined
}

export function toPx(value: unknown): string {
  const num = Number(value)
  return `${Number.isFinite(num) ? num : 0}px`
}

export function toCssLength(value: unknown, fallback: string | number): string {
  const fallbackValue = typeof fallback === 'number' ? `${fallback}px` : fallback
  const text = String(value ?? '').trim()
  if (!text) return fallbackValue
  return /^-?(?:\d+|\d*\.\d+)$/.test(text) ? `${text}px` : text
}

export function readNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number') return value
  const parsed = parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

export function rawBinding(
  property: keyof CSSPropertyBag,
  control: PropertyControl,
  defaultValue: CSSValue,
): ModuleStyleBinding {
  return {
    properties: [property],
    control,
    defaultValue,
    toCSS: (value) => ({ [property]: value as never }),
    fromCSS: (styles) => getValue(styles, property) ?? defaultValue,
  }
}

export function pxBinding(
  property: keyof CSSPropertyBag,
  control: PropertyControl,
  defaultValue: number,
): ModuleStyleBinding {
  const defaultCssValue = toCssLength(defaultValue, '0px')
  return {
    properties: [property],
    control,
    defaultValue: defaultCssValue,
    toCSS: (value) => ({ [property]: toCssLength(value, defaultCssValue) as never }),
    fromCSS: (styles) => String(getValue(styles, property) ?? defaultCssValue),
  }
}

export function numberBinding(
  property: keyof CSSPropertyBag,
  control: PropertyControl,
  defaultValue: number,
): ModuleStyleBinding {
  return {
    properties: [property],
    control,
    defaultValue,
    toCSS: (value) => ({ [property]: Number(value) as never }),
    fromCSS: (styles) => readNumber(getValue(styles, property), defaultValue),
  }
}

export function unitlessStringBinding(
  property: keyof CSSPropertyBag,
  control: PropertyControl,
  defaultValue: number,
): ModuleStyleBinding {
  const defaultCssValue = String(defaultValue)
  return {
    properties: [property],
    control,
    defaultValue: defaultCssValue,
    toCSS: (value) => ({ [property]: String(value ?? defaultCssValue) as never }),
    fromCSS: (styles) => String(getValue(styles, property) ?? defaultCssValue),
  }
}
