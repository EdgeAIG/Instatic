/**
 * Generic markdown → HTML renderer.
 *
 * Used by:
 *   - `src/core/templates/dynamicBindings.ts` to materialise `{{ body | html }}`
 *     bindings on template pages.
 *   - `src/core/loops/sources/dataRows.ts` to extract the first inline image from
 *     a row's body cell.
 *   - `server/publish/contentRenderer.ts` to render a standalone published data
 *     row document.
 *
 * URL safety: all `href`/`src` values pass through `isSafeUrl` from the
 * publisher utils — the same allow/deny-list used everywhere else in the
 * publish pipeline (blocks `javascript:`, `vbscript:`, `data:` schemes,
 * including tab/newline-evasion variants per Constraint #211 / CWE-79).
 *
 * The grammar intentionally stays small — this is the markdown surface used
 * by content editors, not a general-purpose markdown engine:
 *   - ATX headings `# … ######`
 *   - Image lines `![alt](url)`
 *   - Video lines `@[video](url)`
 *   - Inline links `[label](url)`
 *   - Paragraphs (consecutive non-empty lines)
 */

import { escapeHtml, isSafeUrl } from '@core/publisher/utils'

const HEADING_RE = /^(#{1,6})\s+(.+)$/
const IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)$/
const VIDEO_RE = /^@\[video\]\(([^)]+)\)$/
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g

function safeMarkdownUrl(value: string): string {
  const trimmed = value.trim()
  return isSafeUrl(trimmed) ? escapeHtml(trimmed) : '#'
}

function renderInlineMarkdown(value: string): string {
  return escapeHtml(value).replace(LINK_RE, (_match, label: string, href: string) => {
    return `<a href="${safeMarkdownUrl(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
  })
}

export function renderMarkdownToHtml(markdown: string): string {
  const blocks: string[] = []
  const paragraphLines: string[] = []

  function flushParagraph() {
    if (paragraphLines.length === 0) return
    blocks.push(`<p>${renderInlineMarkdown(paragraphLines.join(' '))}</p>`)
    paragraphLines.length = 0
  }

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      continue
    }

    const image = line.match(IMAGE_RE)
    if (image) {
      flushParagraph()
      blocks.push(`<img src="${safeMarkdownUrl(image[2])}" alt="${escapeHtml(image[1])}" loading="lazy">`)
      continue
    }

    const video = line.match(VIDEO_RE)
    if (video) {
      flushParagraph()
      blocks.push(`<video controls src="${safeMarkdownUrl(video[1])}"></video>`)
      continue
    }

    const heading = line.match(HEADING_RE)
    if (heading) {
      flushParagraph()
      const level = Math.min(Math.max(heading[1].length, 1), 6)
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`)
      continue
    }

    paragraphLines.push(line)
  }

  flushParagraph()
  return blocks.join('\n')
}

/**
 * Return the URL of the first `![alt](url)` image in `markdown`, or `null`
 * if there isn't one. Used by `firstImage` template bindings to expose a
 * representative image without requiring a separate featured-media field.
 */
export function firstImagePathFromMarkdown(markdown: string): string | null {
  for (const rawLine of markdown.split(/\r?\n/)) {
    const image = rawLine.trim().match(IMAGE_RE)
    if (!image) continue

    const src = image[2].trim()
    if (isSafeUrl(src)) return src
  }

  return null
}
