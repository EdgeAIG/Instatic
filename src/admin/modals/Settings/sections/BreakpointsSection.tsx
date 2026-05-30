/**
 * BreakpointsSection — add / edit / remove canvas breakpoints.
 *
 * Changes reflect on the canvas immediately because CanvasRoot reads
 * `site.breakpoints` from the store.
 */
import { useState, useRef, useEffect, useId } from 'react'
import { useEditorStore } from '@site/store/store'
import { SmartphoneSolidIcon } from 'pixel-art-icons/icons/smartphone-solid'
import { TabletSolidIcon } from 'pixel-art-icons/icons/tablet-solid'
import { MonitorSolidIcon } from 'pixel-art-icons/icons/monitor-solid'
import { LaptopSolidIcon } from 'pixel-art-icons/icons/laptop-solid'
import { TvSolidIcon } from 'pixel-art-icons/icons/tv-solid'
import { PlusIcon } from 'pixel-art-icons/icons/plus'
import { Button } from '@ui/components/Button'
import { Input } from '@ui/components/Input'
import { Select } from '@ui/components/Select'
import { Switch } from '@ui/components/Switch'
import { SkeletonBlock } from '@ui/components/Skeleton'
import type { Breakpoint } from '@core/page-tree'
import s from '../SettingsModal.module.css'

const ICON_OPTIONS = [
  { value: 'smartphone', label: 'Smartphone', icon: <SmartphoneSolidIcon size={13} /> },
  { value: 'tablet', label: 'Tablet', icon: <TabletSolidIcon size={13} /> },
  { value: 'monitor', label: 'Monitor', icon: <MonitorSolidIcon size={13} /> },
  { value: 'laptop', label: 'Laptop', icon: <LaptopSolidIcon size={13} /> },
  { value: 'tv', label: 'TV', icon: <TvSolidIcon size={13} /> },
]

export function BreakpointsSection() {
  const site = useEditorStore((state) => state.site)
  const addBreakpoint = useEditorStore((state) => state.addBreakpoint)
  const updateBreakpoint = useEditorStore((state) => state.updateBreakpoint)
  const removeBreakpoint = useEditorStore((state) => state.removeBreakpoint)
  const setActiveBreakpoint = useEditorStore((state) => state.setActiveBreakpoint)
  const activeBreakpointId = useEditorStore((state) => state.activeBreakpointId)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editWidth, setEditWidth] = useState(0)
  const [editIcon, setEditIcon] = useState('monitor')
  const [editPreviewFrame, setEditPreviewFrame] = useState(true)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)

  const confirmBtnRef = useRef<HTMLButtonElement>(null)
  const editFrameId = useId()
  const newFrameId = useId()

  useEffect(() => {
    if (confirmRemoveId) confirmBtnRef.current?.focus()
  }, [confirmRemoveId])

  const [newLabel, setNewLabel] = useState('')
  const [newWidth, setNewWidth] = useState(375)
  const [newIcon, setNewIcon] = useState('smartphone')
  const [newPreviewFrame, setNewPreviewFrame] = useState(true)

  const handleStartEdit = (bp: Breakpoint) => {
    setEditingId(bp.id)
    setEditLabel(bp.label)
    setEditWidth(bp.width)
    setEditIcon(bp.icon)
    setEditPreviewFrame(bp.previewFrame !== false)
  }

  const handleSaveEdit = () => {
    if (!editingId) return
    if (editLabel.trim() && editWidth > 0) {
      updateBreakpoint(editingId, { label: editLabel.trim(), width: editWidth, icon: editIcon, previewFrame: editPreviewFrame })
    }
    setEditingId(null)
  }

  const handleAdd = () => {
    const label = newLabel.trim()
    if (!label || newWidth <= 0) return
    addBreakpoint({ label, width: newWidth, icon: newIcon, previewFrame: newPreviewFrame })
    setNewLabel('')
    setNewWidth(375)
    setNewIcon('smartphone')
    setNewPreviewFrame(true)
  }

  const handleRemove = (id: string) => {
    removeBreakpoint(id)
    setConfirmRemoveId(null)
  }

  if (!site) {
    return <SkeletonBlock minHeight={200} ariaLabel="Loading site settings" />
  }

  return (
    <div>
      <h3 className={s.sectionHeading}>Breakpoints</h3>
      <p className={s.sectionDescription}>
        Define viewport widths for responsive design. The active breakpoint shows a coloured
        frame on the canvas and can have per-breakpoint prop overrides.
      </p>

      <ul role="list" className={s.list}>
        {site.breakpoints.map((bp) => (
          <li key={bp.id}>
            {editingId === bp.id ? (
              <div className={s.bpEditForm}>
                <div className={s.bpEditRow}>
                  <Input
                    type="text"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    placeholder="Label (e.g. Mobile)"
                    autoFocus
                    aria-label="Breakpoint label"
                    className={s.fieldFlex}
                  />
                  <Input
                    type="number"
                    value={editWidth}
                    onChange={(e) => setEditWidth(Number(e.target.value))}
                    min={320}
                    max={3840}
                    aria-label="Width in pixels"
                  />
                </div>
                <Select
                  value={editIcon}
                  onChange={(e) => setEditIcon(e.target.value)}
                  aria-label="Icon"
                  options={ICON_OPTIONS}
                />
                <div className={s.row}>
                  <label htmlFor={editFrameId} className={s.fieldFlex}>Preview frame on canvas</label>
                  <Switch
                    id={editFrameId}
                    checked={editPreviewFrame}
                    onCheckedChange={setEditPreviewFrame}
                    aria-label="Show preview frame on canvas"
                  />
                </div>
                <div className={s.bpEditActions}>
                  <Button variant="primary" size="md" onClick={handleSaveEdit}>Save</Button>
                  <Button variant="secondary" size="md" onClick={() => setEditingId(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className={s.listItem}>
                <div className={s.row}>
                  <BreakpointIcon
                    name={bp.icon}
                    color={bp.id === activeBreakpointId ? 'var(--editor-text)' : 'var(--editor-text-subtle)'}
                  />
                  <div className={s.listItemContent}>
                    <div className={s.listItemTitle}>
                      {bp.label}
                      {bp.id === activeBreakpointId && (
                        <span className={s.activeBadge}>active</span>
                      )}
                    </div>
                    <div className={s.listItemSubtitle}>{bp.width}px</div>
                  </div>
                </div>

                <div
                  className={s.listItemActions}
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setConfirmRemoveId(null) } }}
                >
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={bp.id === activeBreakpointId ? undefined : () => setActiveBreakpoint(bp.id)}
                    aria-disabled={bp.id === activeBreakpointId ? 'true' : undefined}
                    aria-label={`Set ${bp.label} as active breakpoint`}
                    tooltip={bp.id === activeBreakpointId ? 'Already the active breakpoint' : undefined}
                  >
                    Activate
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => handleStartEdit(bp)}
                    aria-label={`Edit ${bp.label} breakpoint`}
                  >
                    Edit
                  </Button>
                  {confirmRemoveId === bp.id ? (
                    <>
                      <Button
                        ref={confirmBtnRef}
                        variant="destructive"
                        size="sm"
                        onClick={() => handleRemove(bp.id)}
                        aria-label={`Confirm remove ${bp.label} breakpoint`}
                      >
                        Delete
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setConfirmRemoveId(null)}
                        aria-label="Cancel remove"
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="destructive"
                      size="md"
                      onClick={site.breakpoints.length <= 1 ? undefined : () => setConfirmRemoveId(bp.id)}
                      aria-disabled={site.breakpoints.length <= 1 ? 'true' : undefined}
                      aria-label={`Remove ${bp.label} breakpoint`}
                      tooltip={site.breakpoints.length <= 1 ? 'Cannot remove the last breakpoint' : undefined}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* Add new breakpoint */}
      <div className={s.bpAddForm}>
        <h4 className={s.subHeading}>Add Breakpoint</h4>
        <div className={s.bpEditRow}>
          <Input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Label"
            aria-label="New breakpoint label"
            className={s.fieldFlex}
          />
          <Input
            type="number"
            value={newWidth}
            onChange={(e) => setNewWidth(Number(e.target.value))}
            min={320}
            max={3840}
            aria-label="Width in pixels"
          />
        </div>
        <div className={s.row}>
          <Select
            value={newIcon}
            onChange={(e) => setNewIcon(e.target.value)}
            aria-label="Breakpoint icon"
            className={s.fieldFlex}
            options={ICON_OPTIONS}
          />
          <Button
            variant="primary"
            size="md"
            onClick={handleAdd}
            disabled={!newLabel.trim() || newWidth <= 0}
          >
            <PlusIcon size={13} aria-hidden="true" />
            Add
          </Button>
        </div>
        <div className={s.row}>
          <label htmlFor={newFrameId} className={s.fieldFlex}>Preview frame on canvas</label>
          <Switch
            id={newFrameId}
            checked={newPreviewFrame}
            onCheckedChange={setNewPreviewFrame}
            aria-label="Show preview frame on canvas for new breakpoint"
          />
        </div>
      </div>
    </div>
  )
}

function BreakpointIcon({ name, color }: { name: string; color: string }) {
  switch (name) {
    case 'smartphone':
      return <SmartphoneSolidIcon size={14} color={color} />
    case 'tablet':
      return <TabletSolidIcon size={14} color={color} />
    case 'laptop':
      return <LaptopSolidIcon size={14} color={color} />
    case 'tv':
      return <TvSolidIcon size={14} color={color} />
    case 'monitor':
    default:
      return <MonitorSolidIcon size={14} color={color} />
  }
}
