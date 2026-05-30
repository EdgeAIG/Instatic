/**
 * SelectorInspector — Properties panel body when a class is selected via the
 * global Selectors panel (no node context, just the rule + style sections).
 *
 * Renders the StyleCategoryRail for category nav and a ClassComposer body
 * that lists / edits the class's CSS properties. A search input above filters
 * by property name.
 *
 * Generated utility classes (those gated by `isGeneratedClassLocked`) render
 * a locked-state empty card instead of editable surfaces.
 */
import { useEffect, useRef, useState } from 'react'
import { SearchBar } from '@ui/components/SearchBar'
import { useEditorPreference } from '@site/preferences/editorPreferences'
import { isGeneratedClassLocked } from '@core/page-tree/classUtils'
import type { StyleRule } from '@core/page-tree'
import { ClassComposer } from './ClassComposer'
import { StyleCategoryRail } from './StyleCategoryRail'
import { GeneratedUtilityLockedState } from './StyleSurface'
import {
  CLASS_STYLE_SECTIONS,
  getClassStyleSectionSetCounts,
  getActiveStyleTab,
} from './cssControlTypes'
import styles from './PropertiesPanel.module.css'

const FIRST_STYLE_SECTION_ID = CLASS_STYLE_SECTIONS[0].id

interface SelectorInspectorProps {
  cls: StyleRule
  activeBreakpointId: string | undefined
}

export function SelectorInspector({ cls, activeBreakpointId }: SelectorInspectorProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeAnchorId, setActiveAnchorId] = useState<string>(FIRST_STYLE_SECTION_ID)
  const [styleQuery, setStyleQuery] = useState('')
  const clearStyleQuery = () => setStyleQuery('')
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

  const handleSectionClick = (sectionId: string) => {
    const container = scrollRef.current
    if (!container) return
    const behavior: ScrollBehavior = propertiesSmoothScroll ? 'smooth' : 'auto'
    setActiveAnchorId(sectionId)
    const el = container.querySelector<HTMLElement>(`[data-style-section="${sectionId}"]`)
    if (!el) return
    const containerRect = container.getBoundingClientRect()
    const rect = el.getBoundingClientRect()
    container.scrollTo({ top: rect.top - containerRect.top + container.scrollTop, behavior })
  }

  if (isGeneratedClassLocked(cls)) {
    return (
      <div className={styles.nodeArea}>
        <GeneratedUtilityLockedState cls={cls} />
      </div>
    )
  }

  const activeTab = getActiveStyleTab(activeBreakpointId)
  const storedStyles = activeTab !== 'base' ? (cls.contextStyles[activeTab] ?? {}) : cls.styles
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
