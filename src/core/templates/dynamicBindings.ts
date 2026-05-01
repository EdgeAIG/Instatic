import type { DynamicPropBinding } from '../page-tree'
import { escapeHtml, isSafeUrl } from '../publisher/utils'

export interface TemplateEntryData {
  id: string
  entryId?: string
  collectionId: string
  collectionSlug: string
  collectionRouteBase?: string
  versionNumber?: number
  title: string
  slug: string
  bodyMarkdown: string
  featuredMediaId: string | null
  featuredMediaPath: string | null
  firstImagePath?: string | null
  seoTitle: string
  seoDescription: string
  publishedAt: string
  createdAt: string
}

export interface TemplateRenderDataContext {
  currentEntry?: TemplateEntryData | null
}

const HEADING_RE = /^(#{1,6})\s+(.+)$/
const IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)$/
const VIDEO_RE = /^@\[video\]\(([^)]+)\)$/
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g

export function firstImagePathFromMarkdown(markdown: string): string | null {
  for (const rawLine of markdown.split(/\r?\n/)) {
    const image = rawLine.trim().match(IMAGE_RE)
    if (!image) continue

    const src = image[2].trim()
    if (isSafeUrl(src)) return src
  }

  return null
}

function safeMarkdownUrl(value: string): string {
  const trimmed = value.trim()
  return isSafeUrl(trimmed) ? escapeHtml(trimmed) : '#'
}

function renderInlineMarkdown(value: string): string {
  return escapeHtml(value).replace(LINK_RE, (_match, label: string, href: string) => {
    return `<a href="${safeMarkdownUrl(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
  })
}

export function renderContentMarkdownToHtml(markdown: string): string {
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

function resolveCurrentEntryField(binding: DynamicPropBinding, context: TemplateRenderDataContext): unknown {
  const entry = context.currentEntry
  if (!entry) return undefined

  switch (binding.field) {
    case 'title':
      return entry.title
    case 'slug':
      return entry.slug
    case 'body':
    case 'bodyMarkdown':
      return binding.format === 'html'
        ? renderContentMarkdownToHtml(entry.bodyMarkdown)
        : entry.bodyMarkdown
    case 'featuredMedia':
    case 'featuredMediaPath':
    case 'featuredMediaUrl':
      return entry.featuredMediaPath
    case 'firstImage':
    case 'firstImagePath':
    case 'firstImageUrl':
      return entry.firstImagePath ?? firstImagePathFromMarkdown(entry.bodyMarkdown)
    case 'seoTitle':
      return entry.seoTitle
    case 'seoDescription':
      return entry.seoDescription
    case 'publishedAt':
      return entry.publishedAt
    case 'createdAt':
      return entry.createdAt
    default:
      return (entry as unknown as Record<string, unknown>)[binding.field]
  }
}

export function resolveDynamicProps(
  staticProps: Record<string, unknown>,
  bindings: Record<string, DynamicPropBinding> | undefined,
  context: TemplateRenderDataContext | undefined,
): Record<string, unknown> {
  if (!bindings || !context?.currentEntry) return staticProps

  const resolved = { ...staticProps }
  for (const [propKey, binding] of Object.entries(bindings)) {
    if (binding.source !== 'currentEntry') continue

    const value = resolveCurrentEntryField(binding, context)
    if (value === undefined || value === null) {
      if (binding.fallback === 'empty') resolved[propKey] = ''
      continue
    }

    resolved[propKey] = value
  }

  return resolved
}
