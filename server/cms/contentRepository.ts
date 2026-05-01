import { nanoid } from 'nanoid'
import type { DbClient } from './db'
import { normalizeRouteBase } from '../../src/core/templates/templateMatching'

type ContentEntryStatus = 'draft' | 'published' | 'unpublished'

interface ContentCollection {
  id: string
  name: string
  slug: string
  routeBase: string
  singularLabel: string
  pluralLabel: string
  createdAt: string
  updatedAt: string
}

interface ContentEntry {
  id: string
  collectionId: string
  title: string
  slug: string
  status: ContentEntryStatus
  bodyMarkdown: string
  featuredMediaId: string | null
  seoTitle: string
  seoDescription: string
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  deletedAt: string | null
}

export interface PublishedContentEntry {
  id: string
  entryId: string
  collectionId: string
  collectionSlug: string
  collectionRouteBase: string
  versionNumber: number
  title: string
  slug: string
  bodyMarkdown: string
  featuredMediaId: string | null
  featuredMediaPath: string | null
  seoTitle: string
  seoDescription: string
  publishedAt: string
  createdAt: string
}

interface ContentEntryVersion {
  id: string
  entryId: string
  versionNumber: number
  title: string
  slug: string
  bodyMarkdown: string
  featuredMediaId: string | null
  seoTitle: string
  seoDescription: string
  publishedAt: string
  createdAt: string
}

interface CreateContentCollectionInput {
  id?: string
  name: string
  slug: string
  routeBase?: string
  singularLabel: string
  pluralLabel: string
}

interface UpdateContentCollectionInput {
  routeBase: string
}

interface CreateContentEntryInput {
  id?: string
  collectionId: string
  title: string
  slug: string
  bodyMarkdown?: string
  featuredMediaId?: string | null
  seoTitle?: string
  seoDescription?: string
}

interface SaveContentEntryDraftInput {
  title: string
  slug: string
  bodyMarkdown: string
  featuredMediaId: string | null
  seoTitle: string
  seoDescription: string
}

interface ContentCollectionRow {
  id: string
  name: string
  slug: string
  route_base: string
  singular_label: string
  plural_label: string
  created_at: Date | string
  updated_at: Date | string
}

interface ContentEntryRow {
  id: string
  collection_id: string
  title: string
  slug: string
  status: ContentEntryStatus
  body_markdown: string
  featured_media_id: string | null
  seo_title: string
  seo_description: string
  created_at: Date | string
  updated_at: Date | string
  published_at: Date | string | null
  deleted_at: Date | string | null
}

interface ContentEntryVersionRow {
  id: string
  entry_id: string
  version_number: number
  title: string
  slug: string
  body_markdown: string
  featured_media_id: string | null
  seo_title: string
  seo_description: string
  published_at: Date | string
  created_at: Date | string
}

interface PublishedContentEntryRow extends ContentEntryVersionRow {
  collection_id: string
  collection_slug: string
  collection_route_base: string
  featured_media_path: string | null
}

interface PreviousPublishedRouteRow {
  previous_slug: string
  previous_route_base: string
}

interface ContentEntryRedirectRow {
  id: string
  from_route_base: string
  from_slug: string
  target_route_base: string
  target_slug: string
}

export interface ContentEntryRedirect {
  id: string
  fromPath: string
  targetPath: string
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toNullableIsoString(value: Date | string | null): string | null {
  return value ? toIsoString(value) : null
}

function mapCollection(row: ContentCollectionRow): ContentCollection {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    routeBase: row.route_base ? normalizeRouteBase(row.route_base) : normalizeRouteBase(row.slug),
    singularLabel: row.singular_label,
    pluralLabel: row.plural_label,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  }
}

function mapEntry(row: ContentEntryRow): ContentEntry {
  return {
    id: row.id,
    collectionId: row.collection_id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    bodyMarkdown: row.body_markdown,
    featuredMediaId: row.featured_media_id,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    publishedAt: toNullableIsoString(row.published_at),
    deletedAt: toNullableIsoString(row.deleted_at),
  }
}

function mapVersion(row: ContentEntryVersionRow): ContentEntryVersion {
  return {
    id: row.id,
    entryId: row.entry_id,
    versionNumber: Number(row.version_number),
    title: row.title,
    slug: row.slug,
    bodyMarkdown: row.body_markdown,
    featuredMediaId: row.featured_media_id,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    publishedAt: toIsoString(row.published_at),
    createdAt: toIsoString(row.created_at),
  }
}

function mapPublishedEntry(row: PublishedContentEntryRow): PublishedContentEntry {
  return {
    ...mapVersion(row),
    collectionId: row.collection_id,
    collectionSlug: row.collection_slug,
    collectionRouteBase: row.collection_route_base
      ? normalizeRouteBase(row.collection_route_base)
      : normalizeRouteBase(row.collection_slug),
    featuredMediaPath: row.featured_media_path,
  }
}

function publicContentPath(routeBase: string, slug: string): string {
  const normalizedBase = normalizeRouteBase(routeBase)
  return `${normalizedBase === '/' ? '' : normalizedBase}/${slug}`
}

function mapRedirect(row: ContentEntryRedirectRow): ContentEntryRedirect | null {
  const fromPath = publicContentPath(row.from_route_base, row.from_slug)
  const targetPath = publicContentPath(row.target_route_base, row.target_slug)
  if (fromPath === targetPath) return null
  return {
    id: row.id,
    fromPath,
    targetPath,
  }
}

export async function listContentCollections(db: DbClient): Promise<ContentCollection[]> {
  const result = await db.query<ContentCollectionRow>(
    `select id, name, slug, route_base, singular_label, plural_label, created_at, updated_at
     from content_collections
     where deleted_at is null
     order by created_at asc`,
  )
  return result.rows.map(mapCollection)
}

export async function createContentCollection(
  db: DbClient,
  input: CreateContentCollectionInput,
): Promise<ContentCollection> {
  const result = await db.query<ContentCollectionRow>(
    `insert into content_collections (id, name, slug, route_base, singular_label, plural_label)
     values ($1, $2, $3, $4, $5, $6)
     returning id, name, slug, route_base, singular_label, plural_label, created_at, updated_at`,
    [
      input.id ?? nanoid(),
      input.name,
      input.slug,
      normalizeRouteBase(input.routeBase ?? input.slug),
      input.singularLabel,
      input.pluralLabel,
    ],
  )
  return mapCollection(result.rows[0])
}

export async function updateContentCollection(
  db: DbClient,
  collectionId: string,
  input: UpdateContentCollectionInput,
): Promise<ContentCollection | null> {
  const result = await db.query<ContentCollectionRow>(
    `update content_collections
     set route_base = $2,
         updated_at = now()
     where id = $1
       and deleted_at is null
     returning id, name, slug, route_base, singular_label, plural_label, created_at, updated_at`,
    [collectionId, normalizeRouteBase(input.routeBase)],
  )
  return result.rows[0] ? mapCollection(result.rows[0]) : null
}

export async function softDeleteContentCollection(
  db: DbClient,
  collectionId: string,
): Promise<ContentCollection | null> {
  if (collectionId === 'posts') return null

  const entries = await db.query<{ count: number }>(
    `select count(*)::int as count
     from content_entries
     where collection_id = $1
       and deleted_at is null`,
    [collectionId],
  )
  if (Number(entries.rows[0]?.count ?? 0) > 0) return null

  const result = await db.query<ContentCollectionRow>(
    `update content_collections
     set deleted_at = now(), updated_at = now()
     where id = $1
       and deleted_at is null
     returning id, name, slug, route_base, singular_label, plural_label, created_at, updated_at`,
    [collectionId],
  )
  return result.rows[0] ? mapCollection(result.rows[0]) : null
}

export async function listContentEntries(
  db: DbClient,
  collectionId: string,
): Promise<ContentEntry[]> {
  const result = await db.query<ContentEntryRow>(
    `select id, collection_id, title, slug, status, body_markdown, featured_media_id,
            seo_title, seo_description, created_at, updated_at, published_at, deleted_at
     from content_entries
     where collection_id = $1
       and deleted_at is null
     order by updated_at desc, created_at desc`,
    [collectionId],
  )
  return result.rows.map(mapEntry)
}

export async function getContentEntry(
  db: DbClient,
  entryId: string,
): Promise<ContentEntry | null> {
  const result = await db.query<ContentEntryRow>(
    `select id, collection_id, title, slug, status, body_markdown, featured_media_id,
            seo_title, seo_description, created_at, updated_at, published_at, deleted_at
     from content_entries
     where id = $1
       and deleted_at is null
     limit 1`,
    [entryId],
  )
  return result.rows[0] ? mapEntry(result.rows[0]) : null
}

export async function createContentEntry(
  db: DbClient,
  input: CreateContentEntryInput,
): Promise<ContentEntry> {
  const result = await db.query<ContentEntryRow>(
    `insert into content_entries (id, collection_id, title, slug, status, body_markdown, featured_media_id, seo_title, seo_description)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning id, collection_id, title, slug, status, body_markdown, featured_media_id,
               seo_title, seo_description, created_at, updated_at, published_at, deleted_at`,
    [
      input.id ?? nanoid(),
      input.collectionId,
      input.title,
      input.slug,
      'draft',
      input.bodyMarkdown ?? '',
      input.featuredMediaId ?? null,
      input.seoTitle ?? '',
      input.seoDescription ?? '',
    ],
  )
  return mapEntry(result.rows[0])
}

export async function saveContentEntryDraft(
  db: DbClient,
  entryId: string,
  input: SaveContentEntryDraftInput,
): Promise<ContentEntry | null> {
  const result = await db.query<ContentEntryRow>(
    `update content_entries
     set title = $2,
         slug = $3,
         body_markdown = $4,
         featured_media_id = $5,
         seo_title = $6,
         seo_description = $7,
         updated_at = now()
     where id = $1
       and deleted_at is null
     returning id, collection_id, title, slug, status, body_markdown, featured_media_id,
               seo_title, seo_description, created_at, updated_at, published_at, deleted_at`,
    [
      entryId,
      input.title,
      input.slug,
      input.bodyMarkdown,
      input.featuredMediaId,
      input.seoTitle,
      input.seoDescription,
    ],
  )
  return result.rows[0] ? mapEntry(result.rows[0]) : null
}

export async function softDeleteContentEntry(
  db: DbClient,
  entryId: string,
): Promise<ContentEntry | null> {
  const result = await db.query<ContentEntryRow>(
    `update content_entries
     set deleted_at = now(), updated_at = now()
     where id = $1
       and deleted_at is null
     returning id, collection_id, title, slug, status, body_markdown, featured_media_id,
               seo_title, seo_description, created_at, updated_at, published_at, deleted_at`,
    [entryId],
  )
  return result.rows[0] ? mapEntry(result.rows[0]) : null
}

export async function updateContentEntryStatus(
  db: DbClient,
  entryId: string,
  status: Exclude<ContentEntryStatus, 'published'>,
): Promise<ContentEntry | null> {
  const result = await db.query<ContentEntryRow>(
    `update content_entries
     set status = $2,
         published_at = null,
         updated_at = now()
     where id = $1
       and deleted_at is null
     returning id, collection_id, title, slug, status, body_markdown, featured_media_id,
               seo_title, seo_description, created_at, updated_at, published_at, deleted_at`,
    [entryId, status],
  )
  return result.rows[0] ? mapEntry(result.rows[0]) : null
}

export async function publishContentEntry(
  db: DbClient,
  entryId: string,
  _adminUserId: string,
): Promise<{ entry: ContentEntry; version: ContentEntryVersion }> {
  await db.query('begin')
  try {
    const entry = await getContentEntry(db, entryId)
    if (!entry) throw new Error('content entry not found')

    const previousRouteResult = await db.query<PreviousPublishedRouteRow>(
      `select content_entry_versions.slug as previous_slug,
              coalesce(nullif(content_collections.route_base, ''), '/' || content_collections.slug) as previous_route_base
       from content_entries
       join content_collections on content_collections.id = content_entries.collection_id
       join content_entry_versions on content_entry_versions.id = content_entries.active_version_id
       where content_entries.id = $1
         and content_entries.deleted_at is null
         and content_collections.deleted_at is null
       limit 1`,
      [entryId],
    )

    const versionResult = await db.query<{ next_version: number }>(
      `select coalesce(max(version_number), 0)::int + 1 as next_version
       from content_entry_versions
       where entry_id = $1`,
      [entryId],
    )
    const versionNumber = Number(versionResult.rows[0]?.next_version ?? 1)
    const versionId = nanoid()

    await db.query(
      `insert into content_entry_versions (id, entry_id, version_number, title, slug, body_markdown, featured_media_id, seo_title, seo_description)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        versionId,
        entry.id,
        versionNumber,
        entry.title,
        entry.slug,
        entry.bodyMarkdown,
        entry.featuredMediaId,
        entry.seoTitle,
        entry.seoDescription,
      ],
    )

    const updateResult = await db.query<ContentEntryRow>(
      `update content_entries set status = 'published',
                                 active_version_id = $2,
                                 published_at = now(),
                                 updated_at = now()
       where id = $1
         and deleted_at is null
       returning id, collection_id, title, slug, status, body_markdown, featured_media_id,
                 seo_title, seo_description, created_at, updated_at, published_at, deleted_at`,
      [entry.id, versionId],
    )

    const previousRoute = previousRouteResult.rows[0]
    if (
      previousRoute?.previous_slug &&
      publicContentPath(previousRoute.previous_route_base, previousRoute.previous_slug) !==
        publicContentPath(previousRoute.previous_route_base, entry.slug)
    ) {
      await db.query(
        `insert into content_entry_redirects (id, collection_id, from_route_base, from_slug, target_entry_id)
         values ($1, $2, $3, $4, $5)
         on conflict (from_route_base, from_slug) do update
           set collection_id = excluded.collection_id,
               target_entry_id = excluded.target_entry_id`,
        [
          nanoid(),
          entry.collectionId,
          normalizeRouteBase(previousRoute.previous_route_base),
          previousRoute.previous_slug,
          entry.id,
        ],
      )
    }

    await db.query('commit')
    return {
      entry: mapEntry(updateResult.rows[0]),
      version: {
        id: versionId,
        entryId: entry.id,
        versionNumber,
        title: entry.title,
        slug: entry.slug,
        bodyMarkdown: entry.bodyMarkdown,
        featuredMediaId: entry.featuredMediaId,
        seoTitle: entry.seoTitle,
        seoDescription: entry.seoDescription,
        publishedAt: updateResult.rows[0]?.published_at
          ? toIsoString(updateResult.rows[0].published_at)
          : new Date().toISOString(),
        createdAt: updateResult.rows[0]?.published_at
          ? toIsoString(updateResult.rows[0].published_at)
          : new Date().toISOString(),
      },
    }
  } catch (err) {
    await db.query('rollback')
    throw err
  }
}

export async function getPublishedContentEntryByRoute(
  db: DbClient,
  collectionRouteBase: string,
  entrySlug: string,
): Promise<PublishedContentEntry | null> {
  const result = await db.query<PublishedContentEntryRow>(
    `select content_entry_versions.id,
            content_entry_versions.entry_id,
            content_entries.collection_id,
            content_collections.slug as collection_slug,
            content_collections.route_base as collection_route_base,
            content_entry_versions.version_number,
            content_entry_versions.title,
            content_entry_versions.slug,
            content_entry_versions.body_markdown,
            content_entry_versions.featured_media_id,
            media_assets.public_path as featured_media_path,
            content_entry_versions.seo_title,
            content_entry_versions.seo_description,
            content_entry_versions.published_at,
            content_entry_versions.created_at
     from content_entries
     join content_collections on content_collections.id = content_entries.collection_id
     join content_entry_versions on content_entry_versions.id = content_entries.active_version_id
     left join media_assets on media_assets.id = content_entry_versions.featured_media_id
     where coalesce(nullif(content_collections.route_base, ''), '/' || content_collections.slug) = $1
       and content_entry_versions.slug = $2
       and content_entries.status = 'published'
       and content_entries.deleted_at is null
       and content_collections.deleted_at is null
     limit 1`,
    [normalizeRouteBase(collectionRouteBase), entrySlug],
  )
  return result.rows[0] ? mapPublishedEntry(result.rows[0]) : null
}

export async function getContentEntryRedirectByRoute(
  db: DbClient,
  collectionRouteBase: string,
  entrySlug: string,
): Promise<ContentEntryRedirect | null> {
  const result = await db.query<ContentEntryRedirectRow>(
    `select content_entry_redirects.id,
            content_entry_redirects.from_route_base,
            content_entry_redirects.from_slug,
            coalesce(nullif(target_collections.route_base, ''), '/' || target_collections.slug) as target_route_base,
            content_entry_versions.slug as target_slug
     from content_entry_redirects
     join content_entries target_entries on target_entries.id = content_entry_redirects.target_entry_id
     join content_collections target_collections on target_collections.id = target_entries.collection_id
     join content_entry_versions on content_entry_versions.id = target_entries.active_version_id
     where content_entry_redirects.from_route_base = $1
       and content_entry_redirects.from_slug = $2
       and target_entries.status = 'published'
       and target_entries.deleted_at is null
       and target_collections.deleted_at is null
     limit 1`,
    [normalizeRouteBase(collectionRouteBase), entrySlug],
  )
  return result.rows[0] ? mapRedirect(result.rows[0]) : null
}
