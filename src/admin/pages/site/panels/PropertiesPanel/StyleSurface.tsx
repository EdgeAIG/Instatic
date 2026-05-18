/**
 * StyleSurface — unified properties editor surface.
 *
 * Layout: one continuous scrollable column with a sticky icon-rail on the
 * right and a sticky search bar pinned to the top.
 *
 * All sections render together in one scroll:
 *   1. Module settings — wrapped in a Section accordion, always first.
 *   2. CSS area — ClassComposer (all CSS sections) or locked preview.
 *
 * The search bar is bound to the active editable class and filters across
 * module settings (by prop key/label) and the class's CSS properties
 * simultaneously. It is hidden when there is no active class (locked
 * preview) or when the active class is a locked generated utility — neither
 * state has editable CSS rows to search.
 *
 * Rail icons are scroll-anchor shortcuts; the active icon is derived from
 * scroll position.
 *
 * Global selector mode (definition === null):
 *   Module section and Module rail button are hidden.
 */

import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react'
import type { AnyModuleDefinition } from '@core/module-engine/types'
import type { CSSClass, CSSPropertyBag } from '@core/page-tree/schemas'
import { isGeneratedClassLocked } from '@core/page-tree/classUtils'
import { Button } from '@ui/components/Button'
import { SearchBar } from '@ui/components/SearchBar'
import { Section } from '@ui/components/Section'
import { ClassComposer } from './ClassComposer'
import { ClassPropertyRow } from './ClassPropertyRow'
import { StyleCategoryRail, MODULE_CATEGORY_ID } from './StyleCategoryRail'
import {
  CLASS_STYLE_SECTIONS,
  getCSSPropertyDefaultValue,
  getClassStyleSectionSetCounts,
  getActiveStyleTab,
} from './cssControlTypes'
import { useEditorPreference } from '@site/preferences/editorPreferences'
import { useEditorPermissions } from '@site/editorPermissionsContext'
import { EmptyState } from '@ui/components/EmptyState'
import styles from './StyleSurface.module.css'
import sectionStyles from '@ui/components/Section/Section.module.css'

// ---------------------------------------------------------------------------
// Public exports
// ---------------------------------------------------------------------------

export { GeneratedUtilityLockedState }

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StyleSurfaceProps {
  definition?: AnyModuleDefinition | null
  activeClass: CSSClass | null
  activeClassId: string | null
  activeBreakpointId: string | undefined
  /** Node id — triggers scroll reset when it changes. */
  nodeId: string | null
  /** Pre-rendered module prop rows shown in the Module section. */
  moduleContent?: ReactNode
  /** Called when 'Add class' is clicked in the locked preview. */
  onFocusClassPicker?: () => void
}

// ---------------------------------------------------------------------------
// StyleSurface
// ---------------------------------------------------------------------------

export function StyleSurface({
  definition,
  activeClass,
  activeClassId,
  activeBreakpointId,
  nodeId,
  moduleContent,
  onFocusClassPicker,
}: StyleSurfaceProps) {
  // scrollRef → outer grid which is also the scroll container
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeAnchorId, setActiveAnchorId] = useState<string>(MODULE_CATEGORY_ID)
  const [styleQuery, setStyleQuery] = useState('')

  // Reset search query when active class changes (no state leak between pills).
  const [lastActiveClassId, setLastActiveClassId] = useState<string | null>(null)
  if (lastActiveClassId !== activeClassId) {
    setLastActiveClassId(activeClassId)
    if (styleQuery !== '') setStyleQuery('')
  }

  // Reset active anchor on node change ("update during render" — no setState-in-effect).
  const [lastNodeId, setLastNodeId] = useState<string | null>(null)
  if (lastNodeId !== nodeId) {
    setLastNodeId(nodeId)
    setActiveAnchorId(MODULE_CATEGORY_ID)
  }

  // Scroll back to top on node change (DOM mutation — safe in effect).
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [nodeId])

  // Derive active anchor from scroll position via passive scroll listener.
  // Set up once (ref element is stable for the lifetime of this mount).
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    function updateActive() {
      if (!container) return
      const sections = container.querySelectorAll<HTMLElement>('[data-style-section]')
      const containerRect = container.getBoundingClientRect()
      let activeId = MODULE_CATEGORY_ID
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

  // Smooth-scroll behaviour gated by the `propertiesSmoothScroll` preference.
  // Read fresh inside the handler so toggling the pref takes effect on the
  // very next click without re-binding the callback.
  const propertiesSmoothScroll = useEditorPreference('propertiesSmoothScroll')

  // Scroll to the section corresponding to the clicked rail button.
  const handleSectionClick = useCallback((sectionId: string) => {
    const container = scrollRef.current
    if (!container) return

    const behavior: ScrollBehavior = propertiesSmoothScroll ? 'smooth' : 'auto'

    if (sectionId === MODULE_CATEGORY_ID) {
      setActiveAnchorId(MODULE_CATEGORY_ID)
      container.scrollTo({ top: 0, behavior })
      return
    }

    setActiveAnchorId(sectionId)
    const el = container.querySelector<HTMLElement>(`[data-style-section="${sectionId}"]`)
    if (!el) return
    const containerRect = container.getBoundingClientRect()
    const rect = el.getBoundingClientRect()
    container.scrollTo({
      top: rect.top - containerRect.top + container.scrollTop,
      behavior,
    })
  }, [propertiesSmoothScroll])

  const clearStyleQuery = useCallback(() => setStyleQuery(''), [])

  // Rail dot badges from stored styles at the current breakpoint.
  const activeTab = getActiveStyleTab(activeBreakpointId)
  const storedStyles: Record<string, unknown> = activeClass
    ? (activeTab !== 'base' ? (activeClass.breakpointStyles[activeTab] ?? {}) : activeClass.styles)
    : {}
  const sectionSetCounts = getClassStyleSectionSetCounts(storedStyles)

  // Module section visibility: always visible unless search has no match.
  const hasModuleContent = definition != null && moduleContent != null
  const moduleVisible = hasModuleContent && (!styleQuery || moduleMatchesQuery(styleQuery, definition!))

  // The search bar is bound to the active class — both its placeholder and
  // the rows it filters belong to that class. It only renders when the class
  // exists and is editable.
  //   - no active class selected → LockedStylePreview teaser is shown instead
  //   - active class is a locked generated utility → GeneratedUtilityLockedState
  //     is shown instead (no editable CSS rows to search)
  const searchableClass = activeClass != null && !isGeneratedClassLocked(activeClass)
    ? activeClass
    : null

  // CSS area content. Three branches:
  //  - caller lacks `site.style.edit`           → role-locked notice
  //  - active class is set and editable         → ClassComposer
  //  - active class is a locked generated utility → utility notice
  //  - no active class                          → teaser + "Add class" CTA
  const permissions = useEditorPermissions()
  const canEditStyleHere = permissions.canEditStyle
  let cssContent: ReactNode
  if (!canEditStyleHere) {
    cssContent = (
      <div className={styles.lockedContent}>
        <EmptyState
          variant="centered"
          title="Styles are read-only for your role"
          description="Your role can edit page copy but not classes or style overrides. Ask an editor to make visual changes."
        />
      </div>
    )
  } else if (activeClass != null) {
    if (isGeneratedClassLocked(activeClass)) {
      cssContent = (
        <div className={styles.lockedContent}>
          <GeneratedUtilityLockedState cls={activeClass} />
        </div>
      )
    } else {
      cssContent = (
        <ClassComposer
          key={`${activeClassId}-${activeTab}`}
          classId={activeClassId!}
          cls={activeClass}
          styleQuery={styleQuery}
        />
      )
    }
  } else {
    cssContent = (
      <LockedStylePreview onFocusClassPicker={onFocusClassPicker ?? noop} />
    )
  }

  // definition.icon is an IconComponent — must assign to PascalCase var.
  const ModuleIcon = definition?.icon

  return (
    <div ref={scrollRef} className={styles.surface}>
      {/* ── Left column: search + module section + CSS area ─────────── */}
      <div className={styles.surfaceContent}>

        {/* Search bar — sticky at the top, searches both module and CSS.
            Hidden when no class is selected or the active class is a locked
            generated utility (no CSS rows to search in either state). */}
        {searchableClass && (
          <div className={styles.searchBarRow}>
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
              placeholder={`Search styles in ${searchableClass.name}...`}
              aria-label="Search class style properties to add"
            />
          </div>
        )}

        {/* Module section — same Section accordion as CSS sections */}
        {moduleVisible && (
          <div data-style-section={MODULE_CATEGORY_ID}>
            <Section
              title={definition!.name}
              icon={ModuleIcon}
              defaultOpen
            >
              {/* sectionBody gives the same display:grid + gap as CSS sections.
                  key={nodeId} remounts on node change (replaces the old div wrapper). */}
              <div key={nodeId} className={sectionStyles.sectionBody}>
                {moduleContent}
              </div>
            </Section>
          </div>
        )}

        {/* CSS area — ClassComposer sections, locked preview, or generated lock */}
        {cssContent}
      </div>

      {/* ── Right column: sticky rail ────────────────────────────── */}
      <div className={styles.railSticky}>
        <StyleCategoryRail
          activeAnchorId={activeAnchorId}
          sectionSetCounts={sectionSetCounts}
          onSectionClick={handleSectionClick}
          definition={definition ?? null}
          activeClass={activeClass}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// LockedStylePreview — teaser shown when no class is set on the element
// ---------------------------------------------------------------------------

interface LockedStylePreviewProps {
  onFocusClassPicker: () => void
}

const TEASER_SECTION = CLASS_STYLE_SECTIONS.find((s) => s.id === 'layout')!

function LockedStylePreview({ onFocusClassPicker }: LockedStylePreviewProps) {
  const noopChange = useCallback(() => {}, [])
  const noopRemove = useCallback(() => {}, [])

  return (
    <div className={styles.lockedPreview}>
      {/* Teaser wrapper: capped height with gradient fade */}
      <div className={styles.lockedPreviewTeaserWrapper} aria-hidden="true">
        <div className={styles.lockedPreviewTeaser}>
          {TEASER_SECTION.properties.map((prop) => (
            <ClassPropertyRow
              key={String(prop)}
              property={prop}
              value={undefined}
              placeholder={getCSSPropertyDefaultValue(prop)}
              isSet={false}
              onChange={noopChange as (p: keyof CSSPropertyBag, v: string | number | undefined) => void}
              onRemove={noopRemove as (p: keyof CSSPropertyBag) => void}
            />
          ))}
        </div>
        <div className={styles.lockedPreviewGradient} aria-hidden="true" />
      </div>

      {/* CTA — always visible below the teaser */}
      <div className={styles.lockedPreviewCta}>
        <p className={styles.lockedPreviewCtaText}>
          Add a class to start styling this element
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={onFocusClassPicker}
        >
          Add class
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// GeneratedUtilityLockedState
// ---------------------------------------------------------------------------

function GeneratedUtilityLockedState({ cls }: { cls: CSSClass }) {
  const colorGenerated = cls.generated?.family === 'color' ? cls.generated : undefined
  const utility = colorGenerated?.utility
  const tokenName = cls.generated?.tokenName

  return (
    <div className={styles.generatedUtilityState}>
      <div className={styles.generatedUtilityHeader}>
        <span className={styles.generatedUtilityKicker}>Generated utility</span>
        <span className={styles.generatedUtilityName}>.{cls.name}</span>
      </div>
      <p className={styles.generatedUtilityCopy}>
        This is a utility class. Utility classes have a single purpose and aren&apos;t meant to be
        edited.
      </p>
      {(utility || tokenName) && (
        <div className={styles.generatedUtilityMeta}>
          {utility && <span>{utility}</span>}
          {tokenName && <span>{tokenName}</span>}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the search query matches the module definition name or any
 * of its schema prop keys / labels. Used to show/hide the module section.
 */
function moduleMatchesQuery(query: string, definition: AnyModuleDefinition): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (definition.name.toLowerCase().includes(q)) return true
  return Object.keys(definition.schema).some((key) => {
    const label = key.replace(/([A-Z])/g, ' $1').trim().toLowerCase()
    return key.toLowerCase().includes(q) || label.includes(q)
  })
}

function noop() {}
