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
 * Redesign (Task #456 / Spec #659): single-scroll layout replaces 3-tab paradigm.
 *   - ClassPicker always-visible under the node header
 *   - Module props in collapsible Section (default open)
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
} from '../../../core/editor-store/store'

import { usePropertiesPanelAutoOpen } from './usePropertiesPanelAutoOpen'
import { registry } from '../../../core/module-engine/registry'
import { evaluateCondition, resolveProps } from '../../../core/page-tree/selectors'
import { cssClassSelector } from '../../../core/page-tree/classNames'
import { PropertyControlRenderer } from '../PropertyControls/PropertyControlRenderer'
import type { AnyModuleDefinition, PropertyControl } from '../../../core/module-engine/types'
import type { CSSClass, PageNode, SiteDocument } from '../../../core/page-tree/types'
import { ClassPicker } from './ClassPicker'
import { ClassComposer } from './ClassComposer'
import { Section } from './Section'
import { ComponentRefView } from './ComponentRefView'
import {
  getModuleStyleBindings,
  isModuleStyleSet,
  type ResolvedModuleStyleBinding,
} from './moduleStyleBindings'
import { PanelHeader } from '../shared/PanelHeader'
import { useDraggablePanel } from '../../hooks/useDraggablePanel'
import { Button } from '@ui/components/Button'
import { Input } from '@ui/components/Input'
import { OpenIcon } from '@ui/icons/icons/open'
import { DockIcon } from '@ui/icons/icons/dock'
import { Settings2Icon } from '@ui/icons/icons/settings-2'
import { EditIcon } from '@ui/icons/icons/edit'
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
  const ensureNodeStyleClass = useEditorStore((s) => s.ensureNodeStyleClass)
  const updateClassStyles = useEditorStore((s) => s.updateClassStyles)
  const setClassBreakpointStyles = useEditorStore((s) => s.setClassBreakpointStyles)
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

  const [statusMessage, setStatusMessage] = useState('')

  // ── Draggable panel position ───────────────────────────────────────────────
  // Default to top-right (window.innerWidth − panel width − 16px gutter)
  const { panelRef: dragPanelElementRef, headerDragProps, panelPositionStyle } = useDraggablePanel(
    'properties',
    () => ({
      x: typeof window !== 'undefined' ? window.innerWidth - DEFAULT_WIDTH - 16 : 16,
      y: 16,
    }),
  )

  // ─── Focus management: F6 moves focus into panel ──────────────────────────
  useEffect(() => {
    if (focusedPanel === 'properties' && dragPanelElementRef.current) {
      dragPanelElementRef.current.focus()
    }
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

  const isNonDesktopBp = Boolean(activeBreakpointId && activeBreakpointId !== 'desktop')
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

  const handleModuleStyleChange = useCallback(
    (binding: ResolvedModuleStyleBinding, value: unknown) => {
      if (!selectedNodeId || !definition) return
      const cls = ensureNodeStyleClass(selectedNodeId, definition.name)
      if (!cls) return
      const nodeStyleClass = findNodeStyleClass(site, selectedNode, selectedNodeId) ?? cls
      const currentStyles = activeBreakpointId && activeBreakpointId !== 'desktop'
        ? (nodeStyleClass.breakpointStyles[activeBreakpointId] ?? {})
        : nodeStyleClass.styles
      const patch = binding.binding.toCSS(value, currentStyles)
      if (activeBreakpointId && activeBreakpointId !== 'desktop') {
        setClassBreakpointStyles(cls.id, activeBreakpointId, patch)
      } else {
        updateClassStyles(cls.id, patch)
      }
      setStatusMessage(`${binding.label} updated`)
    },
    [
      selectedNodeId,
      selectedNode,
      definition,
      site,
      activeBreakpointId,
      ensureNodeStyleClass,
      updateClassStyles,
      setClassBreakpointStyles,
    ],
  )

  const collapsed = panelState.collapsed
  const width = Math.max(panelState.width || DEFAULT_WIDTH, MIN_WIDTH)

  // Fully hidden when collapsed or when there is no selected layer/selector to inspect.
  if (collapsed || (!selectedNodeId && !selectedSelectorClass)) return null

  const modeButtonLabel = variant === 'docked'
    ? 'Unpin Properties panel'
    : 'Dock Properties panel'
  const modeButtonTitle = variant === 'docked'
    ? 'Unpin to floating panel'
    : 'Dock in right sidebar'

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
      // Width is state-driven (resizable panel) — CSS var injection
      // Panel position is drag-driven — CSS var injection from useDraggablePanel
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
          title={modeButtonTitle}
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
          <SelectorInspector cls={selectedSelectorClass} />
        ) : !selectedNode || !definition ? (
          <div className={styles.emptyState}>
            Select an element on the canvas to view its properties.
          </div>
        ) : selectedNode.moduleId === 'base.visualComponentRef' ? (
          /* ── Visual Component instance view (Task #438 / Contribution #619 §8.5) ── */
          <ComponentRefView
            nodeId={selectedNodeId!}
            componentId={String(selectedNode.props.componentId ?? '')}
            propOverrides={(selectedNode.props.propOverrides ?? {}) as Record<string, unknown>}
          />
        ) : (
          /* ── Single-scroll layout (Task #456 / Spec #659 §1) ─────────── */
          <div className={styles.scrollArea}>
            <div className={styles.headerClassPicker}>
              <ClassPicker nodeId={selectedNodeId!} />
            </div>

            {/* Module props section — collapsible, default open (PP-4) */}
            <Section
              title="Module settings"
              defaultOpen
              icon={Settings2Icon}
              meta={definition.name}
              indicator={isNonDesktopBp ? 'bp' : undefined}
            >
              {/* Breakpoint hint inside module section (Spec §4.1) */}
              {isNonDesktopBp && (
                <div className={styles.breakpointHint}>
                  Editing <strong>{activeBreakpointId}</strong> overrides.
                  Purple values differ from desktop.
                </div>
              )}
              <div key={selectedNodeId ?? ''} className={styles.moduleContent}>
                {Object.entries(definition.schema).map(([key, control]: [string, PropertyControl]) => {
                  if (control.condition && !evaluateCondition(control.condition, resolvedPropsForBreakpoint!)) {
                    return null
                  }
                  return (
                    <PropertyControlRenderer
                      key={key}
                      propKey={key}
                      control={control}
                      value={resolvedPropsForBreakpoint![key]}
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
                <ModuleStyleSettings
                  moduleDefinition={definition}
                  site={site}
                  node={selectedNode}
                  nodeId={selectedNodeId!}
                  activeBreakpointId={activeBreakpointId}
                  onChange={handleModuleStyleChange}
                />
              </div>
            </Section>

            {activeClassId && activeClass && (
              <ClassComposer
                key={activeClassId}
                classId={activeClassId}
                cls={activeClass}
                moduleDefinition={definition}
                moduleProps={resolvedPropsForBreakpoint ?? selectedNode.props}
                preferredBreakpointId={isNonDesktopBp ? activeBreakpointId : undefined}
              />
            )}
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
        title="Rename element"
      >
        <EditIcon size={12} aria-hidden="true" />
      </Button>
    </div>
  )
}

interface SelectorHeaderProps {
  cls: CSSClass
  onRename: (name: string) => void
}

function SelectorHeader({ cls, onRename }: SelectorHeaderProps) {
  const [isEditing, setIsEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.value = cls.name
    }
  }, [cls.id, cls.name, isEditing])

  useEffect(() => {
    if (!isEditing) return
    requestAnimationFrame(() => inputRef.current?.select())
  }, [isEditing])

  const commitRename = useCallback((input: HTMLInputElement) => {
    const nextName = input.value.trim()
    if (nextName && nextName !== cls.name) {
      try {
        onRename(nextName)
      } catch {
        input.value = cls.name
      }
    } else {
      input.value = cls.name
    }
    setIsEditing(false)
  }, [cls.name, onRename])

  const cancelRename = useCallback((input: HTMLInputElement) => {
    input.value = cls.name
    setIsEditing(false)
  }, [cls.name])

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        type="text"
        fieldSize="xs"
        emphasis="strong"
        defaultValue={cls.name}
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
        aria-label="Selector name"
        className={styles.headerNameInput}
      />
    )
  }

  return (
    <div className={styles.headerNodeTitle}>
      <span className={styles.headerNodeLabel} title={cls.name}>{cls.name}</span>
      <Button
        variant="ghost"
        size="xs"
        iconOnly
        onClick={() => setIsEditing(true)}
        aria-label={`Rename selector ${cls.name}`}
        title="Rename selector"
      >
        <EditIcon size={12} aria-hidden="true" />
      </Button>
    </div>
  )
}

function SelectorInspector({ cls }: { cls: CSSClass }) {
  return (
    <div className={styles.scrollArea}>
      <section className={styles.selectorInspector} aria-label={`Selector ${cls.name}`}>
        <div className={styles.selectorIntro}>
          <h2 className={styles.selectorTitle}>{cls.name}</h2>
          <code className={styles.selectorCode}>{cssClassSelector(cls)}</code>
        </div>
        <ClassComposer key={cls.id} classId={cls.id} cls={cls} mode="global" />
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ModuleStyleSettings — module-declared CSS fields backed by node-scoped class
// ---------------------------------------------------------------------------

interface ModuleStyleSettingsProps {
  moduleDefinition: AnyModuleDefinition
  site: SiteDocument | null
  node: PageNode
  nodeId: string
  activeBreakpointId: string | undefined
  onChange: (binding: ResolvedModuleStyleBinding, value: unknown) => void
}

function ModuleStyleSettings({
  moduleDefinition,
  site,
  node,
  nodeId,
  activeBreakpointId,
  onChange,
}: ModuleStyleSettingsProps) {
  const bindings = getModuleStyleBindings(moduleDefinition)
  if (bindings.length === 0) return null

  const nodeStyleClass = findNodeStyleClass(site, node, nodeId)
  const currentStyles = activeBreakpointId && activeBreakpointId !== 'desktop'
    ? (nodeStyleClass?.breakpointStyles[activeBreakpointId] ?? {})
    : (nodeStyleClass?.styles ?? {})

  return (
    <div className={styles.moduleStyleFields}>
      {bindings.map((binding) => (
        <PropertyControlRenderer
          key={`${activeBreakpointId ?? 'desktop'}-${binding.key}`}
          propKey={`module-style-${binding.key}`}
          control={binding.control}
          value={binding.binding.fromCSS(currentStyles)}
          onChange={(_, nextValue) => onChange(binding, nextValue)}
          isOverride={isModuleStyleSet(binding, currentStyles)}
        />
      ))}
    </div>
  )
}

function findNodeStyleClass(
  site: SiteDocument | null,
  node: PageNode | null,
  nodeId: string,
): CSSClass | null {
  if (!site || !node?.classIds) return null
  for (const classId of node.classIds) {
    const cls = site.classes[classId]
    if (cls?.scope?.type === 'node' && cls.scope.nodeId === nodeId && cls.scope.role === 'module-style') {
      return cls
    }
  }
  return null
}
