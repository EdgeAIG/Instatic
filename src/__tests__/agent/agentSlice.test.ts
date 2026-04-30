import { describe, expect, it } from 'bun:test'
import { useEditorStore } from '../../core/editor-store/store'
import { processStreamEvent } from '../../core/agent/agentSlice'
import type { AgentMessage } from '../../core/agent/types'
import '../../modules/base'

function freshAgentState() {
  useEditorStore.setState({
    project: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    selectedNodeId: null,
    hoveredNodeId: null,
    activeClassId: null,
    isAgentOpen: true,
    isAgentStreaming: true,
    agentMessages: [],
    agentError: null,
    agentSessionId: null,
    agentSessionProjectId: null,
    hasUnsavedChanges: false,
  })

  const project = useEditorStore.getState().createProject('Agent Test')
  const rootId = project.pages[0].rootNodeId
  const assistantId = 'assistant-1'
  const assistantMessage: AgentMessage = {
    id: assistantId,
    role: 'assistant',
    content: '',
    toolCalls: [],
    timestamp: Date.now(),
  }
  useEditorStore.setState({ agentMessages: [assistantMessage] })
  return { assistantId, rootId }
}

describe('processStreamEvent — action failures', () => {
  it('marks unexecuted tool calls as error instead of leaving them pending', async () => {
    const { assistantId, rootId } = freshAgentState()

    await processStreamEvent(
      {
        type: 'actions',
        actions: [
          { type: 'insertNode', ref: 'hero', moduleId: 'base.container', parentId: rootId },
          { type: 'insertNode', moduleId: 'base.text', parentRef: 'missing-ref', props: { text: 'Hero', tag: 'h1' } },
          { type: 'insertNode', moduleId: 'base.button', parentRef: 'hero', props: { label: 'Start' } },
        ],
      },
      assistantId,
      () => {},
      useEditorStore.setState,
      useEditorStore.getState,
    )

    const state = useEditorStore.getState()
    const toolCalls = state.agentMessages[0].toolCalls

    expect(toolCalls.map((tc) => tc.status)).toEqual(['success', 'error', 'error'])
    expect(toolCalls[2].result?.error).toContain('Skipped')
    expect(state.agentError).toContain('Some actions could not be completed')
    expect(state.agentMessages[0].content).toContain("couldn't complete all changes")
  })

  it('adds and completes SDK tool status badges as they stream', async () => {
    const { assistantId } = freshAgentState()

    await processStreamEvent(
      {
        type: 'toolStatus',
        toolCallId: 'toolu_1',
        name: 'mcp__page_builder__inspect_page',
        status: 'pending',
        input: {},
      },
      assistantId,
      () => {},
      useEditorStore.setState,
      useEditorStore.getState,
    )

    await processStreamEvent(
      {
        type: 'toolStatus',
        toolCallId: 'toolu_1',
        name: 'mcp__page_builder__inspect_page',
        status: 'success',
      },
      assistantId,
      () => {},
      useEditorStore.setState,
      useEditorStore.getState,
    )

    const toolCalls = useEditorStore.getState().agentMessages[0].toolCalls
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].source).toBe('sdk')
    expect(toolCalls[0].actionType).toBe('mcp__page_builder__inspect_page')
    expect(toolCalls[0].status).toBe('success')
  })

  it('does not append later success text after an action in the same assistant message failed', async () => {
    const { assistantId, rootId } = freshAgentState()

    await processStreamEvent(
      {
        type: 'actions',
        actions: [
          { type: 'insertNode', moduleId: 'base.container', parentId: rootId },
          { type: 'insertNode', moduleId: 'base.text', parentRef: 'missing-ref', props: { text: 'Hero' } },
        ],
      },
      assistantId,
      () => {},
      useEditorStore.setState,
      useEditorStore.getState,
    )

    await processStreamEvent(
      { type: 'text', text: 'Done! The page is ready.' },
      assistantId,
      (id, text) => {
        useEditorStore.setState((state) => ({
          agentMessages: state.agentMessages.map((message) =>
            message.id === id ? { ...message, content: message.content + text } : message,
          ),
        }))
      },
      useEditorStore.setState,
      useEditorStore.getState,
    )

    const message = useEditorStore.getState().agentMessages[0]
    expect(message.content).toContain("couldn't complete all changes")
    expect(message.content).not.toContain('Done! The page is ready.')
  })
})

describe('sendAgentMessage — SDK owns the agent loop', () => {
  it('does not start a second browser request after successful actions', async () => {
    const { rootId } = freshAgentState()
    useEditorStore.setState({
      isAgentStreaming: false,
      agentMessages: [],
    })

    const originalFetch = globalThis.fetch
    const requests: string[] = []

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(String(init?.body ?? ''))
      const eventStream = requests.length === 1
        ? [
          JSON.stringify({
            type: 'actions',
            actions: [
              { type: 'insertNode', moduleId: 'base.container', parentId: rootId },
            ],
          }),
          JSON.stringify({ type: 'done' }),
        ].join('\n') + '\n'
        : JSON.stringify({ type: 'done' }) + '\n'

      return new Response(eventStream, {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      })
    }) as typeof fetch

    try {
      await useEditorStore.getState().sendAgentMessage('Make the colors greener.')
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(requests).toHaveLength(1)
  })

  it('sends the SDK session ID on follow-up requests', async () => {
    freshAgentState()
    useEditorStore.setState({
      isAgentStreaming: false,
      agentMessages: [],
      agentSessionId: null,
      agentSessionProjectId: null,
    })
    localStorage.clear()

    const sessionId = '00000000-0000-4000-8000-000000000001'
    const requestBodies: Array<Record<string, unknown>> = []
    const originalFetch = globalThis.fetch

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      const eventStream = requestBodies.length === 1
        ? [
          JSON.stringify({ type: 'session', sessionId }),
          JSON.stringify({ type: 'done' }),
        ].join('\n') + '\n'
        : JSON.stringify({ type: 'done' }) + '\n'

      return new Response(eventStream, {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      })
    }) as typeof fetch

    try {
      await useEditorStore.getState().sendAgentMessage('Build a plumber page.')
      await useEditorStore.getState().sendAgentMessage('Use the previous class instead.')
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(requestBodies).toHaveLength(2)
    expect(requestBodies[0].sessionId).toBeUndefined()
    expect(useEditorStore.getState().agentSessionId).toBe(sessionId)
    expect(requestBodies[1].sessionId).toBe(sessionId)
  })
})
