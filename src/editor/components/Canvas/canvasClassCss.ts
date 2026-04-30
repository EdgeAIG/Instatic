import { bagToCSS } from '../../../core/publisher/classCss'
import type { CSSClass } from '../../../core/page-tree/types'

export function generateCanvasClassCSS(
  classes: Record<string, CSSClass>,
  breakpoints: Array<{ id: string; width: number }>,
): string {
  const blocks: string[] = []

  for (const cls of Object.values(classes)) {
    const baseDecls = bagToCSS(cls.styles)
    if (baseDecls) {
      blocks.push(`.mc-${cls.id} {\n${baseDecls}\n}`)
    }

    for (const [bpId, bpStyles] of Object.entries(cls.breakpointStyles)) {
      const decls = bagToCSS(bpStyles)
      if (!decls) continue
      if (!breakpoints.some((breakpoint) => breakpoint.id === bpId)) continue
      blocks.push(`[data-breakpoint-id="${escapeCssAttribute(bpId)}"] .mc-${cls.id} {\n${decls}\n}`)
    }
  }

  return blocks.join('\n\n')
}

function escapeCssAttribute(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
