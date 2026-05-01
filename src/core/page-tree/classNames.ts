import type { CSSClass } from './types'

export type ClassRegistry = Record<string, CSSClass> | null | undefined

const ASCII_WHITESPACE_RE = /[\t\n\f\r ]/
const CONTROL_CHAR_RE = /[\0-\x1f\x7f]/

export function validateCssClassName(name: string): string | null {
  if (name.length === 0) return 'Class name is required'
  if (name.trim() !== name) return 'Class names cannot start or end with whitespace'
  if (ASCII_WHITESPACE_RE.test(name)) return 'Class names cannot contain whitespace'
  if (CONTROL_CHAR_RE.test(name)) return 'Class names cannot contain control characters'
  return null
}

export function assertValidCssClassName(name: string): void {
  const error = validateCssClassName(name)
  if (error) throw new Error(`[classSlice] ${error}`)
}

export function escapeCssIdentifier(value: string): string {
  let escaped = ''

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    const char = value.charAt(index)

    if (
      (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
      codeUnit === 0x007f ||
      (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (
        index === 1 &&
        codeUnit >= 0x0030 &&
        codeUnit <= 0x0039 &&
        value.charCodeAt(0) === 0x002d
      )
    ) {
      escaped += `\\${codeUnit.toString(16)} `
      continue
    }

    if (index === 0 && codeUnit === 0x002d && value.length === 1) {
      escaped += '\\-'
      continue
    }

    if (
      codeUnit >= 0x0080 ||
      codeUnit === 0x002d ||
      codeUnit === 0x005f ||
      (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
      (codeUnit >= 0x0061 && codeUnit <= 0x007a)
    ) {
      escaped += char
      continue
    }

    escaped += `\\${char}`
  }

  return escaped
}

export function cssClassSelector(cls: Pick<CSSClass, 'name'>): string {
  return `.${escapeCssIdentifier(cls.name)}`
}

export function classNameForClassId(
  classes: ClassRegistry,
  classId: string,
): string | null {
  return classes?.[classId]?.name ?? null
}

export function classNamesForClassIds(
  classes: ClassRegistry,
  classIds: readonly string[] | undefined,
): string[] {
  if (!classes || !classIds?.length) return []

  const names: string[] = []
  for (const id of classIds) {
    const name = classNameForClassId(classes, id)
    if (name) names.push(name)
  }
  return names
}
