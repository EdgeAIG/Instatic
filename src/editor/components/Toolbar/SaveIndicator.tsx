/**
 * SaveIndicator — shows "Saved" or "Unsaved changes" pill in the toolbar.
 *
 * Subscribes only to `hasUnsavedChanges` — re-renders on that flag only.
 * J12 (LocalAdapter) sets this flag via `setHasUnsavedChanges()` on
 * auto-save and on explicit Cmd+S.
 *
 * The pill uses role="status" so screen readers announce state changes
 * without interrupting the user's workflow (polite, not assertive).
 */

import { useEditorStore } from '@core/editor-store/store'
import { useEffect, useState } from 'react'
import { Button } from '@ui/components/Button'
import { cn } from '@ui/cn'
import { Icon } from '../../../ui/icons/Icon'
import {
  readAutoSavePreference,
  subscribeToEditorPrefsChanged,
} from '../../preferences/editorPreferences'
import styles from './Toolbar.module.css'

interface SaveIndicatorProps {
  onSave?: () => void | Promise<void>
}

export function SaveIndicator({ onSave }: SaveIndicatorProps) {
  const hasUnsaved = useEditorStore((s) => s.hasUnsavedChanges)
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(readAutoSavePreference)
  const [isSaving, setIsSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)

  useEffect(() => {
    return subscribeToEditorPrefsChanged(() => {
      setAutoSaveEnabled(readAutoSavePreference())
    })
  }, [])

  async function handleManualSave() {
    if (!onSave || isSaving) return
    setIsSaving(true)
    setSaveFailed(false)
    try {
      await onSave()
    } catch (err) {
      setSaveFailed(true)
      console.error('[toolbar] Manual save failed:', err)
    } finally {
      setIsSaving(false)
    }
  }

  if (!autoSaveEnabled && hasUnsaved) {
    const label = isSaving
      ? 'Saving...'
      : saveFailed
        ? 'Retry save'
        : 'Save'

    return (
      <Button
        variant="primary"
        size="sm"
        aria-label="Save project"
        aria-busy={isSaving}
        title="Save changes"
        onClick={handleManualSave}
        disabled={!onSave}
        data-testid="save-indicator"
        tone={saveFailed ? 'danger' : 'default'}
      >
        <Icon name={isSaving ? 'loader' : 'save'} size={14} aria-hidden="true" />
        <span>{label}</span>
      </Button>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="save-indicator"
      aria-label={hasUnsaved ? 'Unsaved changes' : 'All changes saved'}
      className={cn(
        styles.pill,
        hasUnsaved ? styles.pillUnsaved : styles.pillSaved,
      )}
    >
      {/* Status dot */}
      <span
        aria-hidden="true"
        className={cn(
          styles.dot,
          hasUnsaved ? styles.dotUnsaved : styles.dotSaved,
        )}
      />
      {hasUnsaved ? 'Unsaved changes' : 'Saved'}
    </div>
  )
}
