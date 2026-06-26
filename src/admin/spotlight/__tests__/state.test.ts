/**
 * Unit tests for the Spotlight state reducer — Phase 2 additions.
 *
 * Covers:
 *   - Arg mode entry, advance, back, exit
 *   - Destructive confirm: set, clear
 *   - PUSH_SCOPE / POP_SCOPE clearing arg mode and pending confirm
 */

import { describe, it, expect } from 'bun:test'
import { spotlightReducer, initialState } from '../state'
import type { SpotlightOpenState } from '../state'
import type { Command } from '../types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOpenState(): SpotlightOpenState {
  return spotlightReducer(initialState, { type: 'OPEN' }) as SpotlightOpenState
}

const NOOP_RUN = () => {}

const CMD_WITH_ARGS: Command = {
  id: 'test.withArgs',
  title: 'Test command',
  group: 'editor',
  workspaces: ['site'],
  args: [
    { id: 'a', label: 'First arg', type: 'text', placeholder: 'Enter a' },
    { id: 'b', label: 'Second arg', type: 'text', placeholder: 'Enter b' },
  ],
  run: NOOP_RUN,
}

const CMD_NO_ARGS: Command = {
  id: 'test.noArgs',
  title: 'No args command',
  group: 'editor',
  workspaces: ['any'],
  run: NOOP_RUN,
}

const CMD_DESTRUCTIVE: Command = {
  id: 'test.destructive',
  title: 'Destructive command',
  group: 'editor',
  workspaces: ['any'],
  destructive: true,
  run: NOOP_RUN,
}

// ─── Open / Close ─────────────────────────────────────────────────────────────

describe('OPEN / CLOSE / TOGGLE', () => {
  it('OPEN transitions from closed to open', () => {
    const next = spotlightReducer(initialState, { type: 'OPEN' })
    expect(next.phase).toBe('open')
  })

  it('OPEN is idempotent when already open', () => {
    const open = makeOpenState()
    const next = spotlightReducer(open, { type: 'OPEN' })
    expect(next).toBe(open) // same reference — no new state
  })

  it('CLOSE transitions to closed', () => {
    const open = makeOpenState()
    const next = spotlightReducer(open, { type: 'CLOSE' })
    expect(next.phase).toBe('closed')
  })

  it('TOGGLE opens when closed', () => {
    const next = spotlightReducer(initialState, { type: 'TOGGLE' })
    expect(next.phase).toBe('open')
  })

  it('TOGGLE closes when open', () => {
    const open = makeOpenState()
    const next = spotlightReducer(open, { type: 'TOGGLE' })
    expect(next.phase).toBe('closed')
  })
})

// ─── Arg mode ─────────────────────────────────────────────────────────────────

describe('ENTER_ARG_MODE', () => {
  it('enters arg mode and resets query and highlight', () => {
    let state = makeOpenState()
    state = spotlightReducer(state, { type: 'SET_QUERY', query: 'hello' }) as SpotlightOpenState
    state = spotlightReducer(state, { type: 'ENTER_ARG_MODE', command: CMD_WITH_ARGS }) as SpotlightOpenState

    expect(state.phase).toBe('open')
    expect(state.argMode).not.toBeNull()
    expect(state.argMode!.command.id).toBe('test.withArgs')
    expect(state.argMode!.argIndex).toBe(0)
    expect(state.argMode!.values).toEqual({})
    expect(state.query).toBe('')
    expect(state.highlightedIndex).toBe(0)
  })

  it('is a no-op for commands with no args', () => {
    const open = makeOpenState()
    const next = spotlightReducer(open, { type: 'ENTER_ARG_MODE', command: CMD_NO_ARGS })
    expect(next).toBe(open) // no mutation
  })

  it('clears pendingConfirm when entering arg mode', () => {
    let state = makeOpenState()
    state = spotlightReducer(state, { type: 'SET_PENDING_CONFIRM', commandId: 'x' }) as SpotlightOpenState
    state = spotlightReducer(state, { type: 'ENTER_ARG_MODE', command: CMD_WITH_ARGS }) as SpotlightOpenState
    expect(state.pendingConfirm).toBeNull()
  })
})

describe('SAVE_ARG_AND_ADVANCE', () => {
  it('advances argIndex and stores the value', () => {
    let state = makeOpenState()
    state = spotlightReducer(state, { type: 'ENTER_ARG_MODE', command: CMD_WITH_ARGS }) as SpotlightOpenState
    state = spotlightReducer(state, { type: 'SAVE_ARG_AND_ADVANCE', argId: 'a', value: 'hello' }) as SpotlightOpenState

    expect(state.argMode!.argIndex).toBe(1)
    expect(state.argMode!.values).toEqual({ a: 'hello' })
    expect(state.query).toBe('')
    expect(state.highlightedIndex).toBe(0)
  })

  it('is a no-op when phase is not open', () => {
    const next = spotlightReducer(initialState, { type: 'SAVE_ARG_AND_ADVANCE', argId: 'a', value: 'x' })
    expect(next.phase).toBe('closed')
  })

  it('is a no-op when not in arg mode', () => {
    const state = makeOpenState()
    const next = spotlightReducer(state, { type: 'SAVE_ARG_AND_ADVANCE', argId: 'a', value: 'x' })
    expect(next).toBe(state)
  })
})

describe('BACK_ARG', () => {
  it('steps back one arg index', () => {
    let state = makeOpenState()
    state = spotlightReducer(state, { type: 'ENTER_ARG_MODE', command: CMD_WITH_ARGS }) as SpotlightOpenState
    state = spotlightReducer(state, { type: 'SAVE_ARG_AND_ADVANCE', argId: 'a', value: 'v' }) as SpotlightOpenState
    expect(state.argMode!.argIndex).toBe(1)

    state = spotlightReducer(state, { type: 'BACK_ARG' }) as SpotlightOpenState
    expect(state.argMode!.argIndex).toBe(0)
  })

  it('exits arg mode when backing past the first arg', () => {
    let state = makeOpenState()
    state = spotlightReducer(state, { type: 'ENTER_ARG_MODE', command: CMD_WITH_ARGS }) as SpotlightOpenState
    state = spotlightReducer(state, { type: 'BACK_ARG' }) as SpotlightOpenState
    expect(state.argMode).toBeNull()
  })

  it('is a no-op when not in arg mode', () => {
    const open = makeOpenState()
    const next = spotlightReducer(open, { type: 'BACK_ARG' })
    expect(next).toBe(open)
  })
})

describe('EXIT_ARG_MODE', () => {
  it('clears argMode and resets query', () => {
    let state = makeOpenState()
    state = spotlightReducer(state, { type: 'ENTER_ARG_MODE', command: CMD_WITH_ARGS }) as SpotlightOpenState
    state = spotlightReducer(state, { type: 'EXIT_ARG_MODE' }) as SpotlightOpenState
    expect(state.argMode).toBeNull()
    expect(state.query).toBe('')
    expect(state.highlightedIndex).toBe(0)
  })
})

// ─── Destructive confirm ──────────────────────────────────────────────────────

describe('SET_PENDING_CONFIRM / CLEAR_PENDING_CONFIRM', () => {
  it('sets pendingConfirm to the command id', () => {
    let state = makeOpenState()
    state = spotlightReducer(state, { type: 'SET_PENDING_CONFIRM', commandId: CMD_DESTRUCTIVE.id }) as SpotlightOpenState
    expect(state.pendingConfirm).toBe(CMD_DESTRUCTIVE.id)
  })

  it('clears pendingConfirm', () => {
    let state = makeOpenState()
    state = spotlightReducer(state, { type: 'SET_PENDING_CONFIRM', commandId: CMD_DESTRUCTIVE.id }) as SpotlightOpenState
    state = spotlightReducer(state, { type: 'CLEAR_PENDING_CONFIRM' }) as SpotlightOpenState
    expect(state.pendingConfirm).toBeNull()
  })

  it('is a no-op when phase is closed', () => {
    const next = spotlightReducer(initialState, { type: 'SET_PENDING_CONFIRM', commandId: 'x' })
    expect(next.phase).toBe('closed')
  })
})

// ─── Scope operations clear arg/confirm state ─────────────────────────────────

describe('PUSH_SCOPE clears arg mode and pending confirm', () => {
  it('clears argMode and pendingConfirm on PUSH_SCOPE', () => {
    let state = makeOpenState()
    state = spotlightReducer(state, { type: 'ENTER_ARG_MODE', command: CMD_WITH_ARGS }) as SpotlightOpenState
    state = spotlightReducer(state, { type: 'SET_PENDING_CONFIRM', commandId: 'x' }) as SpotlightOpenState
    state = spotlightReducer(state, { type: 'PUSH_SCOPE', scopeId: 'pages' }) as SpotlightOpenState

    expect(state.argMode).toBeNull()
    expect(state.pendingConfirm).toBeNull()
    expect(state.scopeStack).toHaveLength(2)
  })

  it('clears argMode and pendingConfirm on POP_SCOPE', () => {
    let state = makeOpenState()
    state = spotlightReducer(state, { type: 'PUSH_SCOPE', scopeId: 'pages' }) as SpotlightOpenState
    state = spotlightReducer(state, { type: 'ENTER_ARG_MODE', command: CMD_WITH_ARGS }) as SpotlightOpenState
    state = spotlightReducer(state, { type: 'SET_PENDING_CONFIRM', commandId: 'x' }) as SpotlightOpenState
    state = spotlightReducer(state, { type: 'POP_SCOPE' }) as SpotlightOpenState

    expect(state.argMode).toBeNull()
    expect(state.pendingConfirm).toBeNull()
    expect(state.scopeStack).toHaveLength(1)
  })
})

// ─── RESULT_COUNT_CHANGED clamps highlight ────────────────────────────────────

describe('RESULT_COUNT_CHANGED', () => {
  it('clamps highlightedIndex when count shrinks below current index', () => {
    let state = makeOpenState()
    state = spotlightReducer(state, { type: 'SET_HIGHLIGHTED', index: 5 }) as SpotlightOpenState
    state = spotlightReducer(state, { type: 'RESULT_COUNT_CHANGED', count: 3 }) as SpotlightOpenState
    expect(state.highlightedIndex).toBe(2)
  })

  it('clamps to 0 when count is 0', () => {
    let state = makeOpenState()
    state = spotlightReducer(state, { type: 'SET_HIGHLIGHTED', index: 3 }) as SpotlightOpenState
    state = spotlightReducer(state, { type: 'RESULT_COUNT_CHANGED', count: 0 }) as SpotlightOpenState
    expect(state.highlightedIndex).toBe(0)
  })

  it('does not change index when count is larger than index', () => {
    let state = makeOpenState()
    state = spotlightReducer(state, { type: 'SET_HIGHLIGHTED', index: 2 }) as SpotlightOpenState
    state = spotlightReducer(state, { type: 'RESULT_COUNT_CHANGED', count: 10 }) as SpotlightOpenState
    expect(state.highlightedIndex).toBe(2)
  })
})

// ─── SET_QUERY resets highlight ───────────────────────────────────────────────

describe('SET_QUERY', () => {
  it('resets highlightedIndex to 0', () => {
    let state = makeOpenState()
    state = spotlightReducer(state, { type: 'SET_HIGHLIGHTED', index: 3 }) as SpotlightOpenState
    state = spotlightReducer(state, { type: 'SET_QUERY', query: 'hello' }) as SpotlightOpenState
    expect(state.highlightedIndex).toBe(0)
    expect(state.query).toBe('hello')
  })

  it('clears stale async provider state when the query changes', () => {
    let state = makeOpenState()
    state = spotlightReducer(state, {
      type: 'SET_ASYNC_RESULTS',
      providerId: 'content',
      results: [],
    }) as SpotlightOpenState
    state = spotlightReducer(state, {
      type: 'SET_LOADING_PROVIDER',
      providerId: 'media',
      loading: true,
    }) as SpotlightOpenState

    state = spotlightReducer(state, { type: 'SET_QUERY', query: 'hello' }) as SpotlightOpenState

    expect(state.query).toBe('hello')
    expect(state.asyncResults).toEqual({})
    expect(state.loadingProviders.size).toBe(0)
  })
})
