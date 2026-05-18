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
} from '@site/store/store'
import { usePropertiesPanelAutoOpen } from './usePropertiesPanelAutoOpen'
import { registry } from '@core/module-engine/registry'
import { evaluateCondition, getAncestors, resolveProps } from '@core/page-tree/selectors'
import { loopSourceRegistry } from '@core/loops/registry'
import { isGeneratedClassLocked } from '@core/page-tree/classUtils'
import { PropertyControlRenderer } from '@site/property-controls/PropertyControlRenderer'
import type { AnyModuleDefinition, PropertyControl } from '@core/module-engine/types'
import type { CSSClass, DynamicPropBinding, PageNode } from '@core/page-tree/schemas'
import type { LoopEntitySource } from '@core/loops/types'
import type { ActiveDocument } from '@site/store/slices/uiSlice'
import { ClassPicker, type ClassPickerHandle } from './ClassPicker'
import { StyleSurface, GeneratedUtilityLockedState } from './StyleSurface'
import { StyleCategoryRail } from './StyleCategoryRail'
import { ClassComposer } from './ClassComposer'
import {
  CLASS_STYLE_SECTIONS,
  getClassStyleSectionSetCounts,
  getActiveStyleTab,
} from './cssControlTypes'
import { ComponentRefView } from './ComponentRefView'
import { LoopPropertiesView } from './LoopPropertiesView'
import { ParamPromotableRow } from './ParamPromotableRow'
import { ComponentParamsOverview } from './ComponentParamsOverview'
import { ConvertToComponentButton } from './ConvertToComponentButton'
import {
  MultiSelectionInspector,
  MultiSelectionHeader,
} from './MultiSelectionInspector'
import { useShallow } from 'zustand/react/shallow'
import { SearchBar } from '@ui/components/SearchBar'
import { PanelHeader } from '@admin/shared/PanelHeader'
import { useDraggablePanel } from '@site/hooks/useDraggablePanel'
import { Button } from '@ui/components/Button'
import { EmptyState } from '@ui/components/EmptyState'
import { useEditorPreference } from '@site/preferences/editorPreferences'
import { useEditorPermissions } from '@site/editorPermissionsContext'
import { Input } from '@ui/components/Input'
import { OpenSolidIcon } from 'pixel-art-icons/icons/open-solid'
import { DockSolidIcon } from 'pixel-art-icons/icons/dock-solid'
import { EditSolidIcon } from 'pixel-art-icons/icons/edit-solid'
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
  // Multi-select awareness: when 2+ ids are selected we show the
  // MultiSelectionInspector instead of the single-node UI.
  const selectedNodeIds = useEditorStore(useShallow((s) => s.selectedNodeIds))
  const isMultiSelect = selectedNodeIds.length > 1
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
    ? resolveProps(
        selectedNode,
        activeBreakpointId !== 'desktop' ? activeBreakpointId : undefined,
        definition?.schema,
      )
    : null
  // Only props the module marks `breakpointOverridable: true` may carry a
  // per-breakpoint override; everything else is content (single value across
  // all breakpoints). Filter the override-indicator set the same way so the
  // UI never claims a content prop has a per-breakpoint variant — even if
  // stale data on disk technically does.
  const overrideKeys =
    selectedNode && definition && activeBreakpointId && activeBreakpointId !== 'desktop'
      ? new Set(
          Object.keys(selectedNode.breakpointOverrides[activeBreakpointId] ?? {}).filter(
            (key) => definition.schema[key]?.breakpointOverridable === true,
          ),
        )
      : new Set<string>()

  const selectedSelectorClass = selectedSelectorClassId ? site?.classes[selectedSelectorClassId] ?? null : null
  const activeClass =
    !selectedSelectorClass &&
    activeClassId && selectedNode?.classIds?.includes(activeClassId)
      ? site?.classes[activeClassId]
      : null
  const activePage = site?.pages.find((page) => page.id === activePageId) ?? null

  // Dynamic bindings are available whenever the selected node sits inside a
  // scope that produces a `currentEntry` at render time:
  //   - on a single-entry template page (the page itself injects an entry), OR
  //   - inside a `base.loop` subtree (the loop pushes an iteration item per render).
  // For nodes with a `base.loop` ancestor we expose the same `currentEntry`
  // bindings — they resolve to the loop's iteration item via the publisher's
  // entry-stack semantics.
  const ancestors = activePage && selectedNodeId
    ? getAncestors(activePage, selectedNodeId)
    : []
  // Closest enclosing loop wins — that's the one whose source defines the
  // available fields for `currentEntry` bindings inside this subtree.
  const enclosingLoopNode = [...ancestors]
    .reverse()
    .find((a) => a.moduleId === 'base.loop')
  const enclosingLoopSourceId =
    enclosingLoopNode && typeof enclosingLoopNode.props.sourceId === 'string'
      ? enclosingLoopNode.props.sourceId
      : null
  const enclosingLoopSource = enclosingLoopSourceId
    ? loopSourceRegistry.get(enclosingLoopSourceId)
    : undefined
  // Loop bound to a specific data table — pass its tableId down so the binding
  // picker can auto-scope to that table (the only one the loop will iterate),
  // instead of offering every table in the workspace.
  const enclosingLoopTableId: string | null = (() => {
    if (!enclosingLoopNode || enclosingLoopSourceId !== 'data.rows') return null
    const filters = enclosingLoopNode.props.filters
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) return null
    const tableId = (filters as Record<string, unknown>).tableId
    return typeof tableId === 'string' && tableId ? tableId : null
  })()
  // Bindings are always available. The picker decides which sources are
  // meaningful in the current context (`currentEntry` / `parentEntry`
  // only when inside a loop or template page; page / site / viewer / route
  // are always offered). Phase 3 of the binding system refactor —
  // see docs/superpowers/plans/2026-05-… for the broader plan.
  const dynamicBindingsEnabled = true

  // ─── Prop change handler ───────────────────────────────────────────────────
  //
  // A non-default breakpoint frame routes writes through
  // `setBreakpointOverride` ONLY when the module schema marks the prop
  // `breakpointOverridable: true`. For everything else (the default — content
  // props like text, tag, src, alt) the edit always lands on base props,
  // because the published page is one HTML document and content cannot
  // meaningfully differ per viewport. Visual responsive variation lives in
  // class breakpoint styles, not in module props.
  //
  // The schema lookup is intentionally performed via `registry.get()` inside
  // the callback rather than closing over the `definition` object — that
  // keeps the callback's deps array referentially stable and lets the
  // memoization survive parent re-renders that recompute `definition`.
  const moduleId = selectedNode?.moduleId
  const handleChange = useCallback(
    (propKey: string, value: unknown) => {
      if (!selectedNodeId) return
      const def = moduleId ? registry.get(moduleId) : null
      const isOverridable = def?.schema[propKey]?.breakpointOverridable === true
      if (activeBreakpointId && activeBreakpointId !== 'desktop' && isOverridable) {
        setBreakpointOverride(selectedNodeId, activeBreakpointId, { [propKey]: value })
      } else {
        updateNodeProps(selectedNodeId, { [propKey]: value })
      }
      setStatusMessage(`${propKey} updated`)
    },
    [selectedNodeId, moduleId, activeBreakpointId, updateNodeProps, setBreakpointOverride],
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

  // ── Module tab content — pre-rendered, passed to StyleSurface as a ReactNode.
  // The dispatch lives in `renderModuleTabContent` to keep this function flat;
  // see the helper at the bottom of the file for the rationale.
  const moduleTabContent: React.ReactNode = renderModuleTabContent({
    selectedNode,
    selectedNodeId,
    definition,
    resolvedPropsForBreakpoint,
    overrideKeys,
    activeDocument,
    dynamicBindingsEnabled,
    enclosingLoopSource,
    enclosingLoopTableId,
    handleChange,
    onSetDynamicBinding: (key, binding) => {
      if (!selectedNodeId) return
      setNodeDynamicBinding(selectedNodeId, key, binding)
      setStatusMessage(`${key} bound`)
    },
    onClearDynamicBinding: (key) => {
      if (!selectedNodeId) return
      clearNodeDynamicBinding(selectedNodeId, key)
      setStatusMessage(`${key} binding removed`)
    },
  })

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
        ) : isMultiSelect ? (
          <MultiSelectionHeader count={selectedNodeIds.length} />
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
            <OpenSolidIcon size={12} aria-hidden="true" />
          ) : (
            <DockSolidIcon size={12} aria-hidden="true" />
          )}
        </Button>
      </PanelHeader>

      {/* ─── Properties content (independent panel — Guideline #410) ─────── */}
      <div
        aria-label="Properties editor"
        className={styles.propertiesPanel}
      >
        <PropertiesPanelBody
          selectedSelectorClass={selectedSelectorClass}
          selectedSelectorClassId={selectedSelectorClassId}
          activeBreakpointId={activeBreakpointId}
          isMultiSelect={isMultiSelect}
          selectedNodeIds={selectedNodeIds}
          selectedNode={selectedNode}
          selectedNodeId={selectedNodeId}
          definition={definition}
          activeDocument={activeDocument}
          activeVc={activeVc}
          activeClass={activeClass ?? null}
          activeClassId={activeClassId ?? null}
          moduleTabContent={moduleTabContent}
          classPickerRef={classPickerRef}
          onFocusClassPicker={handleFocusClassPicker}
        />
      </div>

    </aside>
  )
}

// ---------------------------------------------------------------------------
// PropertiesPanelBody — selects which inspector surface to show inside the
// scrollable content area.
//
// Five branches, in priority order:
//   1. A class is selected via the Selectors panel → global selector inspector
//      (no node context, just the rule + style sections).
//   2. Multiple nodes are selected → multi-select inspector.
//   3. No node + no selector, but we're inside a Visual Component canvas →
//      show the VC's param surface.
//   4. No node at all (page canvas with nothing selected) → empty hint.
//   5. A `base.visual-component-ref` is selected → instance view (params +
//      override matrix). Other nodes → ClassPicker + StyleSurface.
// ---------------------------------------------------------------------------

interface PropertiesPanelBodyProps {
  selectedSelectorClass: CSSClass | null
  selectedSelectorClassId: string | null
  activeBreakpointId: string | undefined
  isMultiSelect: boolean
  selectedNodeIds: string[]
  selectedNode: PageNode | null
  selectedNodeId: string | null
  definition: AnyModuleDefinition | null | undefined
  activeDocument: ActiveDocument | null
  activeVc: { id: string; name: string; params: unknown[]; tree: unknown } | null
  activeClass: CSSClass | null
  activeClassId: string | null
  moduleTabContent: React.ReactNode
  classPickerRef: React.RefObject<ClassPickerHandle | null>
  onFocusClassPicker: () => void
}

function PropertiesPanelBody(props: PropertiesPanelBodyProps): React.ReactNode {
  const {
    selectedSelectorClass,
    selectedSelectorClassId,
    activeBreakpointId,
    isMultiSelect,
    selectedNodeIds,
    selectedNode,
    selectedNodeId,
    definition,
    activeDocument,
    activeVc,
    activeClass,
    activeClassId,
    moduleTabContent,
    classPickerRef,
    onFocusClassPicker,
  } = props
  const permissions = useEditorPermissions()

  if (selectedSelectorClass) {
    return (
      <SelectorInspector cls={selectedSelectorClass} activeBreakpointId={activeBreakpointId} />
    )
  }

  if (isMultiSelect) {
    return <MultiSelectionInspector selectedNodeIds={selectedNodeIds} />
  }

  if (!selectedNode || !definition) {
    const inEmptyVcCanvas =
      activeDocument?.kind === 'visualComponent' &&
      selectedNodeId === null &&
      selectedSelectorClassId === null &&
      !!activeVc
    if (inEmptyVcCanvas && activeVc) {
      return <ComponentParamsOverview vc={activeVc as Parameters<typeof ComponentParamsOverview>[0]['vc']} />
    }
    return (
      <EmptyState
        variant="centered"
        title="Select an element on the canvas to view its properties."
      />
    )
  }

  if (selectedNode.moduleId === 'base.visual-component-ref') {
    // Visual Component instance view (Task #438 / Contribution #619 §8.5).
    return (
      <ComponentRefView
        nodeId={selectedNodeId!}
        componentId={String(selectedNode.props.componentId ?? '')}
        propOverrides={(selectedNode.props.propOverrides ?? {}) as Record<string, unknown>}
      />
    )
  }

  // Default node surface — ClassPicker above StyleSurface.
  //
  // ClassPicker mutates the classes registry, so it is style-editing. Hide it
  // from callers without `site.style.edit` — a content-only Client can't add
  // or remove classes regardless.
  //
  // ConvertToComponentButton is structural (it adds a new VC to the registry
  // and replaces the selected subtree with a ref) — gate on structure.
  const showConvertToComponent =
    permissions.canEditStructure &&
    activeDocument?.kind !== 'visualComponent' &&
    selectedNode.moduleId !== 'base.body' &&
    selectedNode.moduleId !== 'base.visual-component-ref'

  return (
    <div className={styles.nodeArea}>
      {/* ClassPicker — always visible to style-edit-capable callers. Hidden
          for content-only Clients. */}
      {permissions.canEditStyle && (
        <div className={styles.headerClassPicker}>
          <ClassPicker
            ref={classPickerRef}
            nodeId={selectedNodeId!}
            trailingAction={
              showConvertToComponent
                ? <ConvertToComponentButton nodeId={selectedNodeId!} />
                : undefined
            }
          />
        </div>
      )}

      {/* Unified StyleSurface: Module section + CSS sections (scroll-anchor) */}
      <StyleSurface
        definition={definition}
        activeClass={activeClass}
        activeClassId={activeClassId}
        activeBreakpointId={activeBreakpointId}
        nodeId={selectedNodeId}
        moduleContent={moduleTabContent}
        onFocusClassPicker={onFocusClassPicker}
      />
    </div>
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
  // Renaming a node mutates `node.label` — a structural change, not content.
  const canRename = useEditorPermissions().canEditStructure

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
      {canRename && (
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          onClick={() => setIsEditing(true)}
          aria-label={`Rename ${displayName}`}
          tooltip="Rename element"
        >
          <EditSolidIcon size={12} aria-hidden="true" />
        </Button>
      )}
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
  // Renaming a class is a style edit — gate on `site.style.edit`.
  const canRename = useEditorPermissions().canEditStyle

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
      {canRename && (
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          onClick={() => setIsEditing(true)}
          aria-label={`Rename selector ${selectorLabel}`}
          tooltip="Rename selector"
        >
          <EditSolidIcon size={12} aria-hidden="true" />
        </Button>
      )}
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

const FIRST_STYLE_SECTION_ID = CLASS_STYLE_SECTIONS[0].id

function SelectorInspector({ cls, activeBreakpointId }: SelectorInspectorProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeAnchorId, setActiveAnchorId] = useState<string>(FIRST_STYLE_SECTION_ID)
  const [styleQuery, setStyleQuery] = useState('')
  const clearStyleQuery = useCallback(() => setStyleQuery(''), [])
  // Smooth-scroll behaviour gated by the `propertiesSmoothScroll` preference.
  const propertiesSmoothScroll = useEditorPreference('propertiesSmoothScroll')

  // Derive active anchor from scroll position.
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    function updateActive() {
      if (!container) return
      const sections = container.querySelectorAll<HTMLElement>('[data-style-section]')
      const containerRect = container.getBoundingClientRect()
      let activeId = FIRST_STYLE_SECTION_ID
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
    const behavior: ScrollBehavior = propertiesSmoothScroll ? 'smooth' : 'auto'
    setActiveAnchorId(sectionId)
    const el = container.querySelector<HTMLElement>(`[data-style-section="${sectionId}"]`)
    if (!el) return
    const containerRect = container.getBoundingClientRect()
    const rect = el.getBoundingClientRect()
    container.scrollTo({ top: rect.top - containerRect.top + container.scrollTop, behavior })
  }, [propertiesSmoothScroll])

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

// ---------------------------------------------------------------------------
// renderModuleTabContent — derive the JSX shown inside StyleSurface's Module
// section.
//
// Three branches:
//   1. `base.loop` — substitute the schema-driven control list with the
//      dedicated `LoopPropertiesView` (source picker + dynamic filter UI).
//      The loop's empty `schema` would otherwise leave the section blank.
//      Crucially, we still render this *inside* the standard StyleSurface
//      flow, which means the ClassPicker + style sections (display, layout,
//      etc.) keep working — the user can assign classes to the loop wrapper
//      to lay out iterations as a grid, flex row, columns, etc.
//   2. Visual-component-mode — wrap each control in `ParamPromotableRow` so
//      the user can lift the prop to the VC's param surface in one click.
//   3. Default — render each control via `PropertyControlRenderer` with
//      optional dynamic-binding wiring when the node sits inside an entry-
//      template page or a `base.loop` ancestor subtree.
// ---------------------------------------------------------------------------

interface ModuleTabContentArgs {
  selectedNode: PageNode | null
  selectedNodeId: string | null
  definition: AnyModuleDefinition | null | undefined
  resolvedPropsForBreakpoint: Record<string, unknown> | null
  overrideKeys: Set<string>
  activeDocument: ActiveDocument | null
  dynamicBindingsEnabled: boolean
  enclosingLoopSource: LoopEntitySource | undefined
  enclosingLoopTableId: string | null
  handleChange: (propKey: string, value: unknown) => void
  onSetDynamicBinding: (propKey: string, binding: DynamicPropBinding) => void
  onClearDynamicBinding: (propKey: string) => void
}

function renderModuleTabContent(args: ModuleTabContentArgs): React.ReactNode {
  const {
    selectedNode,
    selectedNodeId,
    definition,
    resolvedPropsForBreakpoint,
    overrideKeys,
    activeDocument,
    dynamicBindingsEnabled,
    enclosingLoopSource,
    enclosingLoopTableId,
    handleChange,
    onSetDynamicBinding,
    onClearDynamicBinding,
  } = args

  // Branch 1: `base.loop` gets the dedicated loop UI.
  if (selectedNode?.moduleId === 'base.loop' && selectedNodeId) {
    return (
      <LoopPropertiesView
        nodeId={selectedNodeId}
        props={selectedNode.props as Record<string, unknown>}
      />
    )
  }

  // Branches 2 & 3 share the schema iteration; bail when there's nothing
  // to render against.
  if (!definition || !selectedNode || !resolvedPropsForBreakpoint) return null

  const inVisualComponent =
    activeDocument?.kind === 'visualComponent' && selectedNodeId !== null

  return (
    <>
      {Object.entries(definition.schema).map(([key, control]: [string, PropertyControl]) => {
        if (control.condition && !evaluateCondition(control.condition, resolvedPropsForBreakpoint)) {
          return null
        }

        if (inVisualComponent && activeDocument?.kind === 'visualComponent' && selectedNodeId) {
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
              onSet: (binding) => onSetDynamicBinding(key, binding),
              onClear: () => onClearDynamicBinding(key),
              availableFields: enclosingLoopSource?.fields,
              sourceLabel: enclosingLoopSource?.label,
              loopTableId: enclosingLoopTableId,
            } : undefined}
          />
        )
      })}
    </>
  )
}
