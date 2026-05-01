import { useEffect, useState } from 'react'
import type { Page } from '../../core/page-tree'
import type { TemplateRenderDataContext } from '../../core/templates/dynamicBindings'
import {
  contentEntryToTemplateEntryData,
  selectLatestTemplatePreviewEntry,
} from '../../core/templates/templatePreviewData'
import { listCmsContentEntries } from '../../core/persistence/cmsContent'
import { listCmsMediaAssets } from '../../core/persistence/cmsMedia'

export function useTemplatePreviewContext(page: Page | null): TemplateRenderDataContext | undefined {
  const template = page?.template
  const collectionId = template?.enabled && template.context === 'entry'
    ? template.collectionId
    : null
  const [previewState, setPreviewState] = useState<{
    collectionId: string
    context: TemplateRenderDataContext | undefined
  } | null>(null)

  useEffect(() => {
    if (!collectionId) return

    let cancelled = false
    Promise.all([
      listCmsContentEntries(collectionId),
      listCmsMediaAssets().catch(() => []),
    ])
      .then(([entries, mediaAssets]) => {
        if (cancelled) return
        const latestEntry = selectLatestTemplatePreviewEntry(entries)
        setPreviewState({
          collectionId,
          context: latestEntry
            ? { currentEntry: contentEntryToTemplateEntryData(latestEntry, mediaAssets) }
            : undefined,
        })
      })
      .catch(() => {
        if (!cancelled) setPreviewState({ collectionId, context: undefined })
      })

    return () => {
      cancelled = true
    }
  }, [collectionId])

  return previewState?.collectionId === collectionId ? previewState.context : undefined
}
