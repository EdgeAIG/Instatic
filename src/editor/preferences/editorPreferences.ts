export const EDITOR_PREFS_KEY = 'pb-editor-prefs'
export const EDITOR_PREFS_CHANGED_EVENT = 'pb-editor-prefs-changed'

export function readAutoSavePreference(): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(EDITOR_PREFS_KEY)
    if (!raw) return true
    const parsed = JSON.parse(raw) as { autoSave?: unknown }
    return typeof parsed.autoSave === 'boolean'
      ? parsed.autoSave
      : true
  } catch {
    return true
  }
}

export function readClassHoverPreviewPreference(): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(EDITOR_PREFS_KEY)
    if (!raw) return true
    const parsed = JSON.parse(raw) as { classHoverPreview?: unknown }
    return typeof parsed.classHoverPreview === 'boolean'
      ? parsed.classHoverPreview
      : true
  } catch {
    return true
  }
}

export function notifyEditorPrefsChanged() {
  try {
    globalThis.window?.dispatchEvent(new Event(EDITOR_PREFS_CHANGED_EVENT))
  } catch {
    // Preferences are best-effort local UI state.
  }
}

export function subscribeToEditorPrefsChanged(listener: () => void): () => void {
  const win = globalThis.window
  if (!win) return () => {}

  const handleStorage = (event: StorageEvent) => {
    if (event.key === EDITOR_PREFS_KEY) listener()
  }

  win.addEventListener(EDITOR_PREFS_CHANGED_EVENT, listener)
  win.addEventListener('storage', handleStorage)
  return () => {
    win.removeEventListener(EDITOR_PREFS_CHANGED_EVENT, listener)
    win.removeEventListener('storage', handleStorage)
  }
}
