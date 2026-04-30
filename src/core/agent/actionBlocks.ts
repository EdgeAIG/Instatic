import type { AgentAction, ServerStreamEvent } from './types'

const ACTION_BLOCK_RE = /<pb:actions\b[^>]*>\s*([\s\S]*?)\s*<\/pb:actions>/gi
const OPEN_ACTION_BLOCK_RE = /<pb:actions\b[^>]*>[\s\S]*$/i
const OPEN_ACTION_TAG_RE = /<pb:actions\b[^>]*>/i
const CLOSE_ACTION_TAG = '</pb:actions>'
const OPEN_ACTION_TAG_PREFIX = '<pb:actions'

export interface ParsedAgentActionBlocks {
  cleanText: string
  actionBatches: AgentAction[][]
}

export function parseAgentActionBlocks(text: string): ParsedAgentActionBlocks {
  const actionBatches: AgentAction[][] = []
  const cleanText = text.replace(ACTION_BLOCK_RE, (_, json) => {
    const actions = parseAgentActionJson(String(json))
    if (actions.length > 0) actionBatches.push(actions)

    return ''
  })

  return {
    cleanText: normalizeVisibleAgentText(cleanText),
    actionBatches,
  }
}

export function stripAgentActionBlocks(text: string): string {
  return normalizeVisibleAgentText(
    text
      .replace(ACTION_BLOCK_RE, '')
      .replace(OPEN_ACTION_BLOCK_RE, ''),
  )
}

export function buildAgentResponseEventsFromText(text: string): ServerStreamEvent[] {
  const events: ServerStreamEvent[] = []
  let cursor = 0

  for (const match of text.matchAll(ACTION_BLOCK_RE)) {
    const index = match.index ?? 0
    const before = normalizeVisibleAgentText(text.slice(cursor, index))
    if (before) events.push({ type: 'text', text: before })

    const actions = parseAgentActionJson(match[1] ?? '')
    if (actions.length > 0) events.push({ type: 'actions', actions })

    cursor = index + match[0].length
  }

  const after = normalizeVisibleAgentText(text.slice(cursor))
  if (after) events.push({ type: 'text', text: after })

  return events
}

export interface AgentResponseStreamParser {
  push(text: string): ServerStreamEvent[]
  flush(): ServerStreamEvent[]
}

export function createAgentResponseStreamParser(): AgentResponseStreamParser {
  let mode: 'text' | 'actions' = 'text'
  let buffer = ''
  let actionJson = ''

  function push(text: string): ServerStreamEvent[] {
    buffer += text
    return drain(false)
  }

  function flush(): ServerStreamEvent[] {
    return drain(true)
  }

  function drain(flush: boolean): ServerStreamEvent[] {
    const events: ServerStreamEvent[] = []

    while (buffer) {
      if (mode === 'text') {
        const openIndex = buffer.search(/<pb:actions\b/i)
        if (openIndex >= 0) {
          const before = buffer.slice(0, openIndex)
          if (before) events.push({ type: 'text', text: before })

          const tagMatch = buffer.slice(openIndex).match(OPEN_ACTION_TAG_RE)
          if (!tagMatch || tagMatch.index !== 0) {
            buffer = buffer.slice(openIndex)
            break
          }

          buffer = buffer.slice(openIndex + tagMatch[0].length)
          actionJson = ''
          mode = 'actions'
          continue
        }

        const keep = flush ? 0 : longestSuffixPrefixLength(buffer, OPEN_ACTION_TAG_PREFIX)
        const visible = buffer.slice(0, buffer.length - keep)
        if (visible) events.push({ type: 'text', text: visible })
        buffer = buffer.slice(buffer.length - keep)
        break
      }

      const closeIndex = buffer.toLowerCase().indexOf(CLOSE_ACTION_TAG)
      if (closeIndex >= 0) {
        actionJson += buffer.slice(0, closeIndex)
        const actions = parseAgentActionJson(actionJson)
        if (actions.length > 0) events.push({ type: 'actions', actions })
        buffer = buffer.slice(closeIndex + CLOSE_ACTION_TAG.length)
        actionJson = ''
        mode = 'text'
        continue
      }

      const keep = flush ? 0 : longestSuffixPrefixLength(buffer, CLOSE_ACTION_TAG)
      actionJson += buffer.slice(0, buffer.length - keep)
      buffer = buffer.slice(buffer.length - keep)
      break
    }

    return events
  }

  return { push, flush }
}

export function parseAgentActionJson(json: string): AgentAction[] {
  try {
    const parsed = JSON.parse(json.trim()) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed.filter(
      (item): item is AgentAction =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).type === 'string',
    )
  } catch {
    // Malformed action JSON is ignored here; executor-side validation handles
    // any action object that does make it through.
    return []
  }
}

function longestSuffixPrefixLength(text: string, prefix: string): number {
  const lowerText = text.toLowerCase()
  const lowerPrefix = prefix.toLowerCase()
  const max = Math.min(lowerText.length, lowerPrefix.length - 1)
  for (let length = max; length > 0; length -= 1) {
    if (lowerPrefix.startsWith(lowerText.slice(-length))) return length
  }
  return 0
}

function normalizeVisibleAgentText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}
