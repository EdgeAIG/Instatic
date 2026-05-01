import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { createPortal, flushSync } from 'react-dom'
import { Button } from '@ui/components/Button'
import { ContextMenu, ContextMenuItem } from '@ui/components/ContextMenu'
import { ChevronDownIcon } from '@ui/icons/icons/chevron-down'
import { DragAndDropIcon } from '@ui/icons/icons/drag-and-drop'
import { HeadingIcon } from '@ui/icons/icons/heading'
import { ImagesIcon } from '@ui/icons/icons/images'
import { TextStartTIcon } from '@ui/icons/icons/text-start-t'
import { autoformatMarkdownShortcut, createMediaBlock, createParagraphBlock } from './markdown'
import type { ContentBlock, ContentMediaType } from './types'
import styles from './RichMarkdownEditor.module.css'

type BodyHeadingLevel = 2 | 3 | 4
type BlockTypeMenuValue = 'paragraph' | `heading-${BodyHeadingLevel}` | 'media'
type BlockFrameStyle = CSSProperties & { '--content-block-translate-y'?: string }

interface BlockLayout {
  blockId: string
  top: number
  height: number
  centerY: number
}

interface BlockDragState {
  blockId: string
  originIndex: number
  targetIndex: number
  startY: number
  currentY: number
  shiftDistance: number
  layouts: BlockLayout[]
}

interface DropAnimationState {
  blockId: string
  offsetY: number
  phase: 'position' | 'animate'
}

interface TypeMenuState {
  blockId: string
  index: number
  x: number
  y: number
  width: number
}

const DROP_SETTLE_DURATION_MS = 180

interface RichMarkdownEditorProps {
  blocks: ContentBlock[]
  onChange: (blocks: ContentBlock[]) => void
  onMediaRequest?: (blockId: string) => void
}

export function RichMarkdownEditor({ blocks, onChange, onMediaRequest }: RichMarkdownEditorProps) {
  const [pendingFocusBlockId, setPendingFocusBlockId] = useState<string | null>(null)
  const [dragState, setDragState] = useState<BlockDragState | null>(null)
  const [dropAnimation, setDropAnimation] = useState<DropAnimationState | null>(null)
  const [typeMenu, setTypeMenu] = useState<TypeMenuState | null>(null)
  const blockFramesRef = useRef(new Map<string, HTMLElement>())
  const editableBlocksRef = useRef(new Map<string, HTMLElement>())
  const dragStateRef = useRef<BlockDragState | null>(null)
  const removeDragListenersRef = useRef<(() => void) | null>(null)
  const dropAnimationTimeoutRef = useRef<number | null>(null)

  const setTrackedDragState = useCallback((next: BlockDragState | null) => {
    dragStateRef.current = next
    setDragState(next)
  }, [])

  const registerBlockFrame = useCallback((blockId: string, node: HTMLElement | null) => {
    if (node) {
      blockFramesRef.current.set(blockId, node)
      return
    }
    blockFramesRef.current.delete(blockId)
  }, [])

  const registerEditableBlock = useCallback((blockId: string, node: HTMLElement | null) => {
    if (node) {
      editableBlocksRef.current.set(blockId, node)
      return
    }
    editableBlocksRef.current.delete(blockId)
  }, [])

  useLayoutEffect(() => {
    if (!pendingFocusBlockId) return

    const editable = editableBlocksRef.current.get(pendingFocusBlockId)
    if (!editable) return

    editable.focus()
    placeCaretAtEnd(editable)
    setPendingFocusBlockId(null)
  }, [blocks, pendingFocusBlockId])

  useLayoutEffect(() => {
    return () => {
      removeDragListenersRef.current?.()
      if (dropAnimationTimeoutRef.current !== null) {
        window.clearTimeout(dropAnimationTimeoutRef.current)
      }
    }
  }, [])

  function updateBlock(index: number, patch: ContentBlock) {
    const next = [...blocks]
    next[index] = autoformatMarkdownShortcut(patch)
    onChange(next)
  }

  function insertParagraphAfter(index: number) {
    const next = [...blocks]
    const paragraph = createParagraphBlock()
    next.splice(index + 1, 0, paragraph)
    setPendingFocusBlockId(paragraph.id)
    onChange(next)
  }

  function handleTextKeyDown(event: KeyboardEvent<HTMLElement>, index: number) {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    insertParagraphAfter(index)
  }

  function changeBlockType(index: number, nextType: BlockTypeMenuValue) {
    const current = blocks[index]
    if (!current || blockMatchesTypeMenuValue(current, nextType)) return

    const text = textFromBlock(current)
    const next = [...blocks]
    switch (nextType) {
      case 'paragraph':
        next[index] = { id: current.id, type: 'paragraph', text }
        break
      case 'heading-2':
      case 'heading-3':
      case 'heading-4':
        next[index] = {
          id: current.id,
          type: 'heading',
          level: Number(nextType.replace('heading-', '')) as BodyHeadingLevel,
          text: text || 'Heading',
        }
        break
      case 'media':
        next[index] = current.type === 'media' ? current : { ...createMediaBlock('', null, text), id: current.id }
        break
    }
    if (next[index]?.type === 'heading' || next[index]?.type === 'paragraph') {
      setPendingFocusBlockId(current.id)
    }
    onChange(next)
  }

  function reorderBlock(fromIndex: number, targetIndex: number) {
    if (fromIndex === targetIndex) return
    const next = [...blocks]
    const [moved] = next.splice(fromIndex, 1)
    if (!moved) return
    next.splice(targetIndex, 0, moved)
    onChange(next)
  }

  function openTypeMenu(event: MouseEvent<HTMLButtonElement>, index: number, blockId: string) {
    const rect = event.currentTarget.getBoundingClientRect()
    setTypeMenu({
      blockId,
      index,
      x: rect.left,
      y: rect.bottom + 6,
      width: 176,
    })
  }

  function startBlockDrag(event: PointerEvent<HTMLButtonElement>, blockId: string) {
    if (event.button !== 0) return
    const originIndex = blocks.findIndex((block) => block.id === blockId)
    if (originIndex < 0) return

    const layouts = measureBlockLayouts(blocks, blockFramesRef.current)
    const activeLayout = layouts[originIndex]
    if (!activeLayout) return

    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)

    const initialState: BlockDragState = {
      blockId,
      originIndex,
      targetIndex: originIndex,
      startY: event.clientY,
      currentY: event.clientY,
      shiftDistance: getBlockShiftDistance(layouts, originIndex),
      layouts,
    }
    setTrackedDragState(initialState)

    const handlePointerMove = (pointerEvent: globalThis.PointerEvent) => {
      const current = dragStateRef.current
      if (!current) return
      pointerEvent.preventDefault()
      const targetIndex = getProjectedBlockIndex(current, pointerEvent.clientY)
      setTrackedDragState({
        ...current,
        currentY: pointerEvent.clientY,
        targetIndex,
      })
    }

    const handlePointerUp = (pointerEvent: globalThis.PointerEvent) => {
      pointerEvent.preventDefault()
      finishBlockDrag(true)
    }

    const handlePointerCancel = () => finishBlockDrag(false)

    removeDragListenersRef.current?.()
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    removeDragListenersRef.current = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }
  }

  function finishBlockDrag(commit: boolean) {
    const finalState = dragStateRef.current
    removeDragListenersRef.current?.()
    removeDragListenersRef.current = null

    if (!commit || !finalState || finalState.originIndex === finalState.targetIndex) {
      setTrackedDragState(null)
      return
    }

    if (dropAnimationTimeoutRef.current !== null) {
      window.clearTimeout(dropAnimationTimeoutRef.current)
      dropAnimationTimeoutRef.current = null
    }

    const settlingOffset = getDropSettlingOffset(finalState)

    flushSync(() => {
      setDropAnimation({
        blockId: finalState.blockId,
        offsetY: settlingOffset,
        phase: 'position',
      })
      setTrackedDragState(null)
      reorderBlock(finalState.originIndex, finalState.targetIndex)
    })

    requestAnimationFrame(() => {
      setDropAnimation((current) => {
        if (!current || current.blockId !== finalState.blockId) return current
        return { ...current, offsetY: 0, phase: 'animate' }
      })
      dropAnimationTimeoutRef.current = window.setTimeout(() => {
        setDropAnimation((current) => {
          if (!current || current.blockId !== finalState.blockId) return current
          return null
        })
        dropAnimationTimeoutRef.current = null
      }, DROP_SETTLE_DURATION_MS)
    })
  }

  function getBlockFrameStyle(block: ContentBlock, index: number): BlockFrameStyle | undefined {
    const offsetY = getBlockOffsetY(block.id, index, dragState, dropAnimation)
    if (offsetY === 0) return undefined
    return { '--content-block-translate-y': `${offsetY}px` }
  }

  return (
    <div className={styles.editor} aria-label="Post body" data-dragging={dragState ? 'true' : undefined}>
      {blocks.map((block, index) => {
        let content
        if (block.type === 'media') {
          content = (
            <MediaBlock
              mediaType={block.mediaType}
              src={block.src}
              label={block.alt || block.src || 'Media block'}
              onChoose={() => onMediaRequest?.(block.id)}
            />
          )
        } else if (block.type === 'heading') {
          const HeadingTag = `h${block.level}` as 'h2' | 'h3' | 'h4'
          content = (
            <EditableTextBlock
              block={block}
              index={index}
              tagName={HeadingTag}
              className={styles.headingBlock}
              placeholder="Heading"
              onInputText={(blockIndex, text) => updateBlock(blockIndex, { ...block, text })}
              onTextKeyDown={handleTextKeyDown}
              onEditableRef={registerEditableBlock}
            />
          )
        } else {
          content = (
            <EditableTextBlock
              block={block}
              index={index}
              tagName="p"
              className={styles.paragraphBlock}
              placeholder="Write something..."
              onInputText={(blockIndex, text) => updateBlock(blockIndex, { ...block, text })}
              onTextKeyDown={handleTextKeyDown}
              onEditableRef={registerEditableBlock}
            />
          )
        }

        return (
          <BlockFrame
            key={block.id}
            block={block}
            index={index}
            dragging={dragState?.blockId === block.id}
            shifted={getBlockOffsetY(block.id, index, dragState, dropAnimation) !== 0 && dragState?.blockId !== block.id}
            dropPhase={dropAnimation?.blockId === block.id ? dropAnimation.phase : undefined}
            style={getBlockFrameStyle(block, index)}
            onFrameRef={registerBlockFrame}
            onTypeMenuOpen={openTypeMenu}
            onDragPointerDown={startBlockDrag}
          >
            {content}
          </BlockFrame>
        )
      })}
      {typeMenu && typeof document !== 'undefined' && createPortal(
        <ContextMenu
          x={typeMenu.x}
          y={typeMenu.y}
          width={typeMenu.width}
          minWidth={typeMenu.width}
          zIndex={10000}
          ariaLabel="Block type"
          onClose={() => setTypeMenu(null)}
        >
          {BLOCK_TYPE_OPTIONS.map((option) => {
            const activeBlock = blocks[typeMenu.index]
            const active = activeBlock ? blockMatchesTypeMenuValue(activeBlock, option.value) : false
            return (
              <ContextMenuItem
                key={option.value}
                active={active}
                onClick={() => {
                  changeBlockType(typeMenu.index, option.value)
                  setTypeMenu(null)
                }}
              >
                {option.icon}
                <span>{option.label}</span>
              </ContextMenuItem>
            )
          })}
        </ContextMenu>,
        document.body,
      )}
    </div>
  )
}

interface MediaBlockProps {
  mediaType: ContentMediaType | null
  src: string
  label: string
  onChoose: () => void
}

function MediaBlock({ mediaType, src, label, onChoose }: MediaBlockProps) {
  return (
    <figure className={styles.mediaBlock}>
      {src ? (
        mediaType === 'video' ? (
          <video controls src={src} />
        ) : (
          <img src={src} alt={label} />
        )
      ) : (
        <button
          type="button"
          className={styles.mediaPlaceholder}
          onClick={onChoose}
        >
          <span>No media selected</span>
          <strong>Choose media</strong>
        </button>
      )}
      <figcaption>{label}</figcaption>
      {src && (
        <button
          type="button"
          className={styles.mediaReplaceButton}
          onClick={onChoose}
        >
          Replace media
        </button>
      )}
    </figure>
  )
}

interface BlockFrameProps {
  block: ContentBlock
  index: number
  dragging: boolean
  shifted: boolean
  dropPhase?: DropAnimationState['phase']
  style?: BlockFrameStyle
  children: ReactNode
  onFrameRef: (blockId: string, node: HTMLElement | null) => void
  onTypeMenuOpen: (event: MouseEvent<HTMLButtonElement>, index: number, blockId: string) => void
  onDragPointerDown: (event: PointerEvent<HTMLButtonElement>, blockId: string) => void
}

function BlockFrame({
  block,
  index,
  dragging,
  shifted,
  dropPhase,
  style,
  children,
  onFrameRef,
  onTypeMenuOpen,
  onDragPointerDown,
}: BlockFrameProps) {
  const currentType = getBlockTypeOption(block)
  const setFrameRef = useCallback((node: HTMLElement | null) => {
    onFrameRef(block.id, node)
  }, [block.id, onFrameRef])

  return (
    <section
      ref={setFrameRef}
      className={styles.blockFrame}
      style={style}
      data-testid={`content-block-frame-${index}`}
      data-dragging={dragging ? 'true' : undefined}
      data-shifted={shifted ? 'true' : undefined}
      data-drop-phase={dropPhase}
    >
      <div className={styles.blockChrome} aria-label={`Block ${index + 1} controls`}>
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          aria-label={`Drag block ${index + 1}`}
          title="Drag block"
          className={styles.dragHandle}
          onPointerDown={(event) => onDragPointerDown(event, block.id)}
        >
          <DragAndDropIcon size={13} aria-hidden="true" />
        </Button>
        <Button
          variant="secondary"
          size="xs"
          aria-label={`Change block ${index + 1} type, current ${currentType.label}`}
          title="Change block type"
          className={styles.blockTypeButton}
          onClick={(event) => onTypeMenuOpen(event, index, block.id)}
        >
          <span aria-hidden="true" className={styles.blockTypeIcon}>{currentType.icon}</span>
          <ChevronDownIcon size={11} aria-hidden="true" className={styles.blockTypeChevron} />
        </Button>
      </div>
      <div className={styles.blockContent}>
        {children}
      </div>
    </section>
  )
}

const BLOCK_TYPE_OPTIONS: Array<{ value: BlockTypeMenuValue; label: string; icon: ReactNode }> = [
  { value: 'paragraph', label: 'Paragraph', icon: <TextStartTIcon size={14} /> },
  { value: 'heading-2', label: 'Heading 2', icon: <HeadingIcon size={14} /> },
  { value: 'heading-3', label: 'Heading 3', icon: <HeadingIcon size={14} /> },
  { value: 'heading-4', label: 'Heading 4', icon: <HeadingIcon size={14} /> },
  { value: 'media', label: 'Media', icon: <ImagesIcon size={14} /> },
]

function getBlockTypeOption(block: ContentBlock) {
  const value: BlockTypeMenuValue = block.type === 'heading'
    ? `heading-${normalizeBodyHeadingLevel(block.level)}`
    : block.type
  return BLOCK_TYPE_OPTIONS.find((option) => option.value === value) ?? BLOCK_TYPE_OPTIONS[0]
}

function blockMatchesTypeMenuValue(block: ContentBlock, value: BlockTypeMenuValue) {
  if (value === 'paragraph' || value === 'media') return block.type === value
  return block.type === 'heading' && normalizeBodyHeadingLevel(block.level) === Number(value.replace('heading-', ''))
}

function normalizeBodyHeadingLevel(level: number): BodyHeadingLevel {
  if (level === 3 || level === 4) return level
  return 2
}

function measureBlockLayouts(blocks: ContentBlock[], frames: Map<string, HTMLElement>): BlockLayout[] {
  return blocks.flatMap((block) => {
    const frame = frames.get(block.id)
    if (!frame) return []
    const rect = frame.getBoundingClientRect()
    return [{
      blockId: block.id,
      top: rect.top,
      height: rect.height,
      centerY: rect.top + rect.height / 2,
    }]
  })
}

function getBlockShiftDistance(layouts: BlockLayout[], originIndex: number) {
  const active = layouts[originIndex]
  if (!active) return 0

  const next = layouts[originIndex + 1]
  if (next) return Math.max(active.height, next.top - active.top)

  const previous = layouts[originIndex - 1]
  if (previous) return Math.max(active.height, active.top - previous.top)

  return active.height
}

function getProjectedBlockIndex(state: BlockDragState, currentY: number) {
  const deltaY = currentY - state.startY
  const activeLayout = state.layouts[state.originIndex]
  if (!activeLayout) return state.originIndex

  const draggedCenterY = activeLayout.centerY + deltaY
  return state.layouts
    .filter((layout) => layout.blockId !== state.blockId)
    .reduce((index, layout) => draggedCenterY > layout.centerY ? index + 1 : index, 0)
}

function getDropSettlingOffset(state: BlockDragState) {
  const activeLayout = state.layouts[state.originIndex]
  const targetLayout = state.layouts[state.targetIndex]
  if (!activeLayout || !targetLayout) return 0

  const currentTop = activeLayout.top + state.currentY - state.startY
  return Math.round(currentTop - targetLayout.top)
}

function getBlockOffsetY(
  blockId: string,
  index: number,
  state: BlockDragState | null,
  dropAnimation: DropAnimationState | null,
) {
  if (dropAnimation?.blockId === blockId) return dropAnimation.offsetY
  if (!state) return 0
  if (blockId === state.blockId) return state.currentY - state.startY

  if (state.targetIndex > state.originIndex && index > state.originIndex && index <= state.targetIndex) {
    return -state.shiftDistance
  }
  if (state.targetIndex < state.originIndex && index >= state.targetIndex && index < state.originIndex) {
    return state.shiftDistance
  }
  return 0
}

function textFromBlock(block: ContentBlock): string {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return block.text
    case 'media':
      return block.alt || block.src
  }
}

function placeCaretAtEnd(element: HTMLElement) {
  const selection = window.getSelection()
  if (!selection) return

  const range = document.createRange()
  range.selectNodeContents(element)
  range.collapse(false)
  selection.removeAllRanges()
  selection.addRange(range)
}

interface EditableTextBlockProps {
  block: Extract<ContentBlock, { type: 'heading' | 'paragraph' }>
  index: number
  tagName: 'p' | 'h2' | 'h3' | 'h4'
  className: string
  placeholder: string
  onInputText: (index: number, text: string) => void
  onTextKeyDown: (event: KeyboardEvent<HTMLElement>, index: number) => void
  onEditableRef: (blockId: string, node: HTMLElement | null) => void
}

function EditableTextBlock({
  block,
  index,
  tagName,
  className,
  placeholder,
  onInputText,
  onTextKeyDown,
  onEditableRef,
}: EditableTextBlockProps) {
  const editableRef = useRef<HTMLElement | null>(null)
  const setEditableRef = useCallback((node: HTMLElement | null) => {
    editableRef.current = node
    onEditableRef(block.id, node)
  }, [block.id, onEditableRef])

  useLayoutEffect(() => {
    return () => onEditableRef(block.id, null)
  }, [block.id, onEditableRef])

  useLayoutEffect(() => {
    const editable = editableRef.current
    if (!editable || document.activeElement === editable) return
    if ((editable.textContent ?? '') !== block.text) {
      editable.textContent = block.text
    }
  }, [block.id, block.text, tagName])

  const Tag = tagName

  return (
    <Tag
      ref={setEditableRef as never}
      className={className}
      contentEditable
      suppressContentEditableWarning
      dir="ltr"
      spellCheck
      data-testid={`content-block-${index}`}
      data-placeholder={placeholder}
      data-heading-level={block.type === 'heading' ? block.level : undefined}
      onInput={(event: FormEvent<HTMLElement>) => {
        onInputText(index, event.currentTarget.textContent ?? '')
      }}
      onKeyDown={(event: KeyboardEvent<HTMLElement>) => onTextKeyDown(event, index)}
    />
  )
}
