import { isUserVisibleClass } from '@core/page-tree/classUtils'
import type { CSSClass, SiteDocument } from '@core/page-tree/types'

export function getReusableClasses(classes: Record<string, CSSClass>): CSSClass[] {
  return Object.values(classes).filter(isUserVisibleClass)
}

export function getSelectorUsage(site: SiteDocument | null, classId: string): number {
  if (!site) return 0

  let count = 0
  for (const page of site.pages) {
    for (const node of Object.values(page.nodes)) {
      if (node.classIds?.includes(classId)) {
        count += 1
      }
    }
  }
  return count
}

export function formatSelectorUsage(count: number): string {
  if (count === 0) return 'Unused'
  return count === 1 ? 'Used 1 time' : `Used ${count} times`
}

export function getSelectorStyleSummary(cls: CSSClass): string {
  const propCount = Object.values(cls.styles).filter(hasStyleValue).length
  const breakpointCount = Object.values(cls.breakpointStyles).filter((styles) =>
    Object.values(styles).some(hasStyleValue),
  ).length

  if (propCount === 0 && breakpointCount === 0) return 'No styles'
  if (breakpointCount === 0) return propCount === 1 ? '1 prop' : `${propCount} props`
  const propsLabel = propCount === 1 ? '1 prop' : `${propCount} props`
  const bpLabel = breakpointCount === 1 ? '1 breakpoint' : `${breakpointCount} breakpoints`
  return `${propsLabel} · ${bpLabel}`
}

function hasStyleValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}
