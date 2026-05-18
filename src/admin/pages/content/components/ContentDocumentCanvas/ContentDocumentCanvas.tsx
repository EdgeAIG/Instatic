import { useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { Button } from '@ui/components/Button'
import { Textarea } from '@ui/components/Input'
import { cn } from '@ui/cn'
import { FilePlusSolidIcon } from 'pixel-art-icons/icons/file-plus-solid'
import { createParagraphBlock } from '@core/markdown/blockModel'
import { dataTableHasField } from '@core/data/fields'
import { POST_TYPE_FIELD_BODY } from '@core/data/schemas'
import type { ContentBlock } from '@core/markdown/blockModel'
import type { DataTable, DataRow } from '@core/data/schemas'
import { CanvasNotch, type CanvasNotchAction } from '@site/canvas/CanvasNotch'
import canvasStyles from '../../../site/canvas/CanvasRoot.module.css'
import { RichMarkdownEditor } from '@content/RichMarkdownEditor'
import styles from '../../ContentPage.module.css'

interface ContentDocumentCanvasProps {
  selectedEntry: DataRow | null
  selectedCollection: DataTable | null
  loading: boolean
  title: string
  blocks: ContentBlock[]
  notchActions: CanvasNotchAction[]
  canEditEntry: boolean
  canCreateEntry: boolean
  /**
   * Bumped by the parent whenever the title field should be re-focused
   * (e.g. just after a new entry was created). Using a counter rather than
   * a boolean lets us re-trigger focus for back-to-back creations.
   */
  focusTitleSignal: number
  /**
   * Bumped by the parent whenever the body editor should focus its first
   * editable block (e.g. when Enter was pressed in the title field).
   */
  focusBodySignal: number
  onTitleChange: (value: string) => void
  onTitleEnter: () => void
  onBlocksChange: (blocks: ContentBlock[]) => void
  onRequestMedia: (blockId: string) => void
  onCreateEntry: () => void
}

export function ContentDocumentCanvas({
  selectedEntry,
  selectedCollection,
  loading,
  title,
  blocks,
  notchActions,
  canEditEntry,
  canCreateEntry,
  focusTitleSignal,
  focusBodySignal,
  onTitleChange,
  onTitleEnter,
  onBlocksChange,
  onRequestMedia,
  onCreateEntry,
}: ContentDocumentCanvasProps) {
  const titleFieldRef = useRef<HTMLTextAreaElement | null>(null)
  const bodyEnabled = selectedCollection ? dataTableHasField(selectedCollection, POST_TYPE_FIELD_BODY) : false
  const editorEnabled = Boolean(selectedEntry && canEditEntry)
  const showInsertNotch = bodyEnabled && (editorEnabled || (!selectedEntry && canCreateEntry))
  const singularLabel = selectedCollection?.singularLabel.toLowerCase() ?? 'entry'

  useLayoutEffect(() => {
    resizeTitleField(titleFieldRef.current)
  }, [title])

  // Focus the title field whenever the parent bumps the signal. We skip the
  // initial mount (signal === 0) so navigating to an existing entry doesn't
  // hijack focus.
  useLayoutEffect(() => {
    if (focusTitleSignal === 0) return
    const node = titleFieldRef.current
    if (!node || node.disabled) return
    node.focus()
    const length = node.value.length
    node.setSelectionRange(length, length)
  }, [focusTitleSignal])

  function handleTitleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    // Title is a single-line field: Enter should jump to the body editor
    // rather than inserting a newline.
    event.preventDefault()
    onTitleEnter()
  }

  const addControl = bodyEnabled ? (
    <Button
      variant="primary"
      size="sm"
      className={styles.notchAddButton}
      disabled={loading || !editorEnabled}
      onClick={() => onBlocksChange([...blocks, createParagraphBlock()])}
    >
      <FilePlusSolidIcon size={14} aria-hidden="true" />
      <span>Add</span>
    </Button>
  ) : null

  return (
    <div
      role="region"
      aria-label="Content canvas"
      data-testid="content-canvas-root"
      className={cn(canvasStyles.canvas, styles.contentCanvas)}
    >
      {showInsertNotch && (
        <CanvasNotch
          actions={notchActions}
          addControl={addControl}
          showHistoryControls={false}
        />
      )}

      <div className={styles.documentScroll}>
        {loading ? (
          <ContentCanvasLoading />
        ) : selectedEntry ? (
          <article className={styles.document}>
            <Textarea
              ref={titleFieldRef}
              value={title}
              rows={1}
              resize="none"
              placeholder="Untitled"
              aria-label="Title"
              onChange={(event) => {
                resizeTitleField(event.currentTarget)
                onTitleChange(event.target.value)
              }}
              onKeyDown={handleTitleKeyDown}
              disabled={!editorEnabled}
              className={styles.titleInput}
              fieldSize="md"
              emphasis="strong"
            />
            {bodyEnabled && (
              <RichMarkdownEditor
                blocks={blocks}
                readOnly={!editorEnabled}
                focusSignal={focusBodySignal}
                onChange={onBlocksChange}
                onMediaRequest={onRequestMedia}
              />
            )}
          </article>
        ) : (
          <div className={styles.emptyState}>
            <h2>Create the first {singularLabel}</h2>
            <p>Select a collection and create an entry to start writing.</p>
            <Button variant="primary" size="md" onClick={onCreateEntry} disabled={!selectedCollection || !canCreateEntry}>
              <FilePlusSolidIcon size={15} aria-hidden="true" />
              <span>New {selectedCollection?.singularLabel ?? 'Entry'}</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function resizeTitleField(node: HTMLTextAreaElement | null) {
  if (!node) return
  node.style.height = 'auto'
  if (node.scrollHeight > 0) {
    node.style.height = `${node.scrollHeight}px`
  }
}

function ContentCanvasLoading() {
  return (
    <div
      className={styles.canvasLoading}
      data-testid="content-canvas-loading"
      aria-busy="true"
      aria-label="Loading content"
    >
      <span className={cn(styles.skeletonShape, styles.canvasSkeletonTitle)} />
      <span className={cn(styles.skeletonShape, styles.canvasSkeletonLine)} />
      <span className={cn(styles.skeletonShape, styles.canvasSkeletonShortLine)} />
      <span className={cn(styles.skeletonShape, styles.canvasSkeletonBlock)} />
    </div>
  )
}
