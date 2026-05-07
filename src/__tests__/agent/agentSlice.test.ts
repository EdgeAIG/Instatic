import { describe, expect, it } from 'bun:test'
import { useEditorStore } from '@core/editor-store/store'
import {
  processStreamEvent,
  type AgentBridgeRuntime,
  type AgentTextStreamSink,
} from '@core/agent/agentSlice'
import type { AgentMessage, AgentToolCall } from '@core/agent/types'
import '../../modules/base'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function freshAgentState() {
  useEditorStore.setState({
    site: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    activeClassId: null,
    isAgentOpen: true,
    isAgentStreaming: true,
    agentMessages: [],
    agentError: null,
    agentSessionId: null,
    agentSessionSiteId: null,
    hasUnsavedChanges: false,
  })

  const site = useEditorStore.getState().createSite('Agent Test')
  const rootId = site.pages[0].rootNodeId
  const assistantId = 'assistant-1'
  const assistantMessage: AgentMessage = {
    id: assistantId,
    role: 'assistant',
    blocks: [],
    timestamp: Date.now(),
  }
  useEditorStore.setState({ agentMessages: [assistantMessage] })
  return { assistantId, rootId }
}

function emptyBridge(): AgentBridgeRuntime {
  return { bridgeId: null }
}

const noopTextSink: AgentTextStreamSink = {
  append: () => {},
  flush: () => {},
}

function getToolCallBlocks(message: AgentMessage): AgentToolCall[] {
  return message.blocks
    .filter((block): block is { kind: 'toolCall'; toolCall: AgentToolCall } => block.kind === 'toolCall')
    .map((block) => block.toolCall)
}

interface InterceptedFetch {
  url: string
  body: string
}

function captureFetch(
  responses: Array<(call: number, init: RequestInit | undefined) => Response>,
): { restore: () => void; calls: InterceptedFetch[] } {
  const original = globalThis.fetch
  const calls: InterceptedFetch[] = []
  let callIndex = 0
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({ url, body: String(init?.body ?? '') })
    const factory = responses[callIndex] ?? responses[responses.length - 1]
    callIndex += 1
    return factory(callIndex - 1, init)
  }) as typeof fetch
  return {
    restore() {
      globalThis.fetch = original
    },
    calls,
  }
}

function ndjsonResponse(events: object[]): Response {
  const body = events.map((event) => JSON.stringify(event)).join('\n') + '\n'
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson' },
  })
}

// ---------------------------------------------------------------------------
// processStreamEvent — bridge handshake + tool requests
// ---------------------------------------------------------------------------

describe('processStreamEvent — bridge handshake', () => {
  it('captures the bridgeId on bridgeReady', async () => {
    const { assistantId } = freshAgentState()
    const bridge = emptyBridge()

    await processStreamEvent(
      { type: 'bridgeReady', bridgeId: 'bridge-xyz' },
      assistantId,
      noopTextSink,
      useEditorStore.setState,
      useEditorStore.getState,
      bridge,
      null,
    )

    expect(bridge.bridgeId).toBe('bridge-xyz')
  })
})

describe('processStreamEvent — toolRequest dispatches to executor', () => {
  it('runs the tool against the editor store and POSTs the result', async () => {
    const { assistantId, rootId } = freshAgentState()
    const bridge: AgentBridgeRuntime = { bridgeId: 'bridge-1' }

    const intercept = captureFetch([
      () => new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ])

    try {
      await processStreamEvent(
        {
          type: 'toolRequest',
          requestId: 'req-1',
          name: 'insertNode',
          input: { moduleId: 'base.text', parentId: rootId, props: { text: 'Hi' } },
        },
        assistantId,
        () => {},
        useEditorStore.setState,
        useEditorStore.getState,
        bridge,
        null,
      )
    } finally {
      intercept.restore()
    }

    expect(intercept.calls).toHaveLength(1)
    expect(intercept.calls[0].url).toBe('/api/agent/tool-result')
    const body = JSON.parse(intercept.calls[0].body) as Record<string, unknown>
    expect(body.bridgeId).toBe('bridge-1')
    expect(body.requestId).toBe('req-1')
    const result = body.result as { success: boolean; nodeId?: string }
    expect(result.success).toBe(true)
    expect(result.nodeId).toBeTruthy()

    const page = useEditorStore.getState().site!.pages[0]
    expect(Object.values(page.nodes).some((n) => n.moduleId === 'base.text')).toBe(true)
  })

  it('reports an error result when the tool input is invalid', async () => {
    const { assistantId, rootId } = freshAgentState()
    const bridge: AgentBridgeRuntime = { bridgeId: 'bridge-2' }

    const intercept = captureFetch([
      () => new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ])

    try {
      await processStreamEvent(
        {
          type: 'toolRequest',
          requestId: 'req-2',
          name: 'insertNode',
          input: { moduleId: 'missing.module', parentId: rootId },
        },
        assistantId,
        () => {},
        useEditorStore.setState,
        useEditorStore.getState,
        bridge,
        null,
      )
    } finally {
      intercept.restore()
    }

    expect(intercept.calls).toHaveLength(1)
    const body = JSON.parse(intercept.calls[0].body) as { result: { success: boolean; error?: string } }
    expect(body.result.success).toBe(false)
    expect(body.result.error).toContain('Module not found')
  })
})

// ---------------------------------------------------------------------------
// processStreamEvent — toolStatus rendering for the message thread
// ---------------------------------------------------------------------------

describe('processStreamEvent — toolStatus badges', () => {
  it('adds and completes SDK tool status badges as they stream', async () => {
    const { assistantId } = freshAgentState()
    const bridge = emptyBridge()

    await processStreamEvent(
      {
        type: 'toolStatus',
        toolCallId: 'toolu_1',
        name: 'mcp__page_builder__inspect_page',
        status: 'pending',
        input: {},
      },
      assistantId,
      noopTextSink,
      useEditorStore.setState,
      useEditorStore.getState,
      bridge,
      null,
    )

    await processStreamEvent(
      {
        type: 'toolStatus',
        toolCallId: 'toolu_1',
        name: 'mcp__page_builder__inspect_page',
        status: 'success',
      },
      assistantId,
      noopTextSink,
      useEditorStore.setState,
      useEditorStore.getState,
      bridge,
      null,
    )

    const toolCalls = getToolCallBlocks(useEditorStore.getState().agentMessages[0])
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].actionType).toBe('mcp__page_builder__inspect_page')
    expect(toolCalls[0].status).toBe('success')
  })
})

describe('processStreamEvent — chronological text/tool ordering', () => {
  it('renders text → tool → text as three blocks in arrival order', async () => {
    const { assistantId } = freshAgentState()
    const bridge = emptyBridge()

    // Simulate a real-world stream: write some text, then run a tool, then
    // write more text. The buggy old shape would fold all text into one
    // bubble at the top of the message; the blocks model preserves order.
    const inlineTextSink: AgentTextStreamSink = {
      append(id, text) {
        useEditorStore.setState((state) => {
          const msg = state.agentMessages.find((m) => m.id === id)
          if (!msg) return
          const last = msg.blocks[msg.blocks.length - 1]
          if (last && last.kind === 'text') {
            last.text += text
          } else {
            msg.blocks.push({ kind: 'text', text })
          }
        })
      },
      flush() {},
    }

    await processStreamEvent(
      { type: 'text', text: 'I will inspect the page first.' },
      assistantId,
      inlineTextSink,
      useEditorStore.setState,
      useEditorStore.getState,
      bridge,
      null,
    )

    await processStreamEvent(
      {
        type: 'toolStatus',
        toolCallId: 'toolu_1',
        name: 'mcp__page_builder__inspect_page',
        status: 'success',
      },
      assistantId,
      inlineTextSink,
      useEditorStore.setState,
      useEditorStore.getState,
      bridge,
      null,
    )

    await processStreamEvent(
      { type: 'text', text: 'All done — root has 3 children.' },
      assistantId,
      inlineTextSink,
      useEditorStore.setState,
      useEditorStore.getState,
      bridge,
      null,
    )

    const blocks = useEditorStore.getState().agentMessages[0].blocks
    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toMatchObject({ kind: 'text', text: 'I will inspect the page first.' })
    expect(blocks[1].kind).toBe('toolCall')
    expect(blocks[2]).toMatchObject({ kind: 'text', text: 'All done — root has 3 children.' })
  })
})

// ---------------------------------------------------------------------------
// sendAgentMessage — request lifecycle
// ---------------------------------------------------------------------------

describe('sendAgentMessage — request lifecycle', () => {
  it('opens one streaming request and does not relaunch after the SDK loop ends', async () => {
    const { rootId } = freshAgentState()
    useEditorStore.setState({ isAgentStreaming: false, agentMessages: [] })

    const intercept = captureFetch([
      () => ndjsonResponse([
        { type: 'bridgeReady', bridgeId: 'b-1' },
        { type: 'text', text: 'Inserting hero…' },
        { type: 'done' },
      ]),
    ])

    try {
      await useEditorStore.getState().sendAgentMessage('Add a hero')
    } finally {
      intercept.restore()
    }

    // Single POST to /api/agent (no follow-up tool-result POSTs because no
    // toolRequest was emitted in this canned stream).
    expect(intercept.calls.filter((c) => c.url === '/api/agent')).toHaveLength(1)
    void rootId
  })

  it('sends the SDK session ID on follow-up requests', async () => {
    freshAgentState()
    useEditorStore.setState({
      isAgentStreaming: false,
      agentMessages: [],
      agentSessionId: null,
      agentSessionSiteId: null,
    })

    const sessionId = '00000000-0000-4000-8000-000000000001'
    const intercept = captureFetch([
      () => ndjsonResponse([
        { type: 'bridgeReady', bridgeId: 'b-1' },
        { type: 'session', sessionId },
        { type: 'done' },
      ]),
      () => ndjsonResponse([
        { type: 'bridgeReady', bridgeId: 'b-2' },
        { type: 'done' },
      ]),
    ])

    try {
      await useEditorStore.getState().sendAgentMessage('Build a plumber page.')
      await useEditorStore.getState().sendAgentMessage('Use the previous class instead.')
    } finally {
      intercept.restore()
    }

    const queryCalls = intercept.calls.filter((c) => c.url === '/api/agent')
    expect(queryCalls).toHaveLength(2)

    const firstBody = JSON.parse(queryCalls[0].body) as { sessionId?: string }
    const secondBody = JSON.parse(queryCalls[1].body) as { sessionId?: string }
    expect(firstBody.sessionId).toBeUndefined()
    expect(useEditorStore.getState().agentSessionId).toBe(sessionId)
    expect(secondBody.sessionId).toBe(sessionId)
  })

  it('runs a toolRequest from the stream and posts its result back to /api/agent/tool-result', async () => {
    const { rootId } = freshAgentState()
    useEditorStore.setState({ isAgentStreaming: false, agentMessages: [] })

    const intercept = captureFetch([
      () => ndjsonResponse([
        { type: 'bridgeReady', bridgeId: 'b-3' },
        {
          type: 'toolRequest',
          requestId: 'req-7',
          name: 'createClass',
          input: { name: 'pricing-card', styles: { padding: '24px' } },
        },
        { type: 'done' },
      ]),
      // /api/agent/tool-result acknowledgement
      () => new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ])

    try {
      await useEditorStore.getState().sendAgentMessage('Create a pricing card class.')
    } finally {
      intercept.restore()
    }

    const toolResultCalls = intercept.calls.filter((c) => c.url === '/api/agent/tool-result')
    expect(toolResultCalls).toHaveLength(1)
    const body = JSON.parse(toolResultCalls[0].body) as {
      bridgeId: string
      requestId: string
      result: { success: boolean; nodeId?: string }
    }
    expect(body.bridgeId).toBe('b-3')
    expect(body.requestId).toBe('req-7')
    expect(body.result.success).toBe(true)
    expect(body.result.nodeId).toBeTruthy()

    const classes = useEditorStore.getState().site!.classes
    expect(Object.values(classes).some((c) => c.name === 'pricing-card')).toBe(true)
    void rootId
  })
})
