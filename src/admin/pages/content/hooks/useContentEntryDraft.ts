import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import {
  publishCmsDataRow,
  saveCmsDataRowDraft,
  updateCmsDataRowStatus,
} from '@core/persistence'
import {
  createParagraphBlock,
  parseMarkdownBlocks,
  serializeMarkdownBlocks,
} from '@core/markdown/blockModel'
import type { ContentBlock } from '@core/markdown/blockModel'
import type { DataRow, DataRowStatus } from '@core/data/schemas'
import {
  readBodyCell,
  readFeaturedMediaCell,
  readSeoDescriptionCell,
  readSeoTitleCell,
  readSlugCell,
  readTitleCell,
} from '@core/data/cells'
import { slugFromTitle } from '@core/utils/slug'

export type SaveMessage = 'idle' | 'saving' | 'saved' | 'publishing' | 'published' | 'error'

interface UseContentEntryDraftOptions {
  selectedEntry: DataRow | null
  updateSelectedEntry: (entry: DataRow) => void
  setError: (message: string | null) => void
}

export function useContentEntryDraft({
  selectedEntry,
  updateSelectedEntry,
  setError,
}: UseContentEntryDraftOptions) {
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [seoTitle, setSeoTitle] = useState('')
  const [seoDescription, setSeoDescription] = useState('')
  const [featuredMediaId, setFeaturedMediaId] = useState<string | null>(null)
  const [blocks, setBlocks] = useState<ContentBlock[]>([createParagraphBlock()])
  const [saveMessage, setSaveMessage] = useState<SaveMessage>('idle')

  const applySelectedEntry = useCallback((entry: DataRow | null) => {
    setTitle(entry ? readTitleCell(entry.cells) : '')
    setSlug(entry ? readSlugCell(entry.cells) : '')
    setSeoTitle(entry ? readSeoTitleCell(entry.cells) : '')
    setSeoDescription(entry ? readSeoDescriptionCell(entry.cells) : '')
    setFeaturedMediaId(entry ? readFeaturedMediaCell(entry.cells) : null)
    setBlocks(entry ? parseMarkdownBlocks(readBodyCell(entry.cells)) : [createParagraphBlock()])
    setSaveMessage('idle')
  }, [])

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useLayoutEffect(() => {
    applySelectedEntry(selectedEntry)
  }, [applySelectedEntry, selectedEntry?.id])
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  const applyEntryFields = useCallback((entry: DataRow) => {
    setTitle(readTitleCell(entry.cells))
    setSlug(readSlugCell(entry.cells))
    setSeoTitle(readSeoTitleCell(entry.cells))
    setSeoDescription(readSeoDescriptionCell(entry.cells))
    setFeaturedMediaId(readFeaturedMediaCell(entry.cells))
  }, [])

  const isDirty = useMemo(() => {
    if (!selectedEntry) return false
    return title !== readTitleCell(selectedEntry.cells) ||
      slug !== readSlugCell(selectedEntry.cells) ||
      seoTitle !== readSeoTitleCell(selectedEntry.cells) ||
      seoDescription !== readSeoDescriptionCell(selectedEntry.cells) ||
      featuredMediaId !== readFeaturedMediaCell(selectedEntry.cells) ||
      serializeMarkdownBlocks(blocks) !== readBodyCell(selectedEntry.cells)
  }, [blocks, featuredMediaId, selectedEntry, seoDescription, seoTitle, slug, title])

  const saveDraft = useCallback(async (): Promise<DataRow | null> => {
    if (!selectedEntry) return null
    const nextTitle = title.trim() || 'Untitled'
    const nextSlug = slugFromTitle(slug || nextTitle)
    const row = await saveCmsDataRowDraft(selectedEntry.id, {
      cells: {
        ...selectedEntry.cells,
        title: nextTitle,
        slug: nextSlug,
        body: serializeMarkdownBlocks(blocks),
        featuredMedia: featuredMediaId,
        seoTitle: seoTitle.trim(),
        seoDescription: seoDescription.trim(),
      },
    })
    updateSelectedEntry(row)
    applyEntryFields(row)
    return row
  }, [
    applyEntryFields,
    blocks,
    featuredMediaId,
    selectedEntry,
    seoDescription,
    seoTitle,
    slug,
    title,
    updateSelectedEntry,
  ])

  const handleSaveDraft = useCallback(async () => {
    setSaveMessage('saving')
    setError(null)
    try {
      await saveDraft()
      setSaveMessage('saved')
    } catch (err) {
      setSaveMessage('error')
      setError(err instanceof Error ? err.message : 'Could not save draft')
    }
  }, [saveDraft, setError])

  const handlePublish = useCallback(async () => {
    if (!selectedEntry) return
    setSaveMessage('publishing')
    setError(null)
    try {
      const savedRow = await saveDraft()
      if (!savedRow) return
      const publishedRow = await publishCmsDataRow(savedRow.id)
      updateSelectedEntry({
        ...savedRow,
        status: publishedRow.status,
        updatedAt: publishedRow.updatedAt,
        publishedAt: publishedRow.publishedAt,
        deletedAt: publishedRow.deletedAt,
      })
      setSaveMessage('published')
    } catch (err) {
      setSaveMessage('error')
      setError(err instanceof Error ? err.message : 'Could not publish entry')
    }
  }, [saveDraft, selectedEntry, setError, updateSelectedEntry])

  const handleStatusChange = useCallback(async (nextStatus: DataRowStatus) => {
    if (!selectedEntry || nextStatus === selectedEntry.status) return

    if (nextStatus === 'published') {
      await handlePublish()
      return
    }

    setSaveMessage('saving')
    setError(null)
    try {
      const savedRow = await saveDraft()
      if (!savedRow) return
      const updatedRow = await updateCmsDataRowStatus(savedRow.id, nextStatus)
      updateSelectedEntry(updatedRow)
      applyEntryFields(updatedRow)
      setSaveMessage('idle')
    } catch (err) {
      setSaveMessage('error')
      setError(err instanceof Error ? err.message : 'Could not update entry status')
    }
  }, [applyEntryFields, handlePublish, saveDraft, selectedEntry, setError, updateSelectedEntry])

  return {
    title,
    slug,
    seoTitle,
    seoDescription,
    featuredMediaId,
    blocks,
    isDirty,
    saveMessage,
    setTitle,
    setSlug,
    setSeoTitle,
    setSeoDescription,
    setFeaturedMediaId,
    setBlocks,
    setSaveMessage,
    handleSaveDraft,
    handlePublish,
    handleStatusChange,
    applySelectedEntry,
  }
}
