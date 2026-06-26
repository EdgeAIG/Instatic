import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createCapabilityTestHarness, readJson, type CapabilityTestHarness } from '../helpers/capabilityHarness'
import { __resetMasterKeyCacheForTesting } from '../../../server/secrets/masterKey'

describe('AI defaults handler', () => {
  let harness: CapabilityTestHarness
  let originalFetch: typeof globalThis.fetch
  let originalWarn: typeof console.warn
  let originalError: typeof console.error

  beforeEach(async () => {
    originalFetch = globalThis.fetch
    originalWarn = console.warn
    originalError = console.error
    __resetMasterKeyCacheForTesting()
    harness = await createCapabilityTestHarness()
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    console.warn = originalWarn
    console.error = originalError
    __resetMasterKeyCacheForTesting()
    await harness.cleanup()
  })

  it('clears a default so the credential can be deleted', async () => {
    const cookie = await harness.setupOwner()
    console.warn = () => {}
    console.error = () => {}
    globalThis.fetch = async (input) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
      if (url === 'http://127.0.0.1:1/api/tags') {
        throw new Error('ollama offline')
      }
      return originalFetch(input)
    }

    const createRes = await harness.ai('/admin/api/ai/credentials', {
      method: 'POST',
      cookie,
      json: {
        providerId: 'ollama',
        authMode: 'baseUrl',
        displayLabel: 'Local Ollama',
        baseUrl: 'http://127.0.0.1:1',
      },
    })
    expect(createRes.status).toBe(201)
    const createBody = await readJson<{ credential: { id: string } }>(createRes)

    const setRes = await harness.ai('/admin/api/ai/defaults/data', {
      method: 'PUT',
      cookie,
      json: {
        credentialId: createBody.credential.id,
        modelId: 'llama4',
      },
    })
    expect(setRes.status).toBe(200)

    const clearRes = await harness.ai('/admin/api/ai/defaults/data', {
      method: 'DELETE',
      cookie,
    })
    expect(clearRes.status).toBe(204)

    const defaultsRes = await harness.ai('/admin/api/ai/defaults', {
      method: 'GET',
      cookie,
    })
    expect(defaultsRes.status).toBe(200)
    const defaultsBody = await readJson<{ defaults: Record<string, unknown> }>(defaultsRes)
    expect(defaultsBody.defaults.data).toBeUndefined()

    const deleteRes = await harness.ai(`/admin/api/ai/credentials/${createBody.credential.id}`, {
      method: 'DELETE',
      cookie,
    })
    expect(deleteRes.status).toBe(200)
  })
})
