import type {
  ContentCollection,
  ContentEntry,
  ContentEntryDraftInput,
  ContentEntryStatus,
  CreateContentEntryInput,
  UpdateContentCollectionInput,
} from '../../content/types'
import { responseErrorMessage } from './httpErrors'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    throw new Error(await responseErrorMessage(res, fallback))
  }
  return await res.json() as T
}

export async function listCmsContentCollections(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/api/cms',
): Promise<ContentCollection[]> {
  const res = await fetchImpl(`${basePath}/content/collections`, {
    method: 'GET',
    credentials: 'include',
  })
  const body = await readJson<{ collections?: ContentCollection[] }>(
    res,
    `CMS content collections failed with ${res.status}`,
  )
  return Array.isArray(body.collections) ? body.collections : []
}

export async function listCmsContentEntries(
  collectionId: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/api/cms',
): Promise<ContentEntry[]> {
  const res = await fetchImpl(`${basePath}/content/collections/${encodeURIComponent(collectionId)}/entries`, {
    method: 'GET',
    credentials: 'include',
  })
  const body = await readJson<{ entries?: ContentEntry[] }>(
    res,
    `CMS content entries failed with ${res.status}`,
  )
  return Array.isArray(body.entries) ? body.entries : []
}

export async function updateCmsContentCollection(
  collectionId: string,
  input: UpdateContentCollectionInput,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/api/cms',
): Promise<ContentCollection> {
  const res = await fetchImpl(`${basePath}/content/collections/${encodeURIComponent(collectionId)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await readJson<{ collection?: ContentCollection }>(
    res,
    `CMS content collection update failed with ${res.status}`,
  )
  if (!body.collection) throw new Error('CMS content collection update response was missing collection')
  return body.collection
}

export async function createCmsContentEntry(
  collectionId: string,
  input: CreateContentEntryInput,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/api/cms',
): Promise<ContentEntry> {
  const res = await fetchImpl(`${basePath}/content/collections/${encodeURIComponent(collectionId)}/entries`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await readJson<{ entry: ContentEntry }>(
    res,
    `CMS content entry create failed with ${res.status}`,
  )
  return body.entry
}

export async function saveCmsContentEntryDraft(
  entryId: string,
  input: ContentEntryDraftInput,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/api/cms',
): Promise<ContentEntry> {
  const res = await fetchImpl(`${basePath}/content/entries/${encodeURIComponent(entryId)}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await readJson<{ entry: ContentEntry }>(
    res,
    `CMS content entry save failed with ${res.status}`,
  )
  return body.entry
}

export async function publishCmsContentEntry(
  entryId: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/api/cms',
): Promise<ContentEntry> {
  const res = await fetchImpl(`${basePath}/content/entries/${encodeURIComponent(entryId)}/publish`, {
    method: 'POST',
    credentials: 'include',
  })
  const body = await readJson<{ entry?: ContentEntry }>(
    res,
    `CMS content entry publish failed with ${res.status}`,
  )
  if (!body.entry) throw new Error('CMS content entry publish response was missing entry')
  return body.entry
}

export async function updateCmsContentEntryStatus(
  entryId: string,
  status: Exclude<ContentEntryStatus, 'published'>,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/api/cms',
): Promise<ContentEntry> {
  const res = await fetchImpl(`${basePath}/content/entries/${encodeURIComponent(entryId)}/status`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  const body = await readJson<{ entry?: ContentEntry }>(
    res,
    `CMS content entry status update failed with ${res.status}`,
  )
  if (!body.entry) throw new Error('CMS content entry status response was missing entry')
  return body.entry
}
