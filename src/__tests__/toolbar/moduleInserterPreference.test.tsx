import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import {
  DEFAULT_MODULE_INSERTER_PREFERENCE,
  type ModuleInserterPreference,
} from '@core/persistence/userPreferences'
import {
  __resetModuleInserterPreferenceForTests,
  useModuleInserterPreference,
} from '@site/module-picker/useModuleInserterPreference'

const originalFetch = globalThis.fetch
const originalConsoleError = console.error

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  cleanup()
  __resetModuleInserterPreferenceForTests()
})

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
  console.error = originalConsoleError
})

describe('useModuleInserterPreference', () => {
  it('starts with default favorites before the server preference loads', async () => {
    globalThis.fetch = mock(async () => new Promise<Response>(() => {})) as typeof fetch

    const { result } = renderHook(() => useModuleInserterPreference())

    expect(result.current.favorites).toEqual(DEFAULT_MODULE_INSERTER_PREFERENCE.favorites)
    expect(result.current.loading).toBe(true)
  })

  it('loads server favorites', async () => {
    const stored: ModuleInserterPreference = {
      favorites: [{ kind: 'module', id: 'base.list' }],
    }
    globalThis.fetch = mock(async () => jsonResponse({ value: stored })) as typeof fetch

    const { result } = renderHook(() => useModuleInserterPreference())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.favorites).toEqual(stored.favorites)
  })

  it('toggles a favorite and persists the ordered preference', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      if (!init?.method) {
        return jsonResponse({
          value: { favorites: [{ kind: 'module', id: 'base.text' }] },
        })
      }
      return jsonResponse({ value: JSON.parse(String(init.body)).value })
    }) as typeof fetch

    const { result } = renderHook(() => useModuleInserterPreference())
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.toggleFavorite({ kind: 'module', id: 'base.image' })
    })

    await waitFor(() => expect(calls.some((call) => call.init?.method === 'PUT')).toBe(true))
    const save = calls.find((call) => call.init?.method === 'PUT')
    expect(save?.input.toString()).toBe('/admin/api/cms/me/preferences/module-inserter')
    expect(JSON.parse(String(save?.init?.body))).toEqual({
      value: {
        favorites: [
          { kind: 'module', id: 'base.text' },
          { kind: 'module', id: 'base.image' },
        ],
      },
    })
  })

  it('keeps separate hook consumers in sync when favorites change', async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) {
        return jsonResponse({
          value: { favorites: [{ kind: 'module', id: 'base.text' }] },
        })
      }
      return jsonResponse({ value: JSON.parse(String(init.body)).value })
    }) as typeof fetch

    const first = renderHook(() => useModuleInserterPreference())
    const second = renderHook(() => useModuleInserterPreference())
    await waitFor(() => expect(first.result.current.loading).toBe(false))
    await waitFor(() => expect(second.result.current.loading).toBe(false))

    act(() => {
      first.result.current.toggleFavorite({ kind: 'module', id: 'base.list' })
    })

    await waitFor(() => {
      expect(second.result.current.favorites).toEqual([
        { kind: 'module', id: 'base.text' },
        { kind: 'module', id: 'base.list' },
      ])
    })
  })

  it('logs load failures and keeps default favorites available', async () => {
    const logged = mock(() => {})
    console.error = logged as typeof console.error
    globalThis.fetch = mock(async () => jsonResponse({ error: 'nope' }, 500)) as typeof fetch

    const { result } = renderHook(() => useModuleInserterPreference())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.favorites).toEqual(DEFAULT_MODULE_INSERTER_PREFERENCE.favorites)
    expect(result.current.error).toBe('nope')
    expect(logged).toHaveBeenCalled()
  })
})
