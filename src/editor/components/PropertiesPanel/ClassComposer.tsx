/**
 * ClassComposer - style editor for a single CSS class.
 *
 * The class editor mirrors the module settings surface: categorized sections,
 * typed controls, a compact breakpoint picker, and direct remove affordances per property.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useEditorStore } from '../../../core/editor-store/store'
import type { CSSClass, CSSPropertyBag } from '../../../core/page-tree/types'
import { Button } from '@ui/components/Button'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@ui/components/ContextMenu'
import { SearchBar } from '@ui/components/SearchBar'
import { Select } from '@ui/components/Select'
import { CloseIcon } from '../../../ui/icons/icons/close'
import { Settings2Icon } from '@ui/icons/icons/settings-2'
import { BoxStackIcon } from '@ui/icons/icons/box-stack'
import { SmartphoneIcon } from '@ui/icons/icons/smartphone'
import { TabletIcon } from '@ui/icons/icons/tablet'
import { MonitorIcon } from '@ui/icons/icons/monitor'
import { LaptopIcon } from '@ui/icons/icons/laptop'
import { TvIcon } from '@ui/icons/icons/tv'
import { PropertyControlRenderer } from '../PropertyControls/PropertyControlRenderer'
import { ClassPropertyRow } from './ClassPropertyRow'
import { Section } from './Section'
import type { AnyModuleDefinition } from '../../../core/module-engine/types'
import {
  clearModuleStylePatch,
  getModuleStyleBindings,
  isModuleStyleSet,
  type ResolvedModuleStyleBinding,
} from './moduleStyleBindings'
import {
  CLASS_STYLE_SECTIONS,
  cssPropertyLabel,
  getCSSPropertyDefaultValue,
  type ClassStyleSectionDefinition,
} from './cssControlTypes'
import styles from './ClassComposer.module.css'

interface ClassComposerProps {
  classId: string
  cls: CSSClass
  moduleDefinition?: AnyModuleDefinition | null
  moduleProps?: Record<string, unknown>
  preferredBreakpointId?: string
  autoFocusName?: boolean
  mode?: 'contextual' | 'global'
}

interface StyleMenuPosition {
  x: number
  y: number
  width: number
}

export function ClassComposer({
  classId,
  cls,
  moduleDefinition,
  moduleProps = {},
  preferredBreakpointId,
  mode = 'contextual',
}: ClassComposerProps) {
  const breakpoints = useEditorStore((s) => s.site?.breakpoints ?? EMPTY_BREAKPOINTS)
  const updateClassStyles = useEditorStore((s) => s.updateClassStyles)
  const setClassBreakpointStyles = useEditorStore((s) => s.setClassBreakpointStyles)

  const preferredStyleTab = getPreferredStyleTab(preferredBreakpointId)
  const [activeTab, setActiveTab] = useState<string>(() => preferredStyleTab)
  const [styleQuery, setStyleQuery] = useState('')
  const styleSearchInputRef = useRef<HTMLInputElement>(null)
  const [styleMenuPosition, setStyleMenuPosition] = useState<StyleMenuPosition | null>(null)

  const storedStyles: Partial<CSSPropertyBag> = activeTab !== 'base'
    ? (cls.breakpointStyles[activeTab] ?? {})
    : cls.styles
  const currentStyles: Partial<CSSPropertyBag> = activeTab !== 'base'
    ? { ...cls.styles, ...storedStyles }
    : cls.styles
  const moduleBindings = mode === 'global' ? [] : getModuleStyleBindings(moduleDefinition)
  const assignedModuleBindings = getAssignedModuleStyleBindings(moduleBindings, currentStyles)
  const searchModuleBindings = getSearchModuleStyleBindings(styleQuery, moduleBindings, currentStyles)
  const allModuleOwnedProperties = new Set(moduleBindings.flatMap(({ binding }) => binding.properties))
  const visibleAssignedSections = getAssignedStyleSections(currentStyles, allModuleOwnedProperties)
  const visibleSearchSections = getSearchStyleSections(styleQuery, currentStyles, allModuleOwnedProperties)
  const breakpointOptions = [
    BASE_BREAKPOINT_OPTION,
    ...breakpoints.map((bp) => ({
      id: bp.id,
      label: bp.label,
      icon: bp.icon,
      hasOverrides: Object.keys(cls.breakpointStyles[bp.id] ?? {}).length > 0,
    })),
  ]

  const handleChange = useCallback(
    (key: keyof CSSPropertyBag, value: string | number | undefined) => {
      const patch = { [key]: value ?? null } as Partial<CSSPropertyBag>
      if (activeTab !== 'base') {
        setClassBreakpointStyles(classId, activeTab, patch)
      } else {
        updateClassStyles(classId, patch)
      }
    },
    [classId, activeTab, updateClassStyles, setClassBreakpointStyles],
  )

  const handleStylePatch = useCallback(
    (patch: Partial<CSSPropertyBag>) => {
      if (activeTab !== 'base') {
        setClassBreakpointStyles(classId, activeTab, patch)
      } else {
        updateClassStyles(classId, patch)
      }
    },
    [classId, activeTab, updateClassStyles, setClassBreakpointStyles],
  )

  const handleRemoveProperty = useCallback(
    (key: keyof CSSPropertyBag) => {
      handleChange(key, undefined)
    },
    [handleChange],
  )

  const updateStyleMenuPosition = useCallback(() => {
    setStyleMenuPosition(getStyleMenuPosition(styleSearchInputRef.current))
  }, [])

  const clearStyleQuery = useCallback(() => {
    setStyleQuery('')
    setStyleMenuPosition(null)
  }, [])

  const handleStyleQueryChange = useCallback(
    (nextQuery: string) => {
      setStyleQuery(nextQuery)
      if (nextQuery.trim()) {
        updateStyleMenuPosition()
      } else {
        setStyleMenuPosition(null)
      }
    },
    [updateStyleMenuPosition],
  )

  const handleAddProperty = useCallback(
    (property: keyof CSSPropertyBag) => {
      handleChange(property, getCSSPropertyDefaultValue(property))
      clearStyleQuery()
    },
    [clearStyleQuery, handleChange],
  )

  useEffect(() => {
    setActiveTab(preferredStyleTab)
  }, [preferredStyleTab])

  useEffect(() => {
    if (!styleMenuPosition) return undefined

    function handleViewportChange() {
      updateStyleMenuPosition()
    }

    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)

    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [styleMenuPosition, updateStyleMenuPosition])

  function handleModuleStyleChange(binding: ResolvedModuleStyleBinding, value: unknown) {
    handleStylePatch(binding.binding.toCSS(value, currentStyles))
  }

  function handleRemoveModuleStyle(binding: ResolvedModuleStyleBinding) {
    handleStylePatch(clearModuleStylePatch(binding))
  }

  function handleAddModuleStyle(binding: ResolvedModuleStyleBinding) {
    const value = moduleProps[binding.key] ?? moduleDefinition?.defaults?.[binding.key] ?? binding.binding.defaultValue
    handleModuleStyleChange(binding, value)
    clearStyleQuery()
  }

  return (
    <div className={styles.composer}>
      <div className={styles.styleToolbar}>
        <div className={styles.toolbarRow}>
          <label className={styles.breakpointSelectWrap}>
            <Select
              value={activeTab}
              onChange={(e) => setActiveTab(e.target.value)}
              aria-label="Class style breakpoint"
              fieldSize="sm"
              emphasis="strong"
              className={styles.breakpointSelect}
              options={breakpointOptions.map((bp) => ({
                value: bp.id,
                label: `${bp.label}${bp.hasOverrides ? ' (set)' : ''}`,
                icon: <BreakpointOptionIcon name={bp.icon} />,
              }))}
            />
          </label>
          <SearchBar
            ref={styleSearchInputRef}
            value={styleQuery}
            onValueChange={handleStyleQueryChange}
            onClear={clearStyleQuery}
            onFocus={() => {
              if (styleQuery.trim()) updateStyleMenuPosition()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchModuleBindings[0]) {
                e.preventDefault()
                handleAddModuleStyle(searchModuleBindings[0])
              } else if (e.key === 'Enter' && visibleSearchSections[0]?.properties[0]) {
                e.preventDefault()
                handleAddProperty(visibleSearchSections[0].properties[0])
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                clearStyleQuery()
              }
            }}
            placeholder={`Add style to ${cls.name}...`}
            aria-label="Search class style properties to add"
          />
        </div>
        {styleQuery.trim() && (
          styleMenuPosition && createPortal(
            <StyleSearchMenu
              x={styleMenuPosition.x}
              y={styleMenuPosition.y}
              width={styleMenuPosition.width}
              moduleBindings={searchModuleBindings}
              sections={visibleSearchSections}
              onAddModuleStyle={handleAddModuleStyle}
              onAddProperty={handleAddProperty}
              onClose={clearStyleQuery}
            />,
            document.body,
          )
        )}
      </div>

      {(assignedModuleBindings.length > 0 || visibleAssignedSections.length > 0) && (
        <div className={styles.styleSections}>
          {assignedModuleBindings.length > 0 && (
            <Section
              title={`${moduleDefinition?.name ?? 'Module'} styles`}
              icon={Settings2Icon}
              defaultOpen
              meta={`${assignedModuleBindings.length} set`}
            >
              <div className={styles.styleSectionBody}>
                {assignedModuleBindings.map((binding) => (
                  <ModuleStyleBindingRow
                    key={`${activeTab}-${binding.key}`}
                    binding={binding}
                    currentStyles={currentStyles}
                    onChange={handleModuleStyleChange}
                    onRemove={handleRemoveModuleStyle}
                  />
                ))}
              </div>
            </Section>
          )}
          {visibleAssignedSections.map((section) => (
            <ClassStyleSection
              key={section.id}
              section={section}
              currentStyles={currentStyles}
              storedStyles={storedStyles}
              activeTab={activeTab}
              onChange={handleChange}
              onRemove={handleRemoveProperty}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface ClassStyleSectionProps {
  section: ClassStyleSectionDefinition
  currentStyles: Partial<CSSPropertyBag>
  storedStyles: Partial<CSSPropertyBag>
  activeTab: string
  onChange: (property: keyof CSSPropertyBag, value: string | number | undefined) => void
  onRemove: (property: keyof CSSPropertyBag) => void
}

function ClassStyleSection({
  section,
  currentStyles,
  storedStyles,
  activeTab,
  onChange,
  onRemove,
}: ClassStyleSectionProps) {
  const setCount = section.properties.filter((prop) => hasStyleValue(storedStyles[prop])).length

  return (
    <Section
      title={section.title}
      icon={section.icon}
      defaultOpen
      meta={setCount > 0 ? `${setCount} set` : undefined}
    >
      <div className={styles.styleSectionBody}>
        {section.properties.map((prop) => {
          const storedValue = storedStyles[prop]
          const displayValue = currentStyles[prop]
          const isSet = hasStyleValue(storedValue)
          const value = hasStyleValue(displayValue) ? displayValue : getCSSPropertyDefaultValue(prop)

          return (
            <ClassPropertyRow
              key={`${activeTab}-${String(prop)}`}
              property={prop}
              value={value}
              isSet={isSet}
              onChange={onChange}
              onRemove={onRemove}
            />
          )
        })}
      </div>
    </Section>
  )
}

interface StyleSearchMenuProps {
  x: number
  y: number
  width: number
  moduleBindings: ReadonlyArray<ResolvedModuleStyleBinding>
  sections: ReadonlyArray<ClassStyleSectionDefinition>
  onAddModuleStyle: (binding: ResolvedModuleStyleBinding) => void
  onAddProperty: (property: keyof CSSPropertyBag) => void
  onClose: () => void
}

function StyleSearchMenu({
  x,
  y,
  width,
  moduleBindings,
  sections,
  onAddModuleStyle,
  onAddProperty,
  onClose,
}: StyleSearchMenuProps) {
  const propertySections = sections.filter((section) => section.properties.length > 0)
  const propertyItems = propertySections.flatMap((section) => section.properties)

  if (moduleBindings.length === 0 && sections.length === 0) {
    return (
      <ContextMenu
        x={x}
        y={y}
        width={width}
        minWidth={width}
        zIndex={10000}
        ariaLabel="Available style properties"
        onClose={onClose}
      >
        <ContextMenuItem disabled>No available properties match</ContextMenuItem>
      </ContextMenu>
    )
  }

  return (
    <ContextMenu
      x={x}
      y={y}
      width={width}
      minWidth={width}
      zIndex={10000}
      ariaLabel="Available style properties"
      onClose={onClose}
    >
      {moduleBindings.map((binding) => (
        <ContextMenuItem key={binding.key} onClick={() => onAddModuleStyle(binding)}>
          <span aria-hidden="true">
            <Settings2Icon size={12} />
          </span>
          <span>{binding.label}</span>
        </ContextMenuItem>
      ))}
      {moduleBindings.length > 0 && propertyItems.length > 0 && <ContextMenuSeparator />}
      {propertySections.map((section) => (
        section.properties.map((property) => {
          const SectionIcon = section.icon
          return (
            <ContextMenuItem key={`${section.id}-${String(property)}`} onClick={() => onAddProperty(property)}>
              <span aria-hidden="true">
                <SectionIcon size={12} />
              </span>
              <span>{cssPropertyLabel(String(property))}</span>
            </ContextMenuItem>
          )
        })
      ))}
    </ContextMenu>
  )
}

function getStyleMenuPosition(input: HTMLInputElement | null): { x: number; y: number; width: number } | null {
  if (!input) return null
  const anchor = input.parentElement ?? input
  const rect = anchor.getBoundingClientRect()

  return {
    x: Math.max(8, rect.left),
    y: rect.bottom + 4,
    width: Math.max(220, rect.width),
  }
}

interface ModuleStyleBindingRowProps {
  binding: ResolvedModuleStyleBinding
  currentStyles: Partial<CSSPropertyBag>
  onChange: (binding: ResolvedModuleStyleBinding, value: unknown) => void
  onRemove: (binding: ResolvedModuleStyleBinding) => void
}

function ModuleStyleBindingRow({ binding, currentStyles, onChange, onRemove }: ModuleStyleBindingRowProps) {
  const value = binding.binding.fromCSS(currentStyles)

  return (
    <div className={styles.moduleStyleRow} data-testid={`module-style-row-${binding.key}`}>
      <PropertyControlRenderer
        propKey={`module-style-${binding.key}`}
        control={binding.control}
        value={value}
        onChange={(_, nextValue) => onChange(binding, nextValue)}
      />
      <Button
        variant="ghost"
        size="micro"
        iconOnly
        onClick={() => onRemove(binding)}
        aria-label={`Remove ${binding.label} module style`}
        title={`Remove ${binding.label}`}
        className={styles.moduleStyleRemoveBtn}
      >
        <CloseIcon size={16} color="currentColor" aria-hidden="true" />
      </Button>
    </div>
  )
}

function getAssignedStyleSections(
  styles: Partial<CSSPropertyBag>,
  hiddenProperties = new Set<keyof CSSPropertyBag>(),
): ReadonlyArray<ClassStyleSectionDefinition> {
  return CLASS_STYLE_SECTIONS
    .map((section) => ({
      ...section,
      properties: section.properties.filter((prop) => !hiddenProperties.has(prop) && hasStyleValue(styles[prop])),
    }))
    .filter((section) => section.properties.length > 0)
}

function getSearchStyleSections(
  query: string,
  styles: Partial<CSSPropertyBag>,
  hiddenProperties = new Set<keyof CSSPropertyBag>(),
): ReadonlyArray<ClassStyleSectionDefinition> {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return []

  return CLASS_STYLE_SECTIONS
    .map((section) => ({
      ...section,
      properties: section.properties.filter(
        (prop) => !hiddenProperties.has(prop) && !hasStyleValue(styles[prop]) && propertyMatchesQuery(prop, normalizedQuery),
      ),
    }))
    .filter((section) => section.properties.length > 0)
}

function getAssignedModuleStyleBindings(
  bindings: ReadonlyArray<ResolvedModuleStyleBinding>,
  styles: Partial<CSSPropertyBag>,
): ReadonlyArray<ResolvedModuleStyleBinding> {
  return bindings.filter((binding) => isModuleStyleSet(binding, styles))
}

function getSearchModuleStyleBindings(
  query: string,
  bindings: ReadonlyArray<ResolvedModuleStyleBinding>,
  styles: Partial<CSSPropertyBag>,
): ReadonlyArray<ResolvedModuleStyleBinding> {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return []

  return bindings.filter(
    (binding) =>
      !isModuleStyleSet(binding, styles) &&
      (binding.key.toLowerCase().includes(normalizedQuery) || binding.label.toLowerCase().includes(normalizedQuery)),
  )
}

function propertyMatchesQuery(prop: keyof CSSPropertyBag, query: string): boolean {
  const raw = String(prop).toLowerCase()
  const label = cssPropertyLabel(String(prop)).toLowerCase()
  return raw.includes(query) || label.includes(query)
}

function hasStyleValue(value: string | number | undefined): value is string | number {
  return value !== undefined && value !== null && value !== ''
}

function getPreferredStyleTab(preferredBreakpointId: string | undefined): string {
  return preferredBreakpointId && preferredBreakpointId !== 'desktop' ? preferredBreakpointId : 'base'
}

const EMPTY_BREAKPOINTS: Array<{ id: string; label: string; width: number; icon: string }> = []
const BASE_BREAKPOINT_OPTION = { id: 'base', label: 'Base', icon: 'box-stack', hasOverrides: false }

function BreakpointOptionIcon({ name }: { name: string }) {
  switch (name) {
    case 'smartphone':
      return <SmartphoneIcon size={13} />
    case 'tablet':
      return <TabletIcon size={13} />
    case 'laptop':
      return <LaptopIcon size={13} />
    case 'tv':
      return <TvIcon size={13} />
    case 'box-stack':
      return <BoxStackIcon size={13} />
    case 'monitor':
    default:
      return <MonitorIcon size={13} />
  }
}
