/**
 * MediaPickerModal — WordPress-style fullscreen picker.
 *
 * Replaces the cramped 280-px property-panel media picker. Hosts the same
 * folder tree + canvas grid + asset summary the Media page uses, but inside
 * a Dialog with a clear "Use selected" / "Cancel" footer.
 *
 * Constraints vs the standalone Media page:
 *   - Single-select only (no multi-select / bulk-edit).
 *   - Filtered to one media kind (`image` or `video`) so the user can't
 *     accidentally pick a video for an `<img>` slot.
 *   - No floating windows mount here (no viewer, no upload queue, no bulk
 *     edit) — the modal is the surface.
 *   - The workspace hook is mounted internally so each picker session has
 *     its own folder selection / scroll position / filter state without
 *     leaking into the Media page if it's open elsewhere.
 */
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@ui/components/Button'
import { CloseIcon } from 'pixel-art-icons/icons/close'
import type { CmsMediaAsset } from '@core/persistence/cmsMedia'
import { MediaSidebar, type MediaSidebarPanelId } from '../MediaSidebar/MediaSidebar'
import { MediaCanvas } from '../MediaCanvas/MediaCanvas'
import { useMediaWorkspace } from '../../hooks/useMediaWorkspace'
import { bucketForMime } from '../../utils/filters'
import { blurHashToDataUrl, pickVariantUrl } from '../../utils/variants'
import styles from './MediaPickerModal.module.css'

interface MediaPickerModalProps {
  open: boolean
  onClose: () => void
  /**
   * Constrain the picker to a single media kind, or pass `'any'` to show
   * all asset types without filtering.
   */
  mediaKind: 'image' | 'video' | 'any'
  /**
   * Public path of the currently-picked asset, if any. Used to seed the
   * picker's selection so re-opening the picker for an already-picked
   * field highlights the right tile immediately.
   */
  currentValue?: string | null
  /** Called when the user clicks "Use selected" with a valid pick. */
  onPick: (asset: CmsMediaAsset) => void
}

export function MediaPickerModal({
  open,
  onClose,
  mediaKind,
  currentValue,
  onPick,
}: MediaPickerModalProps) {
  // The picker mounts/unmounts; the workspace hook lives only while open.
  // That avoids loading folders + assets at startup of every editor session.
  if (!open) return null
  return (
    <MediaPickerModalBody
      onClose={onClose}
      mediaKind={mediaKind}
      currentValue={currentValue}
      onPick={onPick}
    />
  )
}

function MediaPickerModalBody({
  onClose,
  mediaKind,
  currentValue,
  onPick,
}: Omit<MediaPickerModalProps, 'open'>) {
  const workspace = useMediaWorkspace()
  const [activePanel, setActivePanel] = useState<MediaSidebarPanelId | null>('folders')

  // Constrain the canvas to the requested media kind so an image control
  // can't accidentally pick a video. When mediaKind is 'any', show all
  // assets without filtering.
  useEffect(() => {
    workspace.setFilterType(mediaKind === 'any' ? 'all' : mediaKind)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaKind])

  // Seed the picker selection from the field's current value (matches by
  // publicPath since that's what the module prop stores).
  useEffect(() => {
    if (!currentValue) return
    const match = workspace.assets.find((asset) => asset.publicPath === currentValue)
    if (match) workspace.setSelectedAssetId(match.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentValue, workspace.assets])

  // Close on Escape — matches Dialog primitive behavior. We don't use the
  // Dialog primitive itself because we need a much larger surface than
  // its `xl` cap (640px).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const picked = workspace.selectedAsset
  const pickedMatchesKind = picked
    ? mediaKind === 'any' || bucketForMime(picked.mimeType) === mediaKind
    : false
  const canCommit = picked !== null && pickedMatchesKind

  function commit() {
    if (!picked || !pickedMatchesKind) return
    onPick(picked)
    onClose()
  }

  return createPortal(
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(event) => {
        // Click outside the dialog body closes — matches every other modal
        // in the editor.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={
          mediaKind === 'image' ? 'Select an image'
          : mediaKind === 'video' ? 'Select a video'
          : 'Select media'
        }
        data-testid="media-picker-modal"
      >
        <header className={styles.header}>
          <h2 className={styles.title}>
            {mediaKind === 'image' ? 'Select an image'
              : mediaKind === 'video' ? 'Select a video'
              : 'Select media'}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="Close picker"
            onClick={onClose}
          >
            <CloseIcon size={14} />
          </Button>
        </header>

        <div className={styles.body}>
          <MediaSidebar
            workspace={workspace}
            activePanel={activePanel}
            onActivePanelChange={setActivePanel}
          />
          <div className={styles.canvasArea}>
            <MediaCanvas workspace={workspace} />
          </div>
        </div>

        <footer className={styles.footer}>
          <PickedSummary asset={picked} matchesKind={pickedMatchesKind} mediaKind={mediaKind} />
          <div className={styles.footerActions}>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!canCommit}
              onClick={commit}
            >
              Use selected
            </Button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

interface PickedSummaryProps {
  asset: CmsMediaAsset | null
  matchesKind: boolean
  mediaKind: 'image' | 'video' | 'any'
}

/**
 * Bottom-left summary of the currently-picked asset. Loud preview + filename
 * so the user has zero doubt about what "Use selected" will commit to — the
 * exact gap the cramped sidebar picker had ("not clear which media is
 * picked").
 */
function PickedSummary({ asset, matchesKind, mediaKind }: PickedSummaryProps) {
  const summary = useMemo(() => {
    if (!asset) return null
    const bucket = bucketForMime(asset.mimeType)
    const thumbUrl = bucket === 'image' ? pickVariantUrl(asset, 56) : null
    const blurUrl = bucket === 'image' ? blurHashToDataUrl(asset.blurHash) : null
    return { bucket, thumbUrl, blurUrl }
  }, [asset])

  if (!asset) {
    const kindLabel = mediaKind === 'image' ? 'image' : mediaKind === 'video' ? 'video' : 'asset'
    return (
      <p className={styles.pickedEmpty}>
        No {kindLabel} selected — pick one from the grid.
      </p>
    )
  }

  return (
    <div className={styles.picked}>
      <span
        className={styles.pickedPreview}
        aria-hidden="true"
        style={summary?.blurUrl ? {
          backgroundImage: `url(${summary.blurUrl})`,
          backgroundSize: 'cover',
        } : undefined}
      >
        {summary?.bucket === 'image' && summary.thumbUrl ? (
          <img src={summary.thumbUrl} alt="" loading="lazy" decoding="async" />
        ) : summary?.bucket === 'video' ? (
          <video src={asset.publicPath} preload="metadata" muted />
        ) : null}
      </span>
      <span className={styles.pickedMeta}>
        <span className={styles.pickedName}>{asset.filename}</span>
        {!matchesKind && mediaKind !== 'any' && (
          <span className={styles.pickedWrongKind} role="alert">
            This is not {mediaKind === 'image' ? 'an image' : 'a video'} asset.
          </span>
        )}
      </span>
    </div>
  )
}
