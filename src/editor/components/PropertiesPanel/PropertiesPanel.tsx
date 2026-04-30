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
import { PropertyControlRenderer } from '../PropertyControls/PropertyControlRenderer'
import type { AnyModuleDefinition, PropertyControl } from '../../../core/module-engine/types'
import type { CSSClass, PageNode, Project } from '../../../core/page-tree/types'
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
import { Icon } from '../../../ui/icons/Icon'
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
  const setBreakpointOverride = useEditorStore((s) => s.setBreakpointOverride)
  const ensureNodeStyleClass = useEditorStore((s) => s.ensureNodeStyleClass)
  const updateClassStyles = useEditorStore((s) => s.updateClassStyles)
  const setClassBreakpointStyles = useEditorStore((s) => s.setClassBreakpointStyles)
  const activeBreakpointId = useEditorStore((s) => s.activeBreakpointId)
  const renameNode = useEditorStore((s) => s.renameNode)
  const project = useEditorStore((s) => s.project)
  const activeClassId = useEditorStore((s) => s.activeClassId)

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
  const activeClass =
    activeClassId && selectedNode?.classIds?.includes(activeClassId)
      ? project?.classes[activeClassId]
      : null

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
      const nodeStyleClass = findNodeStyleClass(project, selectedNode, selectedNodeId) ?? cls
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
      project,
      activeBreakpointId,
      ensureNodeStyleClass,
      updateClassStyles,
      setClassBreakpointStyles,
    ],
  )

  const collapsed = panelState.collapsed
  const width = Math.max(panelState.width || DEFAULT_WIDTH, MIN_WIDTH)

  // Fully hidden when collapsed or when there is no selected layer to inspect.
  if (collapsed || !selectedNodeId) return null

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
        titleContent={selectedNode && definition ? (
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
          <Icon
            name={variant === 'docked' ? 'open' : 'dock'}
            size={12}
            aria-hidden="true"
          />
        </Button>
      </PanelHeader>

      {/* ─── Properties content (independent panel — Guideline #410) ─────── */}
      <div
        aria-label="Properties editor"
        className={styles.propertiesPanel}
      >
        {!selectedNode || !definition ? (
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
              icon="settings-2"
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
                    />
                  )
                })}
                <ModuleStyleSettings
                  moduleDefinition={definition}
                  project={project}
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
        <Icon name="edit" size={12} aria-hidden="true" />
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ModuleStyleSettings — module-declared CSS fields backed by node-scoped class
// ---------------------------------------------------------------------------

interface ModuleStyleSettingsProps {
  moduleDefinition: AnyModuleDefinition
  project: Project | null
  node: PageNode
  nodeId: string
  activeBreakpointId: string | undefined
  onChange: (binding: ResolvedModuleStyleBinding, value: unknown) => void
}

function ModuleStyleSettings({
  moduleDefinition,
  project,
  node,
  nodeId,
  activeBreakpointId,
  onChange,
}: ModuleStyleSettingsProps) {
  const bindings = getModuleStyleBindings(moduleDefinition)
  if (bindings.length === 0) return null

  const nodeStyleClass = findNodeStyleClass(project, node, nodeId)
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
  project: Project | null,
  node: PageNode | null,
  nodeId: string,
): CSSClass | null {
  if (!project || !node?.classIds) return null
  for (const classId of node.classIds) {
    const cls = project.classes[classId]
    if (cls?.scope?.type === 'node' && cls.scope.nodeId === nodeId && cls.scope.role === 'module-style') {
      return cls
    }
  }
  return null
}
