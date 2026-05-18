/**
 * Block editing model for the admin rich-text editor.
 *
 * Defines the `ContentBlock` discriminated union used by `RichMarkdownEditor`
 * in the admin content pages, and the serialisation / deserialisation helpers
 * that convert between the block tree and the markdown string stored on disk.
 *
 * This is purely a UI-layer model — blocks exist only in the editor's in-memory
 * state. The persisted form is always the serialised markdown string stored
 * inside a `cells_json` data row cell.
 */

import { nanoid } from 'nanoid'
import { Type, type Static } from '@sinclair/typebox'

// ---------------------------------------------------------------------------
// ContentMediaType
// ---------------------------------------------------------------------------

const ContentMediaTypeSchema = Type.Union([
  Type.Literal('image'),
  Type.Literal('video'),
])

export type ContentMediaType = Static<typeof ContentMediaTypeSchema>

// ---------------------------------------------------------------------------
// ContentBlock — discriminated union on `type`
// ---------------------------------------------------------------------------

const ContentBlockSchema = Type.Union([
  Type.Object({
    id: Type.String(),
    type: Type.Literal('paragraph'),
    text: Type.String(),
  }),
  Type.Object({
    id: Type.String(),
    type: Type.Literal('heading'),
    level: Type.Union([Type.Literal(2), Type.Literal(3), Type.Literal(4)]),
    text: Type.String(),
  }),
  Type.Object({
    id: Type.String(),
    type: Type.Literal('media'),
    mediaType: Type.Union([ContentMediaTypeSchema, Type.Null()]),
    src: Type.String(),
    alt: Type.String(),
  }),
])

export type ContentBlock = Static<typeof ContentBlockSchema>

// ---------------------------------------------------------------------------
// Block constructors
// ---------------------------------------------------------------------------

const HEADING_RE = /^(#{1,6})\s+(.+)$/
const IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)$/
const VIDEO_RE = /^@\[video\]\(([^)]+)\)$/
type BodyHeadingLevel = 2 | 3 | 4

function blockId(): string {
  return `block_${nanoid(8)}`
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeBodyHeadingLevel(level: number): BodyHeadingLevel {
  if (level <= 2) return 2
  if (level >= 4) return 4
  return 3
}

export function createParagraphBlock(text = ''): ContentBlock {
  return { id: blockId(), type: 'paragraph', text }
}

export function createHeadingBlock(text = 'Heading', level: BodyHeadingLevel = 2): ContentBlock {
  return { id: blockId(), type: 'heading', level, text }
}

export function createMediaBlock(src = '', mediaType: ContentMediaType | null = null, alt = ''): ContentBlock {
  return { id: blockId(), type: 'media', mediaType, src, alt }
}

// ---------------------------------------------------------------------------
// Serialisation / deserialisation
// ---------------------------------------------------------------------------

export function serializeMarkdownBlocks(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'heading':
          return `${'#'.repeat(block.level)} ${block.text.trim()}`
        case 'paragraph':
          return block.text.trim()
        case 'media': {
          const src = block.src.trim()
          if (!src) return ''
          return block.mediaType === 'video'
            ? `@[video](${src})`
            : `![${block.alt.trim()}](${src})`
        }
      }
    })
    .filter((line) => line.length > 0)
    .join('\n\n')
}

export function parseMarkdownBlocks(markdown: string): ContentBlock[] {
  const blocks: ContentBlock[] = []
  const paragraphLines: string[] = []

  function flushParagraph() {
    const text = normalizeText(paragraphLines.join(' '))
    paragraphLines.length = 0
    if (text) blocks.push(createParagraphBlock(text))
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
      blocks.push(createMediaBlock(image[2].trim(), 'image', image[1].trim()))
      continue
    }

    const video = line.match(VIDEO_RE)
    if (video) {
      flushParagraph()
      blocks.push(createMediaBlock(video[1].trim(), 'video'))
      continue
    }

    const heading = line.match(HEADING_RE)
    if (heading) {
      flushParagraph()
      blocks.push(createHeadingBlock(heading[2].trim(), normalizeBodyHeadingLevel(heading[1].length)))
      continue
    }

    paragraphLines.push(line)
  }

  flushParagraph()
  return blocks.length > 0 ? blocks : [createParagraphBlock()]
}

export function autoformatMarkdownShortcut(block: ContentBlock): ContentBlock {
  if (block.type !== 'paragraph') return block

  const heading = block.text.match(HEADING_RE)
  if (heading) {
    return {
      id: block.id,
      type: 'heading',
      level: normalizeBodyHeadingLevel(heading[1].length),
      text: heading[2].trim(),
    }
  }

  return block
}
