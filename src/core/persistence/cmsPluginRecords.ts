import type { PluginRecord, PluginResource } from '../plugin-sdk'
import { responseErrorMessage } from './httpErrors'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

interface PluginRecordsPayload {
  resource?: PluginResource
  records?: PluginRecord[]
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    throw new Error(await responseErrorMessage(res, fallback))
  }
  return await res.json() as T
}

function recordsPath(basePath: string, pluginId: string, resourceId: string): string {
  return `${basePath}/plugins/${encodeURIComponent(pluginId)}/resources/${encodeURIComponent(resourceId)}/records`
}

export async function listCmsPluginResourceRecords(
  pluginId: string,
  resourceId: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/api/cms',
): Promise<PluginRecord[]> {
  const res = await fetchImpl(recordsPath(basePath, pluginId, resourceId), {
    method: 'GET',
    credentials: 'include',
  })
  const body = await readJson<PluginRecordsPayload>(
    res,
    `CMS plugin records failed with ${res.status}`,
  )
  return Array.isArray(body.records) ? body.records : []
}

export async function loadCmsPluginResource(
  pluginId: string,
  resourceId: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/api/cms',
): Promise<{ resource: PluginResource; records: PluginRecord[] }> {
  const res = await fetchImpl(recordsPath(basePath, pluginId, resourceId), {
    method: 'GET',
    credentials: 'include',
  })
  const body = await readJson<PluginRecordsPayload>(
    res,
    `CMS plugin resource failed with ${res.status}`,
  )
  if (!body.resource) throw new Error('CMS plugin resource response was missing resource')
  return {
    resource: body.resource,
    records: Array.isArray(body.records) ? body.records : [],
  }
}

export async function createCmsPluginResourceRecord(
  pluginId: string,
  resourceId: string,
  data: Record<string, unknown>,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/api/cms',
): Promise<PluginRecord> {
  const res = await fetchImpl(recordsPath(basePath, pluginId, resourceId), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data }),
  })
  const body = await readJson<{ record?: PluginRecord }>(
    res,
    `CMS plugin record create failed with ${res.status}`,
  )
  if (!body.record) throw new Error('CMS plugin record create response was missing record')
  return body.record
}

export async function updateCmsPluginResourceRecord(
  pluginId: string,
  resourceId: string,
  recordId: string,
  data: Record<string, unknown>,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/api/cms',
): Promise<PluginRecord> {
  const res = await fetchImpl(`${recordsPath(basePath, pluginId, resourceId)}/${encodeURIComponent(recordId)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data }),
  })
  const body = await readJson<{ record?: PluginRecord }>(
    res,
    `CMS plugin record update failed with ${res.status}`,
  )
  if (!body.record) throw new Error('CMS plugin record update response was missing record')
  return body.record
}

export async function deleteCmsPluginResourceRecord(
  pluginId: string,
  resourceId: string,
  recordId: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/api/cms',
): Promise<void> {
  const res = await fetchImpl(`${recordsPath(basePath, pluginId, resourceId)}/${encodeURIComponent(recordId)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) {
    throw new Error(await responseErrorMessage(res, `CMS plugin record delete failed with ${res.status}`))
  }
}
