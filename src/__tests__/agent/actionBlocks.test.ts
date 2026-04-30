import { describe, expect, it } from 'bun:test'
import {
  buildAgentResponseEventsFromText,
  createAgentResponseStreamParser,
  parseAgentActionBlocks,
  stripAgentActionBlocks,
} from '../../core/agent/actionBlocks'

describe('agent action block parsing', () => {
  it('removes pb:actions markup from visible assistant text while preserving actions', () => {
    const text = `I'll build it now.
<pb:actions>
[
  { "type": "createClass", "name": "hero", "styles": { "padding": "64px" } }
]
</pb:actions>
Done.`

    const parsed = parseAgentActionBlocks(text)

    expect(parsed.cleanText).toBe("I'll build it now.\nDone.")
    expect(parsed.actionBatches).toHaveLength(1)
    expect(parsed.actionBatches[0][0]).toEqual({
      type: 'createClass',
      name: 'hero',
      styles: { padding: '64px' },
    })
  })

  it('strips a partial pb:actions block so streamed UI never shows raw JSON', () => {
    const visible = stripAgentActionBlocks('Working...\n<pb:actions>\n[{ "type": "insertNode"')

    expect(visible).toBe('Working...')
    expect(visible).not.toContain('<pb:actions>')
    expect(visible).not.toContain('insertNode')
  })

  it('builds browser stream events in the same order as assistant text and actions', () => {
    const events = buildAgentResponseEventsFromText(`Adding styles.
<pb:actions>
[
  { "type": "createClass", "name": "cta", "styles": { "color": "#fff" } }
]
</pb:actions>
Ready.`)

    expect(events).toEqual([
      { type: 'text', text: 'Adding styles.' },
      {
        type: 'actions',
        actions: [
          { type: 'createClass', name: 'cta', styles: { color: '#fff' } },
        ],
      },
      { type: 'text', text: 'Ready.' },
    ])
    expect(JSON.stringify(events)).not.toContain('<pb:actions>')
  })

  it('streams visible text while withholding partial action JSON', () => {
    const parser = createAgentResponseStreamParser()

    expect(parser.push('Working now.\n<pb:actions>\n[{ "type": "insertNode"')).toEqual([
      { type: 'text', text: 'Working now.\n' },
    ])
    expect(parser.push(', "moduleId": "base.text" }]')).toEqual([])
    expect(parser.push('</pb:actions>\nDone.')).toEqual([
      {
        type: 'actions',
        actions: [
          { type: 'insertNode', moduleId: 'base.text' },
        ],
      },
      { type: 'text', text: '\nDone.' },
    ])
  })

  it('handles action tags split across streamed chunks', () => {
    const parser = createAgentResponseStreamParser()

    expect(parser.push('A <pb:act')).toEqual([
      { type: 'text', text: 'A ' },
    ])
    expect(parser.push('ions>[{ "type": "createClass", "name": "x" }]')).toEqual([])
    expect(parser.push('</pb:act')).toEqual([])
    expect(parser.push('ions>B')).toEqual([
      {
        type: 'actions',
        actions: [
          { type: 'createClass', name: 'x' },
        ],
      },
      { type: 'text', text: 'B' },
    ])
  })
})
