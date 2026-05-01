import { describe, expect, it } from 'bun:test'
import type { ContentEntry } from '../../content/types'
import type { CmsMediaAsset } from '../../core/persistence/cmsMedia'
import {
  contentEntryToTemplateEntryData,
  selectLatestTemplatePreviewEntry,
} from '../../core/templates/templatePreviewData'

function entry(overrides: Partial<ContentEntry>): ContentEntry {
  return {
    id: overrides.id ?? 'entry_1',
    collectionId: overrides.collectionId ?? 'posts',
    title: overrides.title ?? 'Post',
    slug: overrides.slug ?? 'post',
    status: overrides.status ?? 'draft',
    bodyMarkdown: overrides.bodyMarkdown ?? '',
    featuredMediaId: overrides.featuredMediaId ?? null,
    seoTitle: overrides.seoTitle ?? '',
    seoDescription: overrides.seoDescription ?? '',
    createdAt: overrides.createdAt ?? '2026-05-01T10:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-05-01T10:00:00.000Z',
    publishedAt: overrides.publishedAt ?? null,
    deletedAt: overrides.deletedAt ?? null,
  }
}

function mediaAsset(overrides: Partial<CmsMediaAsset>): CmsMediaAsset {
  return {
    id: overrides.id ?? 'media_1',
    filename: overrides.filename ?? 'cover.png',
    mimeType: overrides.mimeType ?? 'image/png',
    sizeBytes: overrides.sizeBytes ?? 1024,
    publicPath: overrides.publicPath ?? '/uploads/cover.png',
    createdAt: overrides.createdAt ?? '2026-05-01T10:00:00.000Z',
  }
}

describe('template preview data', () => {
  it('uses the latest content entry as the template preview entry', () => {
    const older = entry({
      id: 'older',
      title: 'Older Post',
      updatedAt: '2026-05-01T09:00:00.000Z',
    })
    const latest = entry({
      id: 'latest',
      title: 'Latest Post',
      updatedAt: '2026-05-01T11:00:00.000Z',
    })

    expect(selectLatestTemplatePreviewEntry([older, latest])?.id).toBe('latest')
  })

  it('maps an editable content entry into dynamic template render data', () => {
    const preview = contentEntryToTemplateEntryData(entry({
      id: 'entry_2',
      title: 'Mapped Post',
      bodyMarkdown: 'Body',
    }))

    expect(preview).toMatchObject({
      id: 'entry_2',
      entryId: 'entry_2',
      collectionId: 'posts',
      collectionSlug: 'posts',
      collectionRouteBase: '/posts',
      title: 'Mapped Post',
      bodyMarkdown: 'Body',
    })
  })

  it('resolves an editable entry featured media id to a preview media path', () => {
    const preview = contentEntryToTemplateEntryData(
      entry({
        featuredMediaId: 'media_cover',
      }),
      [
        mediaAsset({
          id: 'media_cover',
          publicPath: '/uploads/post-cover.png',
        }),
      ],
    )

    expect(preview.featuredMediaPath).toBe('/uploads/post-cover.png')
  })

  it('extracts the first inline body image as template preview data', () => {
    const preview = contentEntryToTemplateEntryData(entry({
      bodyMarkdown: [
        'Intro paragraph',
        '',
        '![Inline hero](/uploads/body-hero.png)',
        '',
        '![Second image](/uploads/second.png)',
      ].join('\n'),
    }))

    expect(preview.firstImagePath).toBe('/uploads/body-hero.png')
  })
})
