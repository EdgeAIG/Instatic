/**
 * usePropertiesPanelAutoOpen — subscribes to selectedNodeId; when it becomes
 * non-null, automatically opens the Properties Panel. When selection is cleared,
 * closes the panel instead of leaving an empty inspector visible.
 *
 * Extracted to a dedicated file per Task #358 / Guideline #356.
 * The panel opens itself when it becomes relevant — no canvas or store action
 * coupling needed.
 *
 * @see Guideline #356 — Floating Overlay Panel Auto-Open on Selection
 * @see Task #358 Deliverable 4 — Properties Panel auto-open behavior
 */
import { useEffect } from 'react'
import { useEditorStore } from '@site/store/store'

export function usePropertiesPanelAutoOpen() {
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId)
  const selectedSelectorClassId = useEditorStore((s) => s.selectedSelectorClassId)
  const hasSelectorMultiSelect = useEditorStore((s) => s.selectedSelectorClassIds.length > 0)
  const setPropertiesPanel = useEditorStore((s) => s.setPropertiesPanel)
  const consumePropertiesPanelAutoOpenSuppression = useEditorStore(
    (s) => s.consumePropertiesPanelAutoOpenSuppression,
  )
  useEffect(() => {
    const shouldCollapse = !selectedNodeId && !selectedSelectorClassId && !hasSelectorMultiSelect
    const suppressed = consumePropertiesPanelAutoOpenSuppression()
    if (suppressed && !shouldCollapse) return
    setPropertiesPanel({ collapsed: shouldCollapse })
  }, [
    selectedNodeId,
    selectedSelectorClassId,
    hasSelectorMultiSelect,
    consumePropertiesPanelAutoOpenSuppression,
    setPropertiesPanel,
  ])
}
