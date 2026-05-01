import type { ContentEntry } from '../../content/types'
import type { CmsMediaAsset } from '../persistence/cmsMedia'
import { firstImagePathFromMarkdown, type TemplateEntryData } from './dynamicBindings'
import { normalizeRouteBase } from './templateMatching'

function dateTimestamp(value: string | null | undefined): number {
  const timestamp = Date.parse(value ?? '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

function entryTimestamp(entry: ContentEntry): number {
  return Math.max(
    dateTimestamp(entry.updatedAt),
    dateTimestamp(entry.publishedAt),
    dateTimestamp(entry.createdAt),
  )
}

export function selectLatestTemplatePreviewEntry(entries: ContentEntry[]): ContentEntry | null {
  if (entries.length === 0) return null
  return [...entries].sort((a, b) => entryTimestamp(b) - entryTimestamp(a))[0] ?? null
}

function mediaPublicPath(mediaAssets: CmsMediaAsset[], mediaId: string | null): string | null {
  if (!mediaId) return null
  return mediaAssets.find((asset) => asset.id === mediaId)?.publicPath ?? null
}

export function contentEntryToTemplateEntryData(
  entry: ContentEntry,
  mediaAssets: CmsMediaAsset[] = [],
): TemplateEntryData {
  return {
    id: entry.id,
    entryId: entry.id,
    collectionId: entry.collectionId,
    collectionSlug: entry.collectionId,
    collectionRouteBase: normalizeRouteBase(entry.collectionId),
    title: entry.title,
    slug: entry.slug,
    bodyMarkdown: entry.bodyMarkdown,
    featuredMediaId: entry.featuredMediaId,
    featuredMediaPath: mediaPublicPath(mediaAssets, entry.featuredMediaId),
    firstImagePath: firstImagePathFromMarkdown(entry.bodyMarkdown),
    seoTitle: entry.seoTitle,
    seoDescription: entry.seoDescription,
    publishedAt: entry.publishedAt ?? '',
    createdAt: entry.createdAt,
  }
}
