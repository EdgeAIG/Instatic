/**
 * PropertiesPanel — self-contained inspector for element properties.
 *
 * Layout modes:
 * - Docked: default right-sidebar inspector, resized through the sidebar shell.
 * - Floating: unpinned draggable overlay using useDraggablePanel.
 * - Auto-opens when selectedNodeId becomes non-null and closes on deselection.
 * - Independent panel with its own visibility state — NOT a tab in a shared shell.
 *   AI assistant (AgentPanel) is a separate independent floating panel. (Guideline #410)
 *
 * Unified icon-rail design (Task #unified-panel):
 *   - StyleCategoryRail is the primary navigation for the panel's lower half.
 *   - First rail icon: Module settings (always enabled).
 *   - Remaining icons: CSS style categories (disabled when no active class).
 *   - ClassPicker always-visible above the rail+content area.
 *   - Default active section on node selection: MODULE_CATEGORY_ID.
 *
 * Guideline #357 (Compact UI Density):
 * - Property rows: 26px height, label font 11px, value font 12px
 * - Header: 36px
 *
 * Accessibility (WCAG 2.1 AA):
 * - role="complementary" + aria-label="Properties" on the panel aside
 * - data-testid="properties-panel" (Guideline #221)
 * - Individual controls carry data-testid="property-control-{propKey}"
 * - Keyboard-navigable; F6 cycles focus
 */
import { useEffect, useCallback, useRef, useState } from 'react'
import {
  useEditorStore,
  selectSelectedNode,
} from '@core/editor-store/store'
import { usePropertiesPanelAutoOpen } from './usePropertiesPanelAutoOpen'
import { registry } from '@core/module-engine/registry'
import { evaluateCondition, resolveProps } from '@core/page-tree/selectors'
import { isGeneratedClassLocked } from '@core/page-tree/classUtils'
import { PropertyControlRenderer } from '../PropertyControls/PropertyControlRenderer'
import type { PropertyControl } from '@core/module-engine/types'
import type { CSSClass } from '@core/page-tree/schemas'
import { ClassPicker, type ClassPickerHandle } from './ClassPicker'
import { StyleSurface, GeneratedUtilityLockedState } from './StyleSurface'
import {
  StyleCategoryRail,
  ALL_STYLE_CATEGORY_ID,
} from './StyleCategoryRail'
import { ClassComposer } from './ClassComposer'
import {
  getClassStyleSectionSetCounts,
  getActiveStyleTab,
} from './cssControlTypes'
import { ComponentRefView } from './ComponentRefView'
import { ParamPromotableRow } from './ParamPromotableRow'
import { ComponentParamsOverview } from './ComponentParamsOverview'
import { ConvertToComponentButton } from './ConvertToComponentButton'
import { SearchBar } from '@ui/components/SearchBar'
import { PanelHeader } from '../shared/PanelHeader'
import { useDraggablePanel } from '../../hooks/useDraggablePanel'
import { Button } from '@ui/components/Button'
import { EmptyState } from '@ui/components/EmptyState'
import { Input } from '@ui/components/Input'
import { OpenIcon } from 'pixel-art-icons/icons/open'
import { DockIcon } from 'pixel-art-icons/icons/dock'
import { EditIcon } from 'pixel-art-icons/icons/edit'
import { cn } from '@ui/cn'
import styles from './PropertiesPanel.module.css'

const DEFAULT_WIDTH = 360
const MIN_WIDTH = 280
type PanelVariant = 'floating' | 'docked'

interface PropertiesPanelProps {
  variant?: PanelVariant
}

// ---------------------------------------------------------------------------
// PropertiesPanel
// ---------------------------------------------------------------------------

export function PropertiesPanel({ variant = 'floating' }: PropertiesPanelProps) {
  // ─── Auto-open when a node is selected (Guideline #358 / Architect #504) ──
  usePropertiesPanelAutoOpen()

  // ─── Store subscriptions ───────────────────────────────────────────────────
  const selectedNode = useEditorStore(selectSelectedNode)
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId)
  const updateNodeProps = useEditorStore((s) => s.updateNodeProps)
  const setNodeDynamicBinding = useEditorStore((s) => s.setNodeDynamicBinding)
  const clearNodeDynamicBinding = useEditorStore((s) => s.clearNodeDynamicBinding)
  const setBreakpointOverride = useEditorStore((s) => s.setBreakpointOverride)
  const renameClass = useEditorStore((s) => s.renameClass)
  const activeBreakpointId = useEditorStore((s) => s.activeBreakpointId)
  const renameNode = useEditorStore((s) => s.renameNode)
  const site = useEditorStore((s) => s.site)
  const activePageId = useEditorStore((s) => s.activePageId)
  const activeClassId = useEditorStore((s) => s.activeClassId)
  const selectedSelectorClassId = useEditorStore((s) => s.selectedSelectorClassId)

  const panelState = useEditorStore((s) => s.propertiesPanel)
  const setPropertiesPanelMode = useEditorStore((s) => s.setPropertiesPanelMode)
  const togglePropertiesPanel = useEditorStore((s) => s.togglePropertiesPanel)
  const focusedPanel = useEditorStore((s) => s.focusedPanel)
  const setFocusedPanel = useEditorStore((s) => s.setFocusedPanel)
  const activeDocument = useEditorStore((s) => s.activeDocument)

  // Resolve active VC for ComponentParamsOverview (null when not in VC canvas mode).
  const activeVc = activeDocument?.kind === 'visualComponent'
    ? site?.visualComponents?.find((v) => v.id === activeDocument.vcId) ?? null
    : null

  const [statusMessage, setStatusMessage] = useState('')

  // ── ClassPicker ref — for the locked-state 'Add class' CTA ────────────────
  const classPickerRef = useRef<ClassPickerHandle>(null)
  const handleFocusClassPicker = useCallback(() => {
    classPickerRef.current?.focusInput()
  }, [])

  // ── Draggable panel position ───────────────────────────────────────────────
  const { panelRef: dragPanelElementRef, headerDragProps, panelPositionStyle } = useDraggablePanel(
    'properties',
    () => ({
      x: typeof window !== 'undefined' ? window.innerWidth - DEFAULT_WIDTH - 16 : 16,
      y: 16,
    }),
  )

  // ─── Focus management: F6 moves focus into panel ──────────────────────────
  useEffect(() => {
    if (focusedPanel !== 'properties') return
    const panel = dragPanelElementRef.current
    if (!panel) return
    if (panel.contains(document.activeElement)) return
    panel.focus()
  }, [focusedPanel, dragPanelElementRef])

  // ─── Panel keyboard shortcuts ──────────────────────────────────────────────
  const handlePanelKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'F6') {
      e.preventDefault()
      useEditorStore.getState().cycleFocusedPanel()
    }
  }, [])

  const definition = selectedNode ? registry.get(selectedNode.moduleId) : null
  const resolvedPropsForBreakpoint = selectedNode
    ? resolveProps(selectedNode, activeBreakpointId !== 'desktop' ? activeBreakpointId : undefined)
    : null
  const overrideKeys =
    selectedNode && activeBreakpointId && activeBreakpointId !== 'desktop'
      ? new Set(Object.keys(selectedNode.breakpointOverrides[activeBreakpointId] ?? {}))
      : new Set<string>()

  const selectedSelectorClass = selectedSelectorClassId ? site?.classes[selectedSelectorClassId] ?? null : null
  const activeClass =
    !selectedSelectorClass &&
    activeClassId && selectedNode?.classIds?.includes(activeClassId)
      ? site?.classes[activeClassId]
      : null
  const activePage = site?.pages.find((page) => page.id === activePageId) ?? null
  const dynamicBindingsEnabled = activePage?.template?.context === 'entry'

  // ─── Prop change handler ───────────────────────────────────────────────────
  const handleChange = useCallback(
    (propKey: string, value: unknown) => {
      if (!selectedNodeId) return
      if (activeBreakpointId && activeBreakpointId !== 'desktop') {
        setBreakpointOverride(selectedNodeId, activeBreakpointId, { [propKey]: value })
      } else {
        updateNodeProps(selectedNodeId, { [propKey]: value })
      }
      setStatusMessage(`${propKey} updated`)
    },
    [selectedNodeId, activeBreakpointId, updateNodeProps, setBreakpointOverride],
  )

  const collapsed = panelState.collapsed
  const width = Math.max(panelState.width || DEFAULT_WIDTH, MIN_WIDTH)

  if (collapsed || (!selectedNodeId && !selectedSelectorClass)) return null

  const modeButtonLabel = variant === 'docked'
    ? 'Unpin Properties panel'
    : 'Dock Properties panel'
  const modeButtonTitle = variant === 'docked'
    ? 'Unpin to floating panel'
    : 'Dock in right sidebar'

  // ── Module tab content — pre-rendered, passed to StyleSurface as a ReactNode
  const moduleTabContent = definition && selectedNode && resolvedPropsForBreakpoint
    ? (
      <>
        {Object.entries(definition.schema).map(([key, control]: [string, PropertyControl]) => {
          if (control.condition && !evaluateCondition(control.condition, resolvedPropsForBreakpoint)) {
            return null
          }

          if (activeDocument?.kind === 'visualComponent' && selectedNodeId && selectedNode) {
            return (
              <ParamPromotableRow
                key={key}
                vcId={activeDocument.vcId}
                nodeId={selectedNodeId}
                propKey={key}
                control={control}
                value={resolvedPropsForBreakpoint[key]}
                isOverride={overrideKeys.has(key)}
                onChange={handleChange}
              />
            )
          }

          return (
            <PropertyControlRenderer
              key={key}
              propKey={key}
              control={control}
              value={resolvedPropsForBreakpoint[key]}
              onChange={handleChange}
              isOverride={overrideKeys.has(key)}
              dynamicBinding={dynamicBindingsEnabled && selectedNodeId ? {
                binding: selectedNode.dynamicBindings?.[key],
                onSet: (binding) => {
                  setNodeDynamicBinding(selectedNodeId, key, binding)
                  setStatusMessage(`${key} bound`)
                },
                onClear: () => {
                  clearNodeDynamicBinding(selectedNodeId, key)
                  setStatusMessage(`${key} binding removed`)
                },
              } : undefined}
            />
          )
        })}
      </>
    )
    : null

  return (
    <aside
      ref={dragPanelElementRef}
      data-panel=""
      data-testid="properties-panel"
      role="complementary"
      aria-label="Properties"
      tabIndex={-1}
      data-variant={variant}
      onKeyDown={handlePanelKeyDown}
      onFocus={() => setFocusedPanel('properties')}
      onClick={(e) => e.stopPropagation()}
      style={
        variant === 'floating'
          ? { '--panel-w': `${width}px`, ...panelPositionStyle } as React.CSSProperties
          : undefined
      }
      className={cn(styles.panel, variant === 'docked' && styles.panelDocked)}
    >
      {/* ─── Screen-reader live region (Guideline #331) ─────────────────── */}
      <div role="status" aria-live="polite" className={styles.srLiveRegion}>
        {statusMessage}
      </div>

      {/* ─── Shared Panel Header — drag handle + close button ─────────────── */}
      <PanelHeader
        panelId="properties"
        title="Properties"
        titleContent={selectedSelectorClass ? (
          <SelectorHeader
            cls={selectedSelectorClass}
            onRename={(name) => renameClass(selectedSelectorClass.id, name)}
          />
        ) : selectedNode && definition ? (
          <NodeHeader
            key={selectedNodeId}
            nodeId={selectedNodeId!}
            label={selectedNode.label}
            moduleName={definition.name}
            onRename={(label) => renameNode(selectedNodeId!, label)}
          />
        ) : undefined}
        onClose={togglePropertiesPanel}
        dragHandleProps={variant === 'floating' ? headerDragProps : undefined}
      >
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          onClick={() => setPropertiesPanelMode(variant === 'docked' ? 'floating' : 'docked')}
          aria-label={modeButtonLabel}
          tooltip={modeButtonTitle}
        >
          {variant === 'docked' ? (
            <OpenIcon size={12} aria-hidden="true" />
          ) : (
            <DockIcon size={12} aria-hidden="true" />
          )}
        </Button>
      </PanelHeader>

      {/* ─── Properties content (independent panel — Guideline #410) ─────── */}
      <div
        aria-label="Properties editor"
        className={styles.propertiesPanel}
      >
        {selectedSelectorClass ? (
          <SelectorInspector
            cls={selectedSelectorClass}
            activeBreakpointId={activeBreakpointId}
          />
        ) : !selectedNode || !definition ? (
          activeDocument?.kind === 'visualComponent' && selectedNodeId === null && selectedSelectorClassId === null && activeVc
            ? <ComponentParamsOverview vc={activeVc} />
            : (
              <EmptyState
                variant="centered"
                title="Select an element on the canvas to view its properties."
              />
            )
        ) : selectedNode.moduleId === 'base.visual-component-ref' ? (
          /* ── Visual Component instance view (Task #438 / Contribution #619 §8.5) ── */
          <ComponentRefView
            nodeId={selectedNodeId!}
            componentId={String(selectedNode.props.componentId ?? '')}
            propOverrides={(selectedNode.props.propOverrides ?? {}) as Record<string, unknown>}
          />
        ) : (
          /* ── Unified panel: ClassPicker above StyleSurface ────────────── */
          <div className={styles.nodeArea}>
            {/* ClassPicker — always visible, manages class assignment.
                On regular page nodes we render the Convert-to-component
                button as the input row's trailing action so the two share
                a 2-column layout with matching heights, and the suggestions
                dropdown spans the full row. */}
            <div className={styles.headerClassPicker}>
              <ClassPicker
                ref={classPickerRef}
                nodeId={selectedNodeId!}
                trailingAction={
                  activeDocument?.kind !== 'visualComponent' &&
                  selectedNode.moduleId !== 'base.root' &&
                  selectedNode.moduleId !== 'base.visual-component-ref'
                    ? <ConvertToComponentButton nodeId={selectedNodeId!} />
                    : undefined
                }
              />
            </div>

            {/* Unified StyleSurface: Module section + CSS sections (scroll-anchor) */}
            <StyleSurface
              definition={definition}
              activeClass={activeClass ?? null}
              activeClassId={activeClassId ?? null}
              activeBreakpointId={activeBreakpointId}
              nodeId={selectedNodeId}
              moduleContent={moduleTabContent}
              onFocusClassPicker={handleFocusClassPicker}
            />
          </div>
        )}
      </div>

    </aside>
  )
}

// ---------------------------------------------------------------------------
// NodeHeader — selected element name with inline rename in the panel header
// ---------------------------------------------------------------------------

interface NodeHeaderProps {
  nodeId: string
  label: string | undefined
  moduleName: string
  onRename: (label: string) => void
}

function NodeHeader({ nodeId, label, moduleName, onRename }: NodeHeaderProps) {
  const [isEditing, setIsEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const displayName = label ?? moduleName

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.value = displayName
    }
  }, [nodeId, displayName, isEditing])

  useEffect(() => {
    if (!isEditing) return
    requestAnimationFrame(() => inputRef.current?.select())
  }, [isEditing])

  const commitRename = useCallback((input: HTMLInputElement) => {
    const nextLabel = input.value.trim()
    if (nextLabel && nextLabel !== displayName) {
      onRename(nextLabel)
    } else {
      input.value = displayName
    }
    setIsEditing(false)
  }, [displayName, onRename])

  const cancelRename = useCallback((input: HTMLInputElement) => {
    input.value = displayName
    setIsEditing(false)
  }, [displayName])

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        type="text"
        fieldSize="xs"
        emphasis="strong"
        defaultValue={displayName}
        onBlur={(e) => commitRename(e.target)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            cancelRename(e.target as HTMLInputElement)
          }
        }}
        aria-label="Element name"
        className={styles.headerNameInput}
      />
    )
  }

  return (
    <div className={styles.headerNodeTitle}>
      <span className={styles.headerNodeLabel} title={displayName}>{displayName}</span>
      <Button
        variant="ghost"
        size="xs"
        iconOnly
        onClick={() => setIsEditing(true)}
        aria-label={`Rename ${displayName}`}
        tooltip="Rename element"
      >
        <EditIcon size={12} aria-hidden="true" />
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SelectorHeader — class selector name with inline rename
// ---------------------------------------------------------------------------

interface SelectorHeaderProps {
  cls: CSSClass
  onRename: (name: string) => void
}

function SelectorHeader({ cls, onRename }: SelectorHeaderProps) {
  const [isEditing, setIsEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectorLabel = `.${cls.name}`

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.value = selectorLabel
    }
  }, [cls.id, selectorLabel, isEditing])

  useEffect(() => {
    if (!isEditing) return
    requestAnimationFrame(() => inputRef.current?.select())
  }, [isEditing])

  const commitRename = useCallback((input: HTMLInputElement) => {
    const rawName = input.value.trim()
    const nextName = (rawName.startsWith('.') ? rawName.slice(1) : rawName).trim()
    if (nextName && nextName !== cls.name) {
      try {
        onRename(nextName)
      } catch {
        input.value = selectorLabel
      }
    } else {
      input.value = selectorLabel
    }
    setIsEditing(false)
  }, [cls.name, onRename, selectorLabel])

  const cancelRename = useCallback((input: HTMLInputElement) => {
    input.value = selectorLabel
    setIsEditing(false)
  }, [selectorLabel])

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        type="text"
        fieldSize="xs"
        emphasis="strong"
        defaultValue={selectorLabel}
        onBlur={(e) => commitRename(e.target)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            cancelRename(e.target as HTMLInputElement)
          }
        }}
        aria-label="Class name"
        className={styles.headerNameInput}
      />
    )
  }

  return (
    <div className={styles.headerNodeTitle}>
      <span className={styles.headerNodeLabel} title={selectorLabel} role="heading" aria-level={2}>{selectorLabel}</span>
      <Button
        variant="ghost"
        size="xs"
        iconOnly
        onClick={() => setIsEditing(true)}
        aria-label={`Rename selector ${selectorLabel}`}
        tooltip="Rename selector"
      >
        <EditIcon size={12} aria-hidden="true" />
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SelectorInspector — global selector surface (rail + ClassComposer, no module tab)
// ---------------------------------------------------------------------------

interface SelectorInspectorProps {
  cls: CSSClass
  activeBreakpointId: string | undefined
}

function SelectorInspector({ cls, activeBreakpointId }: SelectorInspectorProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeAnchorId, setActiveAnchorId] = useState(ALL_STYLE_CATEGORY_ID)
  const [styleQuery, setStyleQuery] = useState('')
  const clearStyleQuery = useCallback(() => setStyleQuery(''), [])

  // Derive active anchor from scroll position.
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    function updateActive() {
      if (!container) return
      const sections = container.querySelectorAll<HTMLElement>('[data-style-section]')
      const containerRect = container.getBoundingClientRect()
      let activeId = ALL_STYLE_CATEGORY_ID
      let closestAboveTop = -Infinity
      for (const section of Array.from(sections)) {
        const id = section.getAttribute('data-style-section')
        if (!id) continue
        const relTop = section.getBoundingClientRect().top - containerRect.top
        if (relTop <= 1 && relTop > closestAboveTop) {
          closestAboveTop = relTop
          activeId = id
        }
      }
      setActiveAnchorId(activeId)
    }

    container.addEventListener('scroll', updateActive, { passive: true })
    return () => container.removeEventListener('scroll', updateActive)
  }, [])

  const handleSectionClick = useCallback((sectionId: string) => {
    const container = scrollRef.current
    if (!container) return
    if (sectionId === ALL_STYLE_CATEGORY_ID) {
      setActiveAnchorId(ALL_STYLE_CATEGORY_ID)
      container.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setActiveAnchorId(sectionId)
    const el = container.querySelector<HTMLElement>(`[data-style-section="${sectionId}"]`)
    if (!el) return
    const containerRect = container.getBoundingClientRect()
    const rect = el.getBoundingClientRect()
    container.scrollTo({ top: rect.top - containerRect.top + container.scrollTop, behavior: 'smooth' })
  }, [])

  if (isGeneratedClassLocked(cls)) {
    return (
      <div className={styles.nodeArea}>
        <GeneratedUtilityLockedState cls={cls} />
      </div>
    )
  }

  const activeTab = getActiveStyleTab(activeBreakpointId)
  const storedStyles = activeTab !== 'base' ? (cls.breakpointStyles[activeTab] ?? {}) : cls.styles
  const sectionSetCounts = getClassStyleSectionSetCounts(storedStyles)

  return (
    <div className={styles.nodeArea}>
      <div className={styles.selectorSearchBar}>
        <SearchBar
          value={styleQuery}
          onValueChange={setStyleQuery}
          onClear={clearStyleQuery}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              clearStyleQuery()
            }
          }}
          placeholder={`Search styles in ${cls.name}...`}
          aria-label="Search class style properties to add"
        />
      </div>
      <div className={styles.selectorSurfaceLayout}>
        <div ref={scrollRef} className={styles.selectorScrollContainer}>
          <ClassComposer
            key={cls.id}
            classId={cls.id}
            cls={cls}
            styleQuery={styleQuery}
            mode="global"
          />
        </div>
        <StyleCategoryRail
          activeAnchorId={activeAnchorId}
          sectionSetCounts={sectionSetCounts}
          onSectionClick={handleSectionClick}
          definition={null}
          activeClass={cls}
        />
      </div>
    </div>
  )
}
